/**
 * api.js – Zugriff auf die freien Wetterdienste.
 *
 * Verwendete Quellen (alle ohne API-Schlüssel nutzbar, Details im README):
 *  1. Open-Meteo Geocoding   – Städtensuche mit Land/Region
 *  2. Open-Meteo Forecast    – aktueller Zustand, Stunden-/Tageswerte bis 16 Tage
 *  3. Open-Meteo Ensemble    – 30 GFS-Ensemble-Läufe → echte Prognoseunsicherheit
 *  4. RainViewer             – Radarkacheln und Frame-Zeitstempel
 *
 * Es werden keine Schlüssel benötigt, daher liegt auch nichts im Frontend offen.
 */

const BASIS_VORHERSAGE = "https://api.open-meteo.com/v1/forecast";
const BASIS_ENSEMBLE   = "https://ensemble-api.open-meteo.com/v1/ensemble";
const BASIS_GEOCODING  = "https://geocoding-api.open-meteo.com/v1/search";
const BASIS_RADAR_JSON = "https://api.rainviewer.com/public/weather-maps.json";

/** HTTP-Aufruf mit JSON-Auswertung und verständlichen Fehlermeldungen. */
async function holeJson(url) {
  let antwort;
  try {
    antwort = await fetch(url);
  } catch {
    throw new Error("Netzwerkverbindung fehlgeschlagen. Bitte Internetverbindung prüfen.");
  }
  if (!antwort.ok) {
    // Open-Meteo liefert den Grund im JSON-Feld "reason"
    let grund = `HTTP-Status ${antwort.status}`;
    try {
      const fehler = await antwort.json();
      if (fehler.reason) grund = fehler.reason;
    } catch { /* JSON unavailable */ }
    throw new Error(`Die Wetteranfrage ist fehlgeschlagen (${grund}).`);
  }
  return antwort.json();
}

/* ============================== 1. Geocoding ============================== */

/**
 * Städte-Suche. Suchbegriff muss mindestens 2 Zeichen lang sein.
 * @returns {Promise<Array<{name, admin1, country, lat, lon, timezone, bevoelkerung}>>}
 */
export async function staedteSuchen(begriff) {
  const schnipsel = begriff.trim();
  if (schnipsel.length < 2) return [];
  const url = `${BASIS_GEOCODING}?name=${encodeURIComponent(schnipsel)}` +
              `&count=10&language=de&format=json`;
  const daten = await holeJson(url);
  return (daten.results ?? []).map((r) => ({
    name: r.name,
    admin1: r.admin1 ?? "",      // Bundesland / Region
    country: r.country ?? "",    // Land
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone ?? "UTC",
    bevoelkerung: r.population ?? 0,
  }));
}

/* ============================ 2. Wetterdaten ============================== */

/**
 * Deterministische Vorhersage: aktuell + stündlich + täglich (bis 16 Tage).
 * Wind wird direkt in m/s angefragt (wind_speed_unit=ms).
 */
export async function vorhersageLaden(lat, lon) {
  const parameter = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m," +
             "precipitation,surface_pressure,weather_code,is_day," +
             "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "temperature_2m,precipitation,wind_speed_10m,wind_direction_10m," +
            "precipitation_probability,cloud_cover,wind_gusts_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum," +
           "precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant," +
           "cloud_cover_mean,sunrise,sunset,moon_phase,moonrise,moonset,uv_index_max,sunshine_duration",
    forecast_days: "16",
    wind_speed_unit: "ms",   // Meter pro Sekunde, wie in der Aufgabenstellung gefordert
    timezone: "auto",        // Zeiten in der Zeitzone des Ortes
  });
  return holeJson(`${BASIS_VORHERSAGE}?${parameter}`);
}

/* ========================= 3. Ensemble (Unsicherheit) ====================== */

/** Perzentil einer sortierbaren Zahlenliste (lineare Interpolation). */
function perzentil(werte, p) {
  const w = werte.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (w.length === 0) return null;
  const rang = (w.length - 1) * p;
  const tief = Math.floor(rang), hoch = Math.ceil(rang);
  return w[tief] + (w[hoch] - w[tief]) * (rang - tief);
}

