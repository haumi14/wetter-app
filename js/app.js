/**
 * app.js – Hauptlogik der Wetter-App.
 *
 * Zuständig für: Routing (Übersicht/Radar), Städtensuche mit Autovervollständigung,
 * Favoriten, Anzeigen des aktuellen Wetters, Tagesspule, Zeitraumumschaltung und
 * das Zusammenbauen der Chart-Daten aus Vorhersage + Ensemble.
 */

import { staedteSuchen, vorhersageLaden, ensembleUnsicherheitLaden, meerDatenLaden } from "./api.js";
import { zeigeChart, chartsLoeschen, FARBEN } from "./charts.js";
import { wetterzustand, kompassrichtung, formatiereOrtszeit, zahl, temperatur } from "./wmo.js";
import { zeigeTagesAussicht, zeigeSonneMond, initialisiereGezeiten, waehleNaechstenPegel, ladeDwdAnzeige } from "./info.js";
import { wetterKulisseAnwenden } from "./himmel.js";
import { elchAktualisieren } from "./elch.js";
import * as favoriten from "./favorites.js";
import { initialisiereRadar } from "./radar.js";

/* ================================ Zustand ================================= */

const zustand = {
  ort: null,          // gewählter Ort {name, admin1, country, lat, lon, timezone}
  vor: null,          // Antwort der Forecast-API
  ens: null,          // Ensemble-Auswertung oder null
  tagIndex: 0,        // ausgewählter Tag (Index in daily.time)
  zeitraum: "tag",    // 'tag' | '3' | '7' | '16'
};

const $ = (id) => document.getElementById(id);
const SCHLUESSEL_LETZTER_ORTE = "wetter.letzterOrt.v1";

/* ================================== Router ================================ */

let radar = null; // wird beim ersten Radaraufruf erzeugt

function ROUTEanwenden() {
  const radarAnsicht = location.hash === "#/radar";
  $("ansicht-uebersicht").hidden = radarAnsicht;
  $("ansicht-radar").hidden = !radarAnsicht;
  $("nav-uebersicht").setAttribute("aria-current", radarAnsicht ? "false" : "page");
  $("nav-radar").setAttribute("aria-current", radarAnsicht ? "page" : "false");
  if (radarAnsicht) {
    radar ??= initialisiereRadar(() => zustand.ort);
    radar.zeige();
  } else {
    radar?.verstecke();
  }
}
window.addEventListener("hashchange", ROUTEanwenden);

/* ============================ Status & Fehler ============================= */

function statusAnzeigen(text, { fehler = false, wiederholen = null } = {}) {
  const bereich = $("statusbereich");
  bereich.hidden = !text;
  $("statustext").textContent = text ?? "";
  const knopf = $("status-wiederholen");
  knopf.hidden = !wiederholen;
  if (wiederholen) knopf.onclick = wiederholen;
}

function ladeAnzeigeZeigen() {
  $("aktuell-inhalt").innerHTML =
    `<div class="skelett">
       <div class="lade-balken" style="width:45%"></div>
       <div class="lade-balken" style="width:70%;height:60px"></div>
       <div class="lade-balken" style="width:55%"></div>
     </div>`;
}

/* ==================== Städtensuche mit Autovervollständigung ================== */

const eingabe = $("sucheingabe");
const ergebnisliste = $("suchergebnisse");
const suchstatus = $("suchstatus");
let suchTimer = null;
let treffer = [];
let aktiverIndex = -1;

function schliesseVorschlaege() {
  ergebnisliste.hidden = true;
  eingabe.setAttribute("aria-expanded", "false");
  aktiverIndex = -1;
}

