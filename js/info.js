/**
 * info.js – Sekundäre Informationsbereiche der Übersichtsseite:
 *  · „Aussichten für heute“       (aus den echten Tages-/Stundenwerten)
 *  · Sonne & Mond                 (Sunrise/Sunset, Mondauf/-untergang, Phase)
 *  · Ebbe & Flut                  (amtliche BSH-Gezeitenvorausberechnung)
 */

import { gezeitenPegelLaden, gezeitenLaden, bshGdiPegelLaden, bshGdiLaden, wasserstandLaden, tideAuslesen, GEZEITEN_STATIONEN } from "./api.js";
import { wetterzustand, kompassrichtung, zahl, bftAusMs } from "./wmo.js";

const $ = (id) => document.getElementById(id);

/* ------------------------- Aussichten für heute ---------------------------- */

/** Stundenwerte des Tages i (Index in daily.time) aus der Stundenreihe herausschneiden. */
function stundenDesTages(vor, i) {
  const tag = vor.daily.time[i];
  const ureihe = vor.hourly?.time ?? [];
  const bereich = [];
  ureihe.forEach((t, k) => { if (t.startsWith(tag)) bereich.push(k); });
  return bereich;
}

/** Aus Vorhersage + Ensemblemitteln einen gut lesbaren Tagestext bauen. */
export function zeigeTagesAussicht(vor) {
  const feld = $("heute-aussicht");
  const d = vor.daily;
  if (!d?.time?.length) { feld.innerHTML = '<span class="hinweis">Keine Tageswerte verfügbar.</span>'; return; }

  const i = 0; // heute
  const wetter = wetterzustand(d.weather_code[i]);
  const stunden = stundenDesTages(vor, i);
  const h = vor.hourly ?? {};
  const boen = stunden.map((k) => h.wind_gusts_10m?.[k]).filter((v) => v != null);
  const boeMax = boen.length ? Math.max(...boen) : null;
  const bf = bftAusMs(boeMax ?? d.wind_speed_10m_max[i]);
  const datum = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit" });

  const teile = [
    `Heute, ${datum}: ${wetter.text.toLowerCase()}, ${zahl(d.temperature_2m_min[i], 0)}…${zahl(d.temperature_2m_max[i], 0)} °C.`,
  ];
  const regen = d.precipitation_sum[i], chance = d.precipitation_probability_max[i];
  teile.push(regen > 0.05
    ? `Niederschlag rund ${zahl(regen, 1)} mm${chance != null ? ` (${zahl(chance, 0)} % Chance)` : ""}.`
    : "Weitgehend trocken.");
  if (d.wind_speed_10m_max[i] != null) {
    teile.push(`Wind aus ${kompassrichtung(d.wind_direction_10m_dominant[i])} bis ${zahl(d.wind_speed_10m_max[i])} m/s` +
      (boeMax != null ? `, Böen bis ${zahl(boeMax)} m/s` : "") +
      (bf != null ? ` (Bft ${bf})` : "") + ".");
  }
  if (d.uv_index_max?.[i] != null) teile.push(`UV-Index max. ${zahl(d.uv_index_max[i], 1)}.`);
  if (d.sunshine_duration?.[i] != null) {
    teile.push(`Sonne ca. ${zahl(d.sunshine_duration[i] / 3600, 1)} h.`);
  }
  feld.textContent = teile.join(" ");
}

/* ----------------------------- Sonne & Mond -------------------------------- */

/** moon_phase (0…<1): 0 Neumond, 0,5 Vollmond → Symbol + Name. */
function mondphase(wert) {
  const phasen = [
    ["🌑", "Neumond"], ["🌒", "zunehmende Sichel"], ["🌓", "erstes Viertel"], ["🌔", "zunehmender Mond"],
    ["🌕", "Vollmond"], ["🌖", "abnehmender Mond"], ["🌗", "letztes Viertel"], ["🌘", "abnehmende Sichel"],
  ];
  const idx = Math.round((wert % 1) * 8) % 8;
  return { symbol: phasen[idx][0], name: phasen[idx][1] };
}

const UHRZEIT = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
function uhr(isoLokal) {
  if (!isoLokal) return "–";
  const d = new Date(isoLokal);
  return isNaN(d) ? "–" : UHRZEIT.format(d);
}