/**
 * Prognoseunsicherheit aus dem GFS-Ensemble (30 Mitglieder).
 * Aus den stündlichen Mitglied-Werten werden pro Zeitraum P10/P90 berechnet:
 *  - stündlich: prozentile Spannen über alle Mitglieder (für Tagesansicht)
 *  - täglich:   pro Mitglied Tagesmax/-min, Summe bzw. Tagesmaximum bilden,
 *               dann P10/P90 über die Mitglieder (für 3/7/16-Tage-Ansicht)
 * Wind: Das Ensemble liefert km/h – so zeigen wir den Wind auch an.
 *
 * @returns {Promise<null | object>} null, falls keine Ensembledaten verfügbar.
 */
export async function ensembleUnsicherheitLaden(lat, lon) {
  const parameter = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: "temperature_2m,precipitation,wind_speed_10m",
    models: "gfs_seamless",
    forecast_days: "16",
    timezone: "auto",
  });
  let daten;
  try {
    daten = await holeJson(`${BASIS_ENSEMBLE}?${parameter}`);
  } catch {
    return null; // Ohne Ensembledaten zeigen wir die Charts ohne Unsicherheitsband
  }

  const stunden = daten.hourly?.time;
  if (!stunden?.length) return null;

  // Mitglieder je Variable sammeln (member01 … member30)
  function memberReihen(basisName) {
    return Object.keys(daten.hourly)
      .filter((k) => k.startsWith(basisName + "_member"))
      .map((k) => daten.hourly[k]);
  }
  const tempReihen  = memberReihen("temperature_2m");
  const regenReihen = memberReihen("precipitation");
  const windReihen = memberReihen("wind_speed_10m");   // bleibt in km/h – so zeigen wir den Wind an

  if (tempReihen.length < 3) return null; // zu wenige Mitglieder → keine Aussage

  // Y-Bezeichnung "2026-11-02" aus ISO-Stundenzeit "2026-11-02T14:00"
  const tagesSchluessel = stunden.map((t) => t.slice(0, 10));

  //Spannen pro Einzelstunde (für die Tages-Diagramme)
  function stuendlicheSpanne(reihen) {
    const p10 = [], p90 = [];
    for (let i = 0; i < stunden.length; i++) {
      const werte = reihen.map((r) => r[i]).filter((v) => v != null);
      p10.push(werte.length ? perzentil(werte, 0.1) : null);
      p90.push(werte.length ? perzentil(werte, 0.9) : null);
    }
    return { p10, p90 };
  }

  /** Kennzahl pro Mitglied und Tag berechnen, dann P10/P90 über Mitglieder. */
  function taeglicheSpanne(reihen, zusammenfassung /* max|min|summe */) {
    const tage = [...new Set(tagesSchluessel)];
    const p10 = [], p90 = [];
    for (const tag of tage) {
      // Indizes aller Stunden dieses Tages
      const indizes = [];
      for (let i = 0; i < stunden.length; i++) {
        if (tagesSchluessel[i] === tag) indizes.push(i);
      }
      const mitgliederWerte = reihen.map((reihe) => {
        const werte = indizes.map((i) => reihe[i]).filter((v) => v != null);
        if (!werte.length) return null;
        if (zusammenfassung === "max") return Math.max(...werte);
        if (zusammenfassung === "min") return Math.min(...werte);
        return werte.reduce((a, b) => a + b, 0); // Summe
      }).filter((v) => v != null);
      p10.push(mitgliederWerte.length >= 3 ? perzentil(mitgliederWerte, 0.1) : null);
      p90.push(mitgliederWerte.length >= 3 ? perzentil(mitgliederWerte, 0.9) : null);
    }
    return { tage, p10, p90 };
  }

  return {
    quelle: "Open-Meteo Ensemble (GFS, 30 Mitglieder)",
    stuendlich: {
      zeit: stunden,
      temperatur: stuendlicheSpanne(tempReihen),
      wind: stuendlicheSpanne(windReihen),
      niederschlag: stuendlicheSpanne(regenReihen),
    },
    taeglich: {
      temperaturMax: taeglicheSpanne(tempReihen, "max"),
      temperaturMin: taeglicheSpanne(tempReihen, "min"),
      windMax: taeglicheSpanne(windReihen, "max"),
      niederschlagSumme: taeglicheSpanne(regenReihen, "summe"),
    },
  };
}

/* ============================== 4. Regenradar ============================== */

/**
 * Radar-Frames von RainViewer abfragen.
 * Nutzungsbedingungen: frei für private/nicht-kommerzielle Nutzung,
 * Quellenangabe mit Link auf rainviewer.com erwünscht (siehe README).
 * @returns {Promise<{host: string, frames: Array<{time:number, path:string}>}>}
 */
