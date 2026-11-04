/**
 * radar.js – Interaktive Regenradar-Karte (Leaflet + RainViewer-Kacheln).
 *
 * RainViewer stellt alle ~5 Minuten neue Radar-Frames der letzten Stunde bereit.
 * Wir zeigen alle Frames mit einem Zeitregler (Slider + Zeitraffer-Abspielknopf)
 * und kennzeichnen den Aufnahmezeitpunkt deutlich (UTC und lokal).
 *
 * Farbskala: offizielle RainViewer-Farbtabelle („Universal Blue“, Farbe 2),
 * dBZ-Werte = Reflektivität, höhere Werte stehen für stärkeren Niederschlag.
 */

import { radarDatenLaden, niederschlagVorschau } from "./api.js";

/* Offizielle Farbwerte aus https://www.rainviewer.com/api/color-schemes.html */
const LEGENDEN_FARBEN = [
  [15, "#88ddee"], [20, "#00a3e0"], [25, "#0077aa"], [30, "#005588"],
  [35, "#ffee00"], [40, "#ffaa00"], [45, "#ff4400"], [50, "#c10000"],
  [55, "#ffaaff"], [60, "#ff77ff"], [65, "#ffffff"],
];

const STANDARD_MITTE = [51.1, 10.2]; // Deutschlandmitte, falls kein Ort gewählt
const SPIEL_GESCHWINDIGKEIT = 750;   // ms pro Frame beim Zeitraffer