export function zeigeSonneMond(vor) {
  const feld = $("sonne-mond-inhalt");
  const d = vor.daily;
  if (!d?.sunrise?.length) { feld.innerHTML = '<span class="hinweis">Keine Sonnen-/Monddaten.</span>'; return; }
  const mond = mondphase(d.moon_phase?.[0] ?? 0);
  const zeile = (bezeichnung, inhalt) =>
    `<div class="info-zeile"><dt>${bezeichnung}</dt><dd>${inhalt}</dd></div>`;
  feld.innerHTML = `
    <dl class="info-liste">
      ${zeile("Sonnenaufgang", uhr(d.sunrise[0]))}
      ${zeile("Sonnenuntergang", uhr(d.sunset[0]))}
      ${zeile("Mondaufgang", uhr(d.moonrise?.[0]))}
      ${zeile("Monduntergang", uhr(d.moonset?.[0]))}
      ${zeile("Mondphase", `<span class="mond-wein" aria-hidden="true">${mond.symbol}</span> ${mond.name}`)}
    </dl>`;
}

/* ------------------------------ Ebbe & Flut -------------------------------- */

const STANDARD_PEGEL_GDI = "husum_schleuse";   // BSH-Datenportal (läuft überall)
const STANDARD_PEGEL_PROXY = "510P";           // Heim-Proxy (dev-server.py)
let gezeitenPegel = [];

function naechsterPegel(lat, lon) {
  let bester = null, besteEntfernung = Infinity;
  for (const p of gezeitenPegel) {
    const d = Math.hypot((p.lat - lat) * 111.4, (p.lon - lon) * 65);
    if (d < besteEntfernung) { besteEntfernung = d; bester = p; }
  }
  return besteEntfernung <= 120 ? bester : null; // nur bei echtem Küstenbezug umschalten
}