export async function radarDatenLaden() {
  let daten;
  try {
    daten = await holeJson(BASIS_RADAR_JSON);
  } catch {
    throw new Error("Der Radardienst ist derzeit nicht erreichbar. " +
      "Bitte versuche es in einigen Minuten erneut.");
  }
  const frames = daten?.radar?.past ?? [];
  if (!daten?.host || frames.length === 0) {
    throw new Error("Derzeit sind keine Radardaten verfügbar. " +
      "Der Dienst stellt in der Regel alle 5 Minuten neue Bilder bereit.");
  }
  return { host: daten.host, frames };
}

/* ====================== 5. Gezeiten (Ebbe & Flut) ========================== */

/*
 * Quelle: BSH – Bundesamt für Seeschifffahrt und Hydrographie (CC BY 4.0)
 *
 * 1) PRIMÄR: offenes GeoJSON-Portal "gdi.bsh.de" (WaterLevelForecast).
 *    Sendet "Access-Control-Allow-Origin: *" – funktioniert damit direkt im
 *    Browser, auch auf der Internet-Adresse (GitHub Pages) OHNE Proxy.
 *    Pro Pegel-Abfrage kommen amtliche HW/NW-Zeiten + Vorhersagekurve.
 *    Die Pegelliste liegt als kleine statische Datei im App-Ordner
 *    (data/bsh-gdi-pegel.json, 136 Pegel) – die Vollversion bei BSH ist mit
 *    5,6 MB zu groß für den mobilen Abruf.
 *    Werte: cm über Pegelnull (Pegel-Praxisnull, wie in der BSH-App).
 * 2) FÜRS HEIMNETZ: die klassische Datei-API gezeiten.bsh.de braucht einen
 *    Proxy (kein CORS, s. dev-server.py /bsh-api/…) – weiterhin nutzbar.
 * 3) LETZTER AUSWEG: Meeresspiegel-Modellnäherung (Open-Meteo Marine),
 *    klar als solche gekennzeichnet.
 */
const BSH_GDI_BASIS =
  "https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast/collections/waterlevelforecastdata/items";
const BSH_GDI_LIEGEREIN = 3 * 24 * 3600 * 1000;   // Cache max. 3 Tage alt werden lassen

/** Die 136 BSH-Wasserstandspegel vom offenen Datenportal (statische Liste). */
export async function bshGdiPegelLaden() {
  try {
    const antwort = await fetch("data/bsh-gdi-pegel.json", { cache: "no-store" });
    if (!antwort.ok) return null;
    const daten = await antwort.json();
    if (!daten?.pegel?.length) return null;
    return daten.pegel.map((p) => ({ name: p.name, gdiId: p.id, lat: p.lat, lon: p.lon }));
  } catch { return null; }
}

/**
 * Amtliche Tiden vom BSH-Datenportal für einen Pegel (Offline-Cache inbegriffen).
 * @param {string} gdiId  Pegel-Kennung, z. B. "husum_schleuse"
 * @returns {Promise<null|{station, quelle, pegelLink, referenz, tide,
 *            vorhersageStand, offline?}>}
 */