/** Ergebnisliste neu malen; gleichnamige Orte zeigen Bundesland + Land. */
function zeigeVorschlaege(orte) {
  treffer = orte;
  ergebnisliste.innerHTML = "";
  if (orte.length === 0) {
    schliesseVorschlaege();
    suchstatus.textContent = "Keine Stadt gefunden. Bitte Namen prüfen (ab 2 Zeichen).";
    suchstatus.classList.remove("fehler");
    return;
  }
  orte.forEach((ort, i) => {
    const li = document.createElement("li");
    li.id = `vorschlag-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    const name = document.createElement("span");
    name.className = "ort-name";
    name.textContent = ort.name;
    const kontext = document.createElement("span");
    kontext.className = "ort-kontext";
    kontext.textContent = [ort.admin1, ort.country].filter(Boolean).join(", ");
    li.append(name, kontext);
    li.addEventListener("click", () => ortAuswaehlen(ort));
    ergebnisliste.appendChild(li);
  });
  ergebnisliste.hidden = false;
  eingabe.setAttribute("aria-expanded", "true");
  suchstatus.textContent = `${orte.length} Vorschlag${orte.length === 1 ? "" : "e"} gefunden – mit Pfeiltasten auswählen.`;
  suchstatus.classList.remove("fehler");
}

function setzeAktivenIndex(i) {
  const elemente = [...ergebnisliste.children];
  elemente.forEach((el, j) => el.setAttribute("aria-selected", String(j === i)));
  aktiverIndex = i;
  if (i >= 0) {
    eingabe.setAttribute("aria-activedescendant", `vorschlag-${i}`);
    elemente[i]?.scrollIntoView({ block: "nearest" });
  } else {
    eingabe.removeAttribute("aria-activedescendant");
  }
}

async function fuehreSucheAus() {
  const begriff = eingabe.value;
  if (begriff.trim().length < 2) {
    schliesseVorschlaege();
    suchstatus.textContent = "Bitte mindestens 2 Zeichen eingeben.";
    return;
  }
  suchstatus.textContent = "Suche läuft …";
  try {
    const orte = await staedteSuchen(begriff);
    zeigeVorschlaege(orte);
  } catch (fehler) {
    schliesseVorschlaege();
    suchstatus.textContent = fehler.message;
    suchstatus.classList.add("fehler");
  }
}

function ortAuswaehlen(ort) {
  eingabe.value = ort.name;
  schliesseVorschlaege();
  suchstatus.textContent = "";
  ortLaden(ort);
}

/* Eingabe mit Tippen (Debounce 350 ms) und Tastatursteuerung */
eingabe.addEventListener("input", () => {
  clearTimeout(suchTimer);
  suchTimer = setTimeout(fuehreSucheAus, 350);
});
eingabe.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!ergebnisliste.hidden) setzeAktivenIndex(Math.min(aktiverIndex + 1, treffer.length - 1));
    else fuehreSucheAus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!ergebnisliste.hidden) setzeAktivenIndex(Math.max(aktiverIndex - 1, 0));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (aktiverIndex >= 0 && treffer[aktiverIndex]) ortAuswaehlen(treffer[aktiverIndex]);
    else if (treffer.length === 1) ortAuswaehlen(treffer[0]);
    else fuehreSucheAus();
  } else if (e.key === "Escape") {
    schliesseVorschlaege();
  }
});
$("suchen-knopf").addEventListener("click", fuehreSucheAus);
// Klicks außerhalb der Suche blenden die Vorschläge aus
document.addEventListener("click", (e) => {
  if (!$("suchfeld").contains(e.target)) schliesseVorschlaege();
});

/* ================================ Favoriten =============================== */

function favoritenNeu() {
  favoriten.zeigeFavoriten($("favoritenliste"), ortAuswaehlen, favoritenNeu);
}
$("favorit-hinzufuegen").addEventListener("click", () => {
  if (!zustand.ort) {
    suchstatus.textContent = "Bitte zuerst eine Stadt suchen, dann kann sie gemerkt werden.";
    return;
  }
  if (favoriten.fuelleHinzu(zustand.ort)) favoritenNeu();
});

/* ============================ Wetterdaten laden =========================== */

async function ortLaden(ort) {
  zustand.ort = ort;
  zustand.tagIndex = 0;
  zustand.zeitraum = "tag";
  localStorage.setItem(SCHLUESSEL_LETZTER_ORTE, JSON.stringify(ort));
  // Ort auch in die Adresszeile schreiben: Beim erneuten Öffnen (PWA-Neustart,
  // Lesezeichen, geteilter Link) erscheint er dadurch sofort wieder.
  try {
    const markierung = encodeURIComponent(`${ort.name}|${ort.lat}|${ort.lon}`);
    history.replaceState(null, "", `?ort=${markierung}${location.hash || ""}`);
  } catch { /* egal */ }
  eingabe.value = ort.name;
  statusAnzeigen("");
  ladeAnzeigeZeigen();
  $("tagesspule").innerHTML = '<div class="skelett"><div class="lade-balken" style="width:900px;height:84px"></div></div>';
 $("diagramm-bereich").hidden = true;
  zeigeZeitraumKnopfe();

  try {
    // Vorhersage und Ensemble parallel laden; Ensemble-Ausfall ist kein Abbruch.
    const [vorhersage, ensemble] = await Promise.all([
      vorhersageLaden(ort.lat, ort.lon),
      ensembleUnsicherheitLaden(ort.lat, ort.lon),
    ]);
    zustand.vor = vorhersage;
    zustand.ens = ensemble;
    zeigeAlles();
  } catch (fehler) {
    zustand.vor = null;
    $("aktuell-inhalt").innerHTML =
      '<p class="hinweis">Keine Daten geladen.</p>';
    statusAnzeigen(fehler.message, { wiederholen: () => ortLaden(ort) });
  }
}

/* ====================== Aktuelles Wetter (Karte oben) ===================== */

function zeigeAktuell() {
  const vor = zustand.vor, c = vor.current;
  const zustandWetter = wetterzustand(c.weather_code);
  const ortsName = [zustand.ort.name, zustand.ort.admin1, zustand.ort.country]
    .filter(Boolean).join(", ");
  const uhrzeit = formatiereOrtszeit(c.time,
    { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  $("aktuell-inhalt").innerHTML = `
    <div class="aktuell-kopf">
      <p class="aktuell-ort">${ortsName}</p>
      <span class="aktuell-zeit">Ortszeit: ${uhrzeit}</span>
    </div>
    <div class="aktuell-haupt">
      <span class="aktuell-symbol" aria-hidden="true">${zustandWetter.symbol}</span>
      <span class="aktuell-temp">${zahl(c.temperature_2m, 0)}<span class="grad">°C</span></span>
      <span class="aktuell-zustaende">
        <span class="aktuell-zustand">${zustandWetter.text}</span>
        <span class="aktuell-gefuehlt">Gefühlt ${temperatur(c.apparent_temperature)}</span>
      </span>
    </div>
    <div class="aktuell-details">
      <span>💨 Wind: <strong>${zahl(c.wind_speed_10m * 3.6, 0)}&nbsp;km/h</strong> aus&nbsp;${kompassrichtung(c.wind_direction_10m)}</span>
      <span>🌬 Böen: <strong>${zahl(c.wind_gusts_10m * 3.6, 0)}&nbsp;km/h</strong></span>
      <span>🌧 Niederschlag: <strong>${zahl(c.precipitation, 1)}&nbsp;mm</strong></span>
      <span>🔽 Luftdruck: <strong>${zahl(c.surface_pressure, 0)}&nbsp;hPa</strong></span>
    </div>`;

  $("zuletzt-aktualisiert").textContent =
    ` · Zuletzt aktualisiert: ${new Date().toLocaleTimeString("de-DE")} Uhr`;
}

/* ============================ Tagesspule & Zeitraum ======================== */

function zeigeTagesAuswahl() {
  const spule = $("tagesspule");
  spule.innerHTML = "";
  const tage = zustand.vor.daily.time;
  tage.forEach((tag, i) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "tag-chip";
    knopf.setAttribute("role", "tab");
    knopf.setAttribute("aria-selected", String(i === zustand.tagIndex));
    const zustandWetter = wetterzustand(zustand.vor.daily.weather_code[i]);
    const wochentag = formatiereOrtszeit(tag, { weekday: "short" });
    const datum = formatiereOrtszeit(tag, { day: "2-digit", month: "2-digit" });
    knopf.innerHTML =
      `<span class="tag-name">${i === 0 ? "Heute" : wochentag}</span>
       <span class="tag-symbol" aria-hidden="true">${zustandWetter.symbol}</span>
       <span class="tag-temp">${zahl(zustand.vor.daily.temperature_2m_max[i], 0)}° / ${zahl(zustand.vor.daily.temperature_2m_min[i], 0)}°</span>
       <span class="tag-temp">${datum}</span>`;
    knopf.title = `${zustandWetter.text} · ${[zustand.vor.daily.temperature_2m_min[i], zustand.vor.daily.temperature_2m_max[i]].map(t => zahl(t, 0)).join("…")} °C`;
    knopf.addEventListener("click", () => {
      zustand.tagIndex = i;
      zustand.zeitraum = "tag";
      zeigeTagesAuswahl();
      zeigeZeitraumKnopfe();
      zeigeCharts();
    });
    spule.appendChild(knopf);
  });
}

function zeigeZeitraumKnopfe() {
  document.querySelectorAll(".zeitraum-knopf").forEach((kn) =>
    kn.setAttribute("aria-pressed", String(kn.dataset.zeitraum === zustand.zeitraum)));
}
document.querySelectorAll(".zeitraum-knopf").forEach((kn) =>
  kn.addEventListener("click", () => {
    zustand.zeitraum = kn.dataset.zeitraum;
    zeigeZeitraumKnopfe();
    zeigeCharts();
  }));

/* ========================= Chart-Daten zusammenbauen ======================= */

/** Y-Achsen-Daten des Ensembles (täglich) per Tagesschlüssel herausschneiden. */
function taeglichSchneide(spanne, tage) {
  if (!spanne) return { p10: null, p90: null };
  const p10 = [], p90 = [];
  for (const tag of tage) {
    const i = spanne.tage.indexOf(tag);
    p10.push(i >= 0 ? spanne.p10[i] : null);
    p90.push(i >= 0 ? spanne.p90[i] : null);
  }
  return { p10, p90 };
}

/** Stundenwerte des Ensembles auf einen Kalendertag beschneiden. */
function stuendlichSchneide(spanne, praefix) {
  if (!spanne) return { p10: null, p90: null };
  const p10 = [], p90 = [];
  const zeiten = zustand.ens.stuendlich.zeit;
  for (let i = 0; i < zeiten.length; i++) {
    if (zeiten[i].startsWith(praefix)) { p10.push(spanne.p10[i]); p90.push(spanne.p90[i]); }
  }
  return { p10, p90 };
}

function zeigeCharts() {
  const chartsBereich = $("diagramm-bereich");
  if (!zustand.vor) { chartsBereich.hidden = true; return; }
  chartsLoeschen();
  chartsBereich.hidden = false;

  const taeglich = zustand.vor.daily;
  const stuendlich = zustand.vor.hourly;
  const ens = zustand.ens;
  let hinweis = "";

  if (zustand.zeitraum === "tag") {
    /* -------- Ansicht: ausgewählter Tag, stündliche Werte -------- */
    const tag = taeglich.time[zustand.tagIndex];
    if (!tag) {
      statusAnzeigen("Für den gewählten Tag sind keine Daten verfügbar.");
      chartsBereich.hidden = true;
      return;
    }
    const i0 = stuendlich.time.findIndex((t) => t.startsWith(tag));
    const werte = (felder) => felder.map((f) => {
      const schnitt = [];
      for (let i = i0; i < i0 + 24 && i < stuendlich.time.length; i++) schnitt.push(stuendlich[f][i]);
      return schnitt;
    });
    const [temp, regen, windMs, windRichtung, regenWhr, wolken] = werte(
      ["temperature_2m", "precipitation", "wind_speed_10m", "wind_direction_10m",
       "precipitation_probability", "cloud_cover"]);
    const wind = windMs.map((v) => (v == null ? null : Math.round(v * 36) / 10)); // m/s → km/h
    const labels = temp.map((_, k) => `${String(k).padStart(2, "0")}:00`);
    // Handys/Querformat: schmaler 6-Stunden-Ausschnitt ums aktuelle Geschehen,
    // übrige Stunden per Wischen erreichbar (siehe charts.js).
    const istHeute = tag === taeglich.time[0];
    // Aktuelle Stunde am Ort (en-US liefert exakt "00"–"23"; de-DE hänge " Uhr" an!)
    const stundeJetzt = Number(new Intl.DateTimeFormat("en-US",
      { timeZone: zustand.vor.timezone, hour: "2-digit", hour12: false }).format(new Date())) % 24;
    const ausschnitt = { groesse: 7, start: istHeute ? Math.max(0, stundeJetzt - 3) : 0 };

    const ensTag = ens ? {
      temp: stuendlichSchneide(ens.stuendlich.temperatur, tag),
      wind: stuendlichSchneide(ens.stuendlich.wind, tag),
      regen: stuendlichSchneide(ens.stuendlich.niederschlag, tag),
    } : null;

    // Kombinations-Diagramm: Temperatur (orange/cyan) + Niederschlag (dunkelblau, rechte Achse)
    zeigeChart("diagramm-temperatur", {
      labels, yTitel: "°C", y1Titel: "mm", bewoelkung: { werte: wolken }, ausschnitt,
      hauptreihen: [
        { label: "Lufttemperatur", werte: temp, typ: "linie", farbe: FARBEN.temperaturMax,
          einheit: "°C", vorzeichen: true },
        { label: "Niederschlag", werte: regen, typ: "balken", farbe: FARBEN.regen, einheit: "mm",
          yAchse: "y1", blitz: true,
          nachweis: (i) => regenWhr[i] != null ? `Regenwahrscheinlichkeit: ${zahl(regenWhr[i], 0)} %` : null },
      ],
      baender: ensTag ? [
        { name: "Temperatur", p10: ensTag.temp.p10, p90: ensTag.temp.p90, farbe: FARBEN.temperaturMax, einheit: "°C" },
        { name: "Niederschlag", p10: ensTag.regen.p10, p90: ensTag.regen.p90, farbe: FARBEN.regen, einheit: "mm", yAchse: "y1" },
      ] : [],
    });
    zeigeChart("diagramm-wind", {
      labels, yTitel: "km/h", beiNull: true, windAchsen: true, ausschnitt,
      windrichtung: { werte: windRichtung },
      hauptreihen: [{ label: "Wind in 10 m Höhe", werte: wind, typ: "linie", farbe: FARBEN.wind, einheit: "km/h" }],
      baender: ensTag ? [{ name: "Wind", p10: ensTag.wind.p10, p90: ensTag.wind.p90, farbe: FARBEN.wind, einheit: "km/h" }] : [],
    });
  } else {
    /* -------- Ansicht: 3 Tage / 1 Woche / bis 16 Tage (täglich) -------- */
    const anzahl = Number(zustand.zeitraum);
    const verfuegbar = taeglich.time.length;
    if (verfuegbar === 0) {
      statusAnzeigen("Für diesen Zeitraum sind keine Daten verfügbar.");
      chartsBereich.hidden = true;
      return;
    }
    const tage = taeglich.time.slice(0, anzahl);
    // Bei 16 Tagen startet das Diagramm mit 6 Tagen als Ausschnitt (wischbar).
    const ausschnittTage = anzahl >= 12 ? { groesse: 6, start: 0 } : undefined;
    const kuerzel = tage.map((t) =>
      `${formatiereOrtszeit(t, { weekday: "short" })} ${formatiereOrtszeit(t, { day: "2-digit", month: "2-digit" })}`);
    const schnitt = (feld) => taeglich[feld].slice(0, anzahl);
    const tmax = schnitt("temperature_2m_max");
    const tmin = schnitt("temperature_2m_min");
    const windMax = schnitt("wind_speed_10m_max")
      .map((v) => (v == null ? null : Math.round(v * 36) / 10)); // m/s → km/h
    const windRichtung = schnitt("wind_direction_10m_dominant");
    const regen = schnitt("precipitation_sum");
    const regenWhr = schnitt("precipitation_probability_max");
    const wolken = schnitt("cloud_cover_mean");

    const ensT = ens ? {
      tmax: taeglichSchneide(ens.taeglich.temperaturMax, tage),
      tmin: taeglichSchneide(ens.taeglich.temperaturMin, tage),
      wind: taeglichSchneide(ens.taeglich.windMax, tage),
      regen: taeglichSchneide(ens.taeglich.niederschlagSumme, tage),
    } : null;

    // Kombinations-Diagramm: Max/Min (ebenfalls vorzeichen-gefärbt) + Niederschlag
    zeigeChart("diagramm-temperatur", {
      labels: kuerzel, yTitel: "°C", y1Titel: "mm/Tag", bewoelkung: { werte: wolken },
      hauptreihen: [
        { label: "Tagesmaximum", werte: tmax, typ: "linie", farbe: FARBEN.temperaturMax,
          einheit: "°C", vorzeichen: true, punktstil: "circle" },
        { label: "Tagesminimum", werte: tmin, typ: "linie", farbe: FARBEN.temperaturMin,
          einheit: "°C", vorzeichen: true, punktstil: "triangle" },
        { label: "Niederschlagssumme", werte: regen, typ: "balken", farbe: FARBEN.regen, einheit: "mm",
          yAchse: "y1", blitz: true,
          nachweis: (i) => regenWhr[i] != null ? `Regenwahrscheinlichkeit: ${zahl(regenWhr[i], 0)} %` : null },
      ],
      baender: ensT ? [
        { name: "Maximum", p10: ensT.tmax.p10, p90: ensT.tmax.p90, farbe: FARBEN.temperaturMax, einheit: "°C" },
        { name: "Minimum", p10: ensT.tmin.p10, p90: ensT.tmin.p90, farbe: FARBEN.temperaturMin, einheit: "°C" },
        { name: "Niederschlag", p10: ensT.regen.p10, p90: ensT.regen.p90, farbe: FARBEN.regen, einheit: "mm", yAchse: "y1" },
      ] : [],
    });
    zeigeChart("diagramm-wind", {
      labels: kuerzel, yTitel: "km/h", beiNull: true, windAchsen: true,
      windrichtung: { werte: windRichtung },
      hauptreihen: [{ label: "Tagesmaximum Wind", werte: windMax, typ: "linie", farbe: FARBEN.wind, einheit: "km/h" }],
      baender: ensT ? [{ name: "Wind", p10: ensT.wind.p10, p90: ensT.wind.p90, farbe: FARBEN.wind, einheit: "km/h" }] : [],
    });

    if (anzahl > verfuegbar) {
      hinweis = `Hinweis: Daten liegen derzeit nur für ${verfuegbar} Tage vor (gewünscht: ${anzahl}).`;
    }
  }

  if (!zustand.ens) {
    hinweis = (hinweis ? hinweis + " " : "") +
      "Es sind keine Unsicherheitsangaben verfügbar – die Ensemble-Datenquelle war nicht erreichbar. " +
      "Die Linien/Balken zeigen dann ausschließlich das bestimmte Modell.";
  }
  $("zeitraum-hinweis").textContent = hinweis;
}

/* ============================== Gesamtdarstellung ========================== */

function zeigeAlles() {
  if (!zustand.vor) return;
  statusAnzeigen("");
  zeigeAktuell();
  zeigeTagesAuswahl();
  zeigeZeitraumKnopfe();
  zeigeCharts();
  // Hintergrund-Kulisse passend zum aktuellen Wetter (Tag/Nacht, Regen, Sonne …)
  try { wetterKulisseAnwenden(zustand.vor.current); } catch { /* nur Deko */ }
  // Elch-Bild unter dem blauen Kopf (nur Deko, Fehler bleiben lokal)
  try { elchAktualisieren(zustand.vor); } catch { /* nur Bild */ }
  // Sekundärbereiche (beeinflussen die Hauptdiagramme nicht, Fehler bleiben lokal)
  try { zeigeTagesAussicht(zustand.vor); } catch { /* nur Textbaustein */ }
  try { zeigeSonneMond(zustand.vor); } catch { /* nur Textbaustein */ }
  zeigeMeerChips();
  waehleNaechstenPegel(zustand.ort);
  ladeDwdAnzeige(zustand.ort);   // DWD-Warnungen + Messstation (asynchron, stört nicht)
}

/* ==================== Meeres-Chips (Wasser, Welle, Feuchte) ================ */

/*
 * Drei Kennzahlen direkt oberhalb der Vorhersage: Wassertemperatur und
 * Wellenhöhe kommen von MET Norway (Oceanforecast 2.0, norwegische
 * Qualitätsmodelle TOPAZ/SKAGGERRAK + WAVEWATCHIII), die Luftfeuchte aus
 * der laufenden Open-Meteo-Vorhersage. Gibt es keine Meeresdaten (ganz
 * ohne Küstenbezug und ohne Marine-Fallback), zeigt die App nur die
 * Luftfeuchte – erfunden wird nichts.
 */
async function zeigeMeerChips() {
  const feld = $("meer-chips");
  const c = zustand.vor?.current;
  const ort = zustand.ort;
  if (!feld || !c) return;

  const feuchte = c.relative_humidity_2m != null
    ? `<span class="meer-chip" title="Relative Luftfeuchte direkt in Bodennähe">` +
      `💧 <span class="chip-label">Luftfeuchte</span> <strong>${zahl(c.relative_humidity_2m, 0)}&nbsp;%</strong></span>`
    : "";
  feld.hidden = false;
  feld.innerHTML = feuchte +
    `<span class="meer-chip meer-chip-ladeend" aria-hidden="true">🌊 <span class="chip-label">Wasser &amp; Welle</span> <strong>…</strong></span>`;

  const meer = await meerDatenLaden(ort.lat, ort.lon).catch(() => null);
  // Falls zwischenzeitlich eine andere Stadt geladen wurde: nichts altes übermalen.
  if (zustand.ort !== ort) return;
  let meerChip = "";
  if (meer) {
    const wasser = meer.wasserC != null
      ? `🌡️ <span class="chip-label">Wassertemperatur</span> <strong>${zahl(meer.wasserC, 1)}&nbsp;°C</strong>`
      : "";
    const welle = meer.welleM != null
      ? `🌊 <span class="chip-label">Wellenhöhe</span> <strong>${zahl(meer.welleM, 1)}&nbsp;m</strong>` +
        (meer.welleAusGrad != null ? ` aus ${kompassrichtung(meer.welleAusGrad)}` : "")
      : "";
    const herkunft = `Quelle: ${meer.quelle} · Stand: ${meer.zeit ? new Date(meer.zeit).toLocaleString("de-DE") : "unbekannt"}`;
    // Beides in EINE Chips-Box, aber untereinander (zweizeilig) – sonst ragt
    // die lange Kombination im Hochformat über den Bildschirmrand.
    if (wasser || welle) {
      const zeile = (inhalt) => `<span class="chip-zeile">${inhalt}</span>`;
      meerChip = `<span class="meer-chip" title="${herkunft}">` +
        (wasser ? zeile(wasser) : "") + (welle ? zeile(welle) : "") + `</span>`;
    }
  }
  feld.innerHTML = feuchte + meerChip;
  feld.hidden = !meerChip && !feuchte;
}

/* =============================== Start beim Laden ========================== */

/** Gespeicherten Ort aus der Adresszeile lesen: ?ort=Name|lat|lon */
function ortAusUrl() {
  try {
    const roh = new URLSearchParams(location.search).get("ort");
    if (!roh) return null;
    const [name, lat, lon] = roh.split("|");
    const b = Number(lat), l = Number(lon);
    if (!name || !Number.isFinite(b) || !Number.isFinite(l)) return null;
    return { name, lat: b, lon: l };
  } catch { return null; }
}

function initialisieren() {
  favoritenNeu();
  ROUTEanwenden();
  initialisiereGezeiten();

  // Zuletzt gewählte Stadt wiederherstellen – in dieser Reihenfolge:
  // 1) Ort aus der Adresszeile (Lesezeichen/geteilter Link/PWA-Neustart),
  // 2) lokaler Speicher des Browsers, 3) erster Favorit.
  let letzter = ortAusUrl();
  if (!letzter) {
    try {
      const gespeichert = JSON.parse(localStorage.getItem(SCHLUESSEL_LETZTER_ORTE));
      if (gespeichert?.lat != null && gespeichert.name) letzter = gespeichert;
    } catch { /* defekte Daten ignorieren */ }
  }
  if (!letzter) {
    const merks = favoriten.leseFavoriten();
    if (merks.length) letzter = merks[0];
  }
  if (letzter) ortLaden(letzter);
}
initialisieren();
