/**
 * dwd.js – Amtliche DWD-Wetterwarnungen und die Messstation in der Nähe.
 *
 * Datenquelle: Bright Sky (https://brightsky.dev) – schlüsselloser,
 * CORS-freundlicher JSON-Zugriff auf die offenen Daten des Deutschen
 * Wetterdienstes (DWD):
 *   · /alerts          → aktive Warnungen für die Warnzelle des Ortes
 *   · /current_weather → letzter Messwert der nächsten DWD-Station
 *                        (Temperatur, Wind, Böen, Druck …) samt Stationsliste
 *                        inkl. Entfernung – die „Wetterquellen vor Ort".
 * Einheiten bei units=si: Temperatur Kelvin, Druck Pascal, Wind m/s.
 * Abgedeckt ist Deutschland; für das Ausland gibt es keine Warnzellen.
 */

const BASIS_BRIGHTSKY = "https://api.brightsky.dev";

/** Dringlichkeits-Stufen: deutscher Name + Farben (hell → dunkelrot). */
export const WARN_STUFEN = {
  info:   { name: "Hinweis",             farbe: "#8a6d00", hinter: "#fbf7d8", rand: "#e4d98a" },
  warnt:  { name: "Wetterwarnung",       farbe: "#a35a00", hinter: "#fdf1dd", rand: "#e8c290" },
  stark:  { name: "Markantes Wetter",    farbe: "#c2570f", hinter: "#fceadd", rand: "#eab68e" },
  unge:   { name: "Unwetter",            farbe: "#b3213c", hinter: "#fbe4ea", rand: "#eaaebc" },
  extrem: { name: "Extreme Unwetter",    farbe: "#6d0b23", hinter: "#f4d2dc", rand: "#d68fa4" },
};

/** CAP-Bewertung (und DWD-Stufe, falls vorhanden) → Anzeige-Stufe. */
function stufeAus(alarm) {
  switch (String(alarm.alert_level ?? "")) {
    case "P5": return WARN_STUFEN.extrem;
    case "P4": return WARN_STUFEN.unge;
    case "P3": return WARN_STUFEN.stark;
    case "P2": return WARN_STUFEN.warnt;
    case "P1": return WARN_STUFEN.info;
  }
  switch (alarm.severity) {
    case "extreme":  return WARN_STUFEN.extrem;
    case "severe":   return WARN_STUFEN.unge;
    case "moderate": return WARN_STUFEN.stark;
    default:         return WARN_STUFEN.warnt;
  }
}

/**
 * Aktive DWD-Warnungen für einen Ort.
 * @returns {Promise<{zelle: string, warnungen: Array>} | null}
 *          null, wenn der Ort außerhalb Deutschlands liegt oder nichts geht.
 */
export async function dwdWarnungenLaden(lat, lon) {
  try {
    const q = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
    const antwort = await fetch(`${BASIS_BRIGHTSKY}/alerts?${q}`, { cache: "no-store" });
    if (!antwort.ok) return null;             // z. B. Ausland → keine Warnzelle
    const json = await antwort.json();
    return {
      zelle: json.location?.name ?? "",
      warnungen: (json.alerts ?? []).map((a) => ({
        stufe: stufeAus(a),
        titel: a.headline_de || a.event_de || "Wetterwarnung",
        text: a.description_de || "",
        anleitung: a.instruction_de || "",
        von: new Date(a.onset || a.effective),
        bis: a.expires ? new Date(a.expires) : null,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Letzter Messwert der nächsten DWD-Wetterstation + die weiteren Stationen.
 * @returns {Promise<object | null>} null bei Ausland/Ausfall.
 */
export async function dwdStationLaden(lat, lon) {
  try {
    const q = new URLSearchParams({
      lat: lat.toFixed(4), lon: lon.toFixed(4), units: "si", max_dist: "120000",
    });   // max_dist ist bei Bright Sky in Metern!
    const antwort = await fetch(`${BASIS_BRIGHTSKY}/current_weather?${q}`, { cache: "no-store" });
    if (!antwort.ok) return null;
    const json = await antwort.json();
    const w = json.weather;
    const quellen = json.sources ?? [];
    if (!w || !quellen.length) return null;
    const st = quellen.find((s) => s.id === w.source_id) ?? quellen[0];
    return {
      name: st.station_name || "Unbekannte Station",
      dwdId: st.dwd_station_id || "",
      entfernungKm: (st.distance ?? 0) / 1000,
      hoeheM: st.height ?? null,
      zeit: w.timestamp ? new Date(w.timestamp) : null,
      temperaturC: w.temperature != null ? w.temperature - 273.15 : null,
      taupunktC: w.dew_point != null ? w.dew_point - 273.15 : null,
      windMs: w.wind_speed_10 ?? null,
      boenMs: w.wind_gust_speed_10 ?? null,
      richtungGrad: w.wind_direction_10 ?? null,
      druckHpa: w.pressure_msl != null ? w.pressure_msl / 100 : null,
      feuchte: w.relative_humidity ?? null,
      bedeckung: w.cloud_cover ?? null,
      stationen: quellen.filter((s) => s.id !== st.id).slice(0, 3).map((s) => ({
        name: s.station_name, km: (s.distance ?? 0) / 1000,
      })),
    };
  } catch {
    return null;
  }
}