export async function bshGdiLaden(gdiId) {
  const cacheSchluessel = `bsh-gdi-${gdiId}`;
  const parse = (json, ausCache = false) => {
    const f = (json.features && json.features[0]) ? json.features[0] : json;
    const pr = f?.properties;
    if (!pr) return null;
    const jetzt = Date.now();
    const tide = (pr.high_water_low_water ?? [])
      .filter((e) => e.event === "HW" || e.event === "NW")
      .map((e) => ({
        zeit: new Date(e.event_timestamp.replace(" ", "T")),
        typ: e.event === "HW" ? "hoch" : "niedrig",
        cm: Math.round(parseFloat(e.tidal_prediction_value)),
      }))
      .filter((e) => !isNaN(e.zeit) && e.zeit.getTime() > jetzt - 12 * 3600 * 1000)
      .sort((a, b) => a.zeit - b.zeit);
    if (!tide.length) return null;
    // Wasserstand-Kurve (alle ~10 min) für die Wellenzeichnung: nur die
    // nächsten ~32 Stunden, damit der Offline-Cache klein bleibt.
    const bisJetzt = jetzt - 3 * 3600 * 1000;
    const kurve = (pr.curve ?? [])
      .map((c) => ({
        zeit: new Date(String(c.timestamp).replace(" ", "T")),
        cm: Math.round(parseFloat(c.tidal_prediction)),
      }))
      .filter((c) => !isNaN(c.zeit) && c.zeit.getTime() > bisJetzt && !Number.isNaN(c.cm))
      .slice(0, 220);
    return {
      station: pr.gauge_label,
      quelle: "BSH – amtliche Gezeitenvorhersage (Datenportal, CC BY 4.0)",
      pegelLink: pr.bsh_url_waterlevel || "https://gdi.bsh.de/",
      referenz: "Pegelnull",
      vorhersageStand: pr.forecast_timestamp,
      tide: tide.slice(0, 8),
      kurve,
      offline: ausCache,
    };
  };
  try {
    const antwort = await fetch(`${BSH_GDI_BASIS}/${gdiId}?lang=de&f=json`, { cache: "no-store" });
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
    const json = await antwort.json();
    const ergebnis = parse(json);
    if (ergebnis) {
      try { localStorage.setItem(cacheSchluessel, JSON.stringify({ t: Date.now(), j: json })); }
      catch { /* Speicher voll/privater Modus: egal */ }
      return ergebnis;
    }
    throw new Error("keine Tiden im Datensatz");
  } catch {
    // Offline/Ausfall: letzten erfolgreichen Abruf verwenden (max. 3 Tage alt)
    try {
      const roh = localStorage.getItem(cacheSchluessel);
      if (roh) {
        const cache = JSON.parse(roh);
        if (Date.now() - cache.t < BSH_GDI_LIEGEREIN) {
          const ergebnis = parse(cache.j, true);
          if (ergebnis) return ergebnis;
        }
      }
    } catch { /* ohne Cache weiter zum nächsten Ausweg */ }
    return null;
  }
}

/* --- Unterbau: die klassische Datei-API (nur mit Proxy erreichbar) ------ */
const BSH_PROXY_PFAD = "bsh-api";                          // /bsh-api/… → gezeiten.bsh.de/data/…
const BSH_URSPRUNG   = "https://gezeiten.bsh.de/data";

/** BSH-JSON holen: erst eigener Proxy, dann Direktzugriff, sonst null. */
async function bshJson(dateiname) {
  for (const basis of [BSH_PROXY_PFAD, BSH_URSPRUNG]) {
    try {
      const antwort = await fetch(`${basis}/${dateiname}`, { cache: "no-store" });
      if (antwort.ok) return await antwort.json();
    } catch { /* CORS/Netzwerk → nächsten Versuch probieren */ }
  }
  return null;
}

/** Alle BSH-Gezeitenpegel (Name, BshNr, Position). */
export async function gezeitenPegelLaden() {
  const daten = await bshJson("tides_overview.json");
  if (!daten?.gauges?.length) return null;
  return daten.gauges.map((p) => ({
    name: p.station_name, bshnr: p.bshnr,
    lat: p.latitude, lon: p.longitude, seoId: p.seo_id,
  }));
}

/**
 * Nächste Hoch-/Niedrigwasser am BSH-Pegel.
 * @returns {Promise<null|{station: string, quelle: string, pegelLink: string,
 *            referenz: string, tide: Array<{zeit: Date, typ: 'hoch'|'niedrig', cm: number}>}>}
 */
export async function gezeitenLaden(pegel) {
  const daten = await bshJson(`DE__${pegel.bshnr}_tides.json`);
  if (!daten?.years?.length) return null;
  const jetzt = new Date();
  const tide = [];
  for (const jahresObjekt of daten.years) {
    for (const [, jahr] of Object.entries(jahresObjekt)) {
      const eintraege = jahr?.hwnw_prediction?.data ?? [];
      for (const e of eintraege) {
        const zeit = new Date(e.timestamp);          // z. B. "2026-11-03 05:31:00+01:00"
        if (isNaN(zeit) || zeit < jetzt) continue;
        tide.push({ zeit, typ: e.type === "HW" ? "hoch" : "niedrig", cm: e.height });
      }
    }
  }
  tide.sort((a, b) => a.zeit - b.zeit);
  const referenz = daten.years.flatMap((o) => Object.values(o))[0]?.level_tidalvalues ?? "PNP";
  return {
    station: daten.station_name,
    quelle: "BSH – amtliche Gezeitenvorausberechnung",
    pegelLink: `https://gezeiten.bsh.de/${daten.seo_id ?? ""}`,
    referenz,
    tide: tide.slice(0, 8),
  };
}

/* Fallback: Modell-Meeresspiegel (nur wenn BSH nicht erreichbar ist) */
const BASIS_MARINE = "https://marine-api.open-meteo.com/v1/marine";