export function initialisiereRadar(aktuellenOrt) {
  const kartenDiv = document.getElementById("radar-karte");
  const hinweisDiv = document.getElementById("radar-hinweis");
  const hinweisText = document.getElementById("radar-hinweistext");
  const slider = document.getElementById("radar-slider");
  const abspielKnopf = document.getElementById("radar-abspielen");
  const zeitpunkt = document.getElementById("radar-zeitpunkt");
  const aktualisiert = document.getElementById("radar-aktualisiert");
  const legende = document.getElementById("radar-legende-skala");

  let karte = null;         // Leaflet-Kartenobjekt (wird erst bei Bedarf erzeugt)
  let overlay = null;       // aktuelle Regenkachel-Ebene
  let ortMarkierung = null; // roter Punkt für den gewählten Ort
  let frames = [];
  let timer = null;

  /* ------------------------- Legende (dBZ-Skala) ------------------------- */
  LEGENDEN_FARBEN.forEach(([, farbe]) => {
    const feld = document.createElement("span");
    feld.style.background = farbe === "#ffffff" ? `${farbe}ff` : farbe;
    feld.title = `Reflektivität ca. dBZ`;
    legende.appendChild(feld);
  });

  /* ------------------------------ Karte ---------------------------------- */
  function erzeugeKarte() {
    karte = L.map("radar-karte", { zoomControl: true, scrollWheelZoom: true });
    // Hintergrundkarte: offene OpenStreetMap-Kacheln (ohne API-Schluessel).
    // Per CSS-Filter entfärbt (Klasse basiskarte-dezent, nur Graustufen) –
    // Struktur und Küsten bleiben gut lesbar, der farbige Overlay sticht heraus.
    // Hinweis: OSM-Kacheln laut Nutzungsbed. nur bei moderatem Traffic;
    // Alternativen (z. B. eigener Tileserver) sind im README genannt.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      className: "basiskarte-dezent",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende · ' +
        'Regenradar: <a href="https://www.rainviewer.com/">RainViewer</a>',
    }).addTo(karte);

    const ort = aktuellenOrt();
    if (ort) {
      karte.setView([ort.lat, ort.lon], 7);
    } else {
      karte.setView(STANDARD_MITTE, 6);
    }
  }

  /** Kachel-Ebene für einen Frame austauschen. */
  function zeigeFrame(index) {
    if (!karte || !frames.length) return;
    index = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[index];

    if (overlay) karte.removeLayer(overlay);
    // Neues RainViewer-Kachelformat: {path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
    // Größe 512 bei angezeigter Kachelgröße 256 = scharf auf Retina-Displays,
    // Farbe 2 = „Universal Blue“, 1_0 = geglättet ohne Schneefarben.
    // Max. Datenzoom ist 7 – darüber werden die Kacheln nur hochskaliert.
    overlay = L.tileLayer(`${frame.url}/512/{z}/{x}/{y}/2/1_0.png`, {
      tileSize: 256, maxNativeZoom: 7, maxZoom: 12, opacity: 0.8,
    }).addTo(karte);

    // Aufnahmezeitpunkt deutlich anzeigen (RainViewer-Zeiten sind UTC)
    const zeit = new Date(frame.time * 1000);
    const utc = new Intl.DateTimeFormat("de-DE",
      { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(zeit);
    const lokal = new Intl.DateTimeFormat("de-DE",
      { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(zeit);
    zeitpunkt.innerHTML =
      `Radardaten vom <strong>${utc}&nbsp;UTC</strong> ` +
      `<span class="zeitpunkt-kurz">(lokal in Deutschland: ${lokal}&nbsp;Uhr)</span>`;
    slider.value = index;
  }

  /* --------------------- Frames laden & Steuerung ------------------------ */
  async function ladeRadar() {
    zeitpunkt.textContent = "Radardaten werden geladen …";
    try {
      const daten = await radarDatenLaden();
      frames = daten.frames.map((f) => ({ time: f.time, url: daten.host + f.path }));
      slider.min = "0";
      slider.max = String(frames.length - 1);
      // Neuester Frame = rechts auf dem Slider
      zeigeFrame(frames.length - 1);
      aktualisiert.textContent = ` · Zuletzt geladen: ${new Date().toLocaleTimeString("de-DE")} Uhr`;
      hinweisDiv.hidden = true;
      kartenDiv.hidden = false;
    } catch (fehler) {
      // Verständliche Meldung statt leerer Karte (z. B. Offline / Dienst gestört)
      frames = [];
      kartenDiv.hidden = true;
      hinweisDiv.hidden = false;
      hinweisText.textContent = fehler.message +
        " Die Regenradar-Karte steht wieder zur Verfügung, sobald der Dienst erreichbar ist.";
    }
  }

  slider.addEventListener("input", () => zeigeFrame(Number(slider.value)));

  function stoppe() {
    if (timer) { clearInterval(timer); timer = null; }
    abspielKnopf.textContent = "▶";
    abspielKnopf.setAttribute("aria-label", "Zeitraffer abspielen");
  }
  abspielKnopf.addEventListener("click", () => {
    if (timer) { stoppe(); return; }
    if (!frames.length) return;
    abspielKnopf.textContent = "⏸";
    abspielKnopf.setAttribute("aria-label", "Zeitraffer stoppen");
    timer = setInterval(() => {
      zeigeFrame((Number(slider.value) + 1) % frames.length);
    }, SPIEL_GESCHWINDIGKEIT);
  });

  /* ---------------- Modell-Vorschau (+1 h / +2 h) -------------------------- */
  /*
   * RainViewer liefert in der kostenlosen API keine Nowcast-Kacheln (Feld
   * "nowcast" ist leer). Die Vorschau baut daher sichtbar-transparent auf
   * echtem Modellniederschlag (Open-Meteo GFS, 1°-Raster) auf.
   */
  const vorschauKnopfe = {
    aus: document.getElementById("vorschau-aus"),
    1: document.getElementById("vorschau-1h"),
    2: document.getElementById("vorschau-2h"),
  };
  const vorschauHinweis = document.getElementById("vorschau-hinweis");
  let vorschauEbene = null;

  const UHRZEIT_KURZ = new Intl.DateTimeFormat("de-DE",
    { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

  function setzeVorschauKnopfe(modus) {
    Object.entries(vorschauKnopfe).forEach(([k, kn]) =>
      kn.setAttribute("aria-pressed", String(k === String(modus))));
  }

  /** Farbton grob nach Regenstärke (angelehnt an die RainViewer-Skala). */
  function farbeZuMmh(mmh) {
    if (mmh < 0.3) return "#88ddee";
    if (mmh < 1) return "#00a3e0";
    if (mmh < 2) return "#0077aa";
    if (mmh < 4) return "#ffee00";
    if (mmh < 8) return "#ffaa00";
    return "#ff4400";
  }

  async function zeigeVorschau(stunden) {
    setzeVorschauKnopfe(stunden ?? "aus");
    if (vorschauEbene) { karte.removeLayer(vorschauEbene); vorschauEbene = null; }
    if (!stunden) {
      vorschauHinweis.textContent = "Keine Vorhersage-Ebene aktiv.";
      return;
    }
    vorschauHinweis.textContent = "Modell-Vorschau wird geladen (wenige Sekunden) …";
    try {
      const zellen = await niederschlagVorschau(stunden);
      const uhrzeit = UHRZEIT_KURZ.format(new Date(Date.now() + stunden * 3600 * 1000));
      vorschauEbene = L.layerGroup(zellen.map((z) =>
        L.circle([z.lat, z.lon], {
          radius: 42000, stroke: false,
          fillColor: farbeZuMmh(z.mmh), fillOpacity: 0.55,
        }).bindTooltip(`≈ ${z.mmh.toFixed(1).replace(".", ",")} mm/h gegen ${uhrzeit} Uhr`,
          { direction: "top" })));
      vorschauEbene.addTo(karte);
      vorschauHinweis.innerHTML = zellen.length
        ? `Vorschau <strong>+${stunden} h</strong> (ca. ${uhrzeit} Uhr): ${zellen.length} Gebiete mit ` +
          `erwartetem Niederschlag. Modell GFS, ~1°-Raster – <strong>keine amtliche Nowcast</strong>.`
        : `Vorschau <strong>+${stunden} h</strong> (ca. ${uhrzeit} Uhr): Modell erwartet keinen nennenswerten Niederschlag (GFS).`;
    } catch (fehler) {
      vorschauHinweis.textContent = `Vorschau derzeit nicht verfügbar (${fehler.message}).`;
    }
  }

  vorschauKnopfe.aus.addEventListener("click", () => zeigeVorschau(null));
  vorschauKnopfe[1].addEventListener("click", () => zeigeVorschau(1));
  vorschauKnopfe[2].addEventListener("click", () => zeigeVorschau(2));

  /* --------------------- Sichtbarkeit / Lebenszyklus ----------------------- */
  let geladen = false;
  let letztesZentrum = "";
  return {
    /** Wird aufgerufen, wenn die Radar-Ansicht eingeblendet wird. */
    async zeige() {
      if (!karte) erzeugeKarte();
      // Zwischenzeitlich eine andere Stadt gewählt? → Karte dorthin bewegen.
      const ort = aktuellenOrt();
      const zentrum = ort ? `${ort.lat},${ort.lon}` : "";
      if (zentrum && zentrum !== letztesZentrum) {
        letztesZentrum = zentrum;
        karte.setView([ort.lat, ort.lon], 7);
        // Ortsmarkierung (roter Punkt) setzen bzw. mitziehen.
        const position = [ort.lat, ort.lon];
        if (ortMarkierung) {
          ortMarkierung.setLatLng(position);
        } else {
          ortMarkierung = L.marker(position, {
            icon: L.divIcon({ className: "ort-marker", iconSize: [18, 18], iconAnchor: [9, 9] }),
            title: ort.name ?? "Gewählter Ort",
            alt: ort.name ?? "Gewählter Ort",
            keyboard: false,
          }).addTo(karte);
        }
      }
      requestAnimationFrame(() => karte.invalidateSize());
      if (!geladen) { geladen = true; await ladeRadar(); }
      else if (frames.length) ladeRadar(); // bei erneutem Öffnen auffrischen
    },
    /** Beim Verlassen: Zeitraffer anhalten, damit nichts im Hintergrund läuft. */
    verstecke() { stoppe(); },
  };
}