const TID_UHRZEIT = new Intl.DateTimeFormat("de-DE",
  { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const TID_STAND = new Intl.DateTimeFormat("de-DE",
  { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function tidenListe(eintraege) {
  const li = (t, zuerst) => `
    <li class="${zuerst ? "tiden-jetzt" : ""}">
      <span><span class="tiden-typ ${t.typ}">${t.typ === "hoch" ? "⬆ Flut" : "⬇ Ebbe"}</span>
      ${TID_UHRZEIT.format(t.zeit)}</span>
      <span>${t.cm} cm</span>
    </li>`;
  return `<ul class="tidenliste">${eintraege.map((t, i) => li(t, i === 0)).join("")}</ul>`;
}

async function ladeTiden(schluessel) {
  const feld = $("gezeiten-inhalt");
  feld.innerHTML = '<span class="hinweis">Tiden werden geladen …</span>';
  const pegel = gezeitenPegel.find((p) => p.schluessel === schluessel);
  if (!pegel) { feld.innerHTML = '<span class="hinweis">Pegel nicht gefunden.</span>'; return; }

  // ---- 1) Amtlich über das offene BSH-Datenportal (funktioniert überall) ----
  let daten = null;
  if (pegel.gdiId) {
    try { daten = await bshGdiLaden(pegel.gdiId); } catch { daten = null; }
  }
  // ---- 2) Amtlich über die Datei-API (nur mit Heim-Proxy erreichbar) --------
  if (!daten && pegel.bshnr) {
    try { daten = await gezeitenLaden(pegel); } catch { daten = null; }
  }
  if (daten?.tide?.length) {
    const stand = daten.vorhersageStand
      ? ` · Vorhersage-Stand: ${TID_STAND.format(new Date(daten.vorhersageStand.replace(" ", "T")))}` : "";
    const offline = daten.offline
      ? `<br><span class="tide-naeherung">🟠 Amtliche Werte aus dem Offline-Zwischenspeicher der App – `
        + `für aktuelle Tiden wieder mit dem Internet verbinden.</span>` : "";
    feld.innerHTML = `
      ${tidenListe(daten.tide)}
      <p class="hinweis">Höhen über ${daten.referenz} · ${daten.station}${stand} ·
        <a href="${daten.pegelLink}" rel="noopener" target="_blank">beim BSH öffnen</a>${offline}</p>`;
    return;
  }

  // ---- 3) Letzter Ausweg: Copernikus-Meeresspiegel-Modell (Open-Meteo) ------
  feld.innerHTML = '<span class="hinweis">Amtliche Tiden nicht erreichbar – Modell-Näherung wird geladen …</span>';
  try {
    const modell = await tideAusModell(pegel.lat, pegel.lon);
    if (modell.length) {
      feld.innerHTML = `
        ${tidenListe(modell)}
        <p class="hinweis tide-naeherung">⚠️ <strong>Modell-Näherung</strong> (Copernikus-Meeresspiegel,
          Höhe über mittlerem Meeresspiegel) – keine amtliche Gezeitentafel.
          Amtliche Werte: <a href="https://gdi.bsh.de/" rel="noopener" target="_blank">gdi.bsh.de</a>
          (Pegel: ${pegel.name}).</p>`;
      return;
    }
  } catch { /* gleich mit Hinweis */ }
  feld.innerHTML = '<span class="hinweis">Gezeitendaten derzeit nicht erreichbar – weder amtlich (BSH) ' +
    'noch als Modell. Bitte <a href="https://gezeiten.bsh.de/" rel="noopener" target="_blank">gezeiten.bsh.de</a> ' +
    'direkt öffnen.</span>';
}

/** Nächste Hoch-/Niedrigwasser aus der Meeresmodell-Reihe (Fallback). */
async function tideAusModell(lat, lon) {
  const { zeit, wert } = await wasserstandLaden(lat, lon, 72);
  const extrem = tideAuslesen(zeit, wert, 0.18);
  const jetzt = Date.now();
  return extrem
    .map((e) => ({ zeit: new Date(e.zeit), typ: e.typ, cm: Math.round(e.wert * 100) }))
    .filter((e) => e.zeit.getTime() > jetzt - 30 * 60 * 1000)
    .slice(0, 8);
}

/** Pegelauswahl aufbauen (einmalig) und erste Tiden laden. */
export async function initialisiereGezeiten() {
  const select = $("gezeiten-pegel");
  const feld = $("gezeiten-inhalt");
  if (gezeitenPegel.length) return;
  feld.innerHTML = '<span class="hinweis">Pegelliste wird geladen …</span>';

  // Reihenfolge: BSH-Datenportal (offline-Liste, überall nutzbar) →
  // Proxy-Liste (Heimnetz) → Notliste (nur Modellwerte).
  try { gezeitenPegel = (await bshGdiPegelLaden()) ?? []; } catch { gezeitenPegel = []; }
  let standard = STANDARD_PEGEL_GDI;
  if (!gezeitenPegel.length) {
    try { gezeitenPegel = (await gezeitenPegelLaden()) ?? []; } catch { gezeitenPegel = []; }
    standard = STANDARD_PEGEL_PROXY;
  }
  if (!gezeitenPegel.length) {
    gezeitenPegel = GEZEITEN_STATIONEN.map((s, i) => ({
      name: s.name + " (Modell)", lat: s.lat, lon: s.lon, modellNur: true, schluessel: "M" + i,
    }));
    standard = "M0";
  }
  gezeitenPegel = gezeitenPegel.map((p) => ({
    ...p, schluessel: p.schluessel ?? p.gdiId ?? p.bshnr,
  }));

  const sortiert = [...gezeitenPegel].sort((a, b) => a.name.localeCompare(b.name, "de"));
  select.innerHTML = sortiert.map((p) => `<option value="${p.schluessel}">${p.name}</option>`).join("");
  select.value = [...select.options].some((o) => o.value === standard)
    ? standard : sortiert[0].schluessel;
  select.addEventListener("change", () => ladeTiden(select.value));
  ladeTiden(select.value);
}

/** Stadt hat Küstenbezug? Dann passenden Pegel automatisch vorauswählen. */
export function waehleNaechstenPegel(ort) {
  if (!gezeitenPegel.length) return;
  const pegel = naechsterPegel(ort.lat, ort.lon);
  const select = $("gezeiten-pegel");
  if (pegel && select.value !== pegel.schluessel &&
      [...select.options].some((o) => o.value === pegel.schluessel)) {
    select.value = pegel.schluessel;
    ladeTiden(pegel.schluessel);
  }
}