/** Küsten-/Pegelstationen für die Gezeiten-Auswahl (Koordinaten auf offener See,
 *  damit das Meeresmodell Werte liefert; Namen sind die zugehörigen Orte). */
export const GEZEITEN_STATIONEN = [
  { name: "Husum (Außenweser)", lat: 54.48, lon: 9.06 },
  { name: "Sylt (Hörnum)",      lat: 54.90, lon: 8.53 },
  { name: "Cuxhaven",           lat: 53.87, lon: 8.69 },
  { name: "Borkum",             lat: 53.60, lon: 6.70 },
  { name: "Emden",              lat: 53.37, lon: 7.00 },
];

/**
 * Wasserhöhe über Meeresspiegel (MSL) als Stundenreihe – damit lassen sich
 * Ebbe und Flut als lokale Minima/Maxima erkennen.
 * WICHTIG: Das ist eine Modell-Näherung (CMEMS-Meeresspiegel von Open-Meteo),
 * keine amtliche Gezeitentafel. In der UI klar gekennzeichnet.
 */
export async function wasserstandLaden(lat, lon, stunden = 72) {
  const parameter = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: "sea_level_height_msl",
    forecast_days: String(Math.ceil(stunden / 24)),
    timezone: "Europe/Berlin",
  });
  const daten = await holeJson(`${BASIS_MARINE}?${parameter}`);
  const zeit = daten.hourly?.time ?? [];
  const wert = daten.hourly?.sea_level_height_msl ?? [];
  return { zeit, wert };
}

/**
 * Aus einer Wasserstandsreihe die Extreme (Hoch-/Niedrigwasser) ableiten.
 * Ein Extremum gilt nur, wenn die Differenz zum Nachbarrand deutlich genug ist
 * (Rauschunterdrückung), sonst gibt es zu viele „Tiden“ durch Modellschwanken.
 * @returns {Array<{zeit: string, typ: 'hoch'|'niedrig', wert: number}>}
 */
export function tideAuslesen(zeit, wert, minAbstand = 0.18) {
  const events = [];
  for (let i = 1; i < wert.length - 1; i++) {
    const a = wert[i - 1], b = wert[i], c = wert[i + 1];
    if (a == null || b == null || c == null) continue;
    const hoch = b > a && b >= c;
    const niedrig = b < a && b <= c;
    if (!hoch && !niedrig) continue;
    // Stagnationsbereich überspringen: Spitze muss sich klar abheben
    const rand = Math.min(Math.abs(b - a), Math.abs(b - c)) + Math.abs(b - (hoch ? Math.min(a, c) : Math.max(a, c)));
    if (rand < minAbstand) continue;
    events.push({ zeit: zeit[i], typ: hoch ? "hoch" : "niedrig", wert: Math.round(b * 100) / 100 });
  }
  return events;
}

/* ============== 6. Modell-Vorschau (Radarkarten-Kurz-Vorschau) ============= */

const VORSCHAU_CACHE = new Map(); // "YYYY-MM-DDTHH" -> {zellen, gehoerent}

/** Ein 1°-Gitter über Mitteleuropa/Nordsee als Punkteliste. */
function radarGitter() {
  const punkte = [];
  for (let lat = 46; lat <= 56; lat += 1) {
    for (let lon = 5; lon <= 16; lon += 1) punkte.push([lat, lon]);
  }
  return punkte;
}

/**
 * Modellniederschlag (mm/h) für eine Zukunftsstunde – für die Radar-Vorschau.
 * RainViewer liefert in der kostenlosen API keine Nowcast-Kacheln (Feld
 * "nowcast" ist leer), daher transparent aus Open-Meteo GFS abgeleitet.
 * Kein Ersatz für eine extrapolierende Nowcast – in der UI beschriftet.
 */
export async function niederschlagVorschau(stundenVonJetzt) {
  const ziel = new Date(Date.now() + stundenVonJetzt * 3600 * 1000);
  const schluessel = ziel.toISOString().slice(0, 13);
  const cached = VORSCHAU_CACHE.get(schluessel);
  if (cached && Date.now() - cached.gehoerent < 20 * 60 * 1000) return cached.zellen;

  const punkte = radarGitter();
  const zellen = [];
  const anfragen = [];
  for (let i = 0; i < punkte.length; i += 25) {
    const brocken = punkte.slice(i, i + 25);
    const parameter = new URLSearchParams({
      latitude: brocken.map((p) => p[0]).join(","),
      longitude: brocken.map((p) => p[1]).join(","),
      hourly: "precipitation",
      timezone: "UTC",
      forecast_days: "1",
    });
    anfragen.push(
      fetch(`${BASIS_VORHERSAGE}?${parameter}`)
        .then((a) => (a.ok ? a.json() : null))
        .then((orte) => {
          if (!orte) return;
          (Array.isArray(orte) ? orte : [orte]).forEach((ort, idx) => {
            const [lat, lon] = brocken[idx] ?? brocken[0];
            const ureihe = ort?.hourly?.time ?? [];
            const k = ureihe.findIndex((t) => t.startsWith(schluessel));
            if (k < 0) return;
            const mmh = ort?.hourly?.precipitation?.[k] ?? 0;
            if (mmh > 0.05) zellen.push({ lat, lon, mmh });
          });
        })
        .catch(() => {})
    );
  }
  await Promise.all(anfragen);
  VORSCHAU_CACHE.set(schluessel, { zellen, gehoerent: Date.now() });
  return zellen;
}

/* ======================= 7. Meeresdaten (MET Norway) ======================= */

/*
 * Wassertemperatur & Wellenhöhe aus Norwegen: „Oceanforecast 2.0“ vom
 * Norwegian Meteorological Institute (MET Norway, api.met.no) – nutzt die
 * Wellenmodelle WAVEWATCHIII/WAM und die Meeresmodelle TOPAZ/SKAGGERRAK.
 * Die API snapt automatisch zum nächsten offenen See-Punkt, braucht keinen
 * API-Schlüssel und sendet "Access-Control-Allow-Origin: *".
 * Für Städte fernab der See (HTTP 422 / leere Zeitreihe) bleibt als
 * Fallback Open-Meteo Marine (Copernicus-Meer) übrig; schlägt beides fehl,
 * zeigt die App die Chips schlicht nicht an (erfindet also nichts).
 */
const BASIS_MET_OZEAN = "https://api.met.no/weatherapi/oceanforecast/2.0/complete";

/**
 * Wassertemperatur + Wellenhöhe für einen Ort laden.
 * @returns {Promise<{quelle, quellLink, zeit, welleM, welleAusGrad, wasserC} | null>}
 */
export async function meerDatenLaden(lat, lon) {
  // 1) MET Norway – gute Qualität rund um Nord-/Ostsee und weltweit auf See.
  try {
    const q = new URLSearchParams({ lat: lat.toFixed(3), lon: lon.toFixed(3) });
    const antwort = await fetch(`${BASIS_MET_OZEAN}?${q}`, { cache: "no-store" });
    if (antwort.ok) {
      const json = await antwort.json();
      const reihe = json?.properties?.timeseries ?? [];
      const d = reihe[0]?.data?.instant?.details ?? {};
      if (d.sea_surface_wave_height != null || d.sea_water_temperature != null) {
        return {
          quelle: "MET Norway (Oceanforecast 2.0)",
          quellLink: "https://api.met.no/",
          zeit: reihe[0].time,
          welleM: d.sea_surface_wave_height ?? null,
          welleAusGrad: d.sea_surface_wave_from_direction ?? null,
          wasserC: d.sea_water_temperature ?? null,
        };
      }
    }
  } catch { /* weiter mit Fallback */ }

  // 2) Fallback: Open-Meteo Marine (Copernicus-Meer, weltweit).
  try {
    const q = new URLSearchParams({
      latitude: lat.toFixed(3),
      longitude: lon.toFixed(3),
      hourly: "sea_surface_temperature,wave_height",
      forecast_days: "1",
      timezone: "Europe/Berlin",
    });
    const antwort = await fetch(`https://marine-api.open-meteo.com/v1/marine?${q}`);
    if (!antwort.ok) return null;
    const json = await antwort.json();
    const h = json?.hourly ?? {};
    const jetzt = new Date().toISOString().slice(0, 13);
    const idx = (h.time ?? []).findIndex((t) => t.slice(0, 13) >= jetzt);
    const k = idx >= 0 ? idx : 0;
    const wasserC = h.sea_surface_temperature?.[k] ?? null;
    const welleM = h.wave_height?.[k] ?? null;
    if (wasserC == null && welleM == null) return null;
    return {
      quelle: "Open-Meteo Marine (Copernicus-Meer)",
      quellLink: "https://open-meteo.com/",
      zeit: h.time?.[k] ?? null,
      welleM,
      welleAusGrad: null,
      wasserC,
    };
  } catch {
    return null;
  }
}
