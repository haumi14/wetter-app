/**
 * wmo.js – Wetterzustands-Codes (WMO 4677), Formatierung und Kompassrichtungen.
 * Die Zuordnung folgt dem offiziellen WMO-Schlüssel, wie er auch von Open-Meteo
 * dokumentiert wird (https://open-meteo.com/en/docs).
 */

/** WMO-Code → { text: deutsche Beschreibung, symbol: Emoji } */
export const WMO_ZUSTAENDE = {
  0:  { text: "Klarer Himmel",        symbol: "☀️" },
  1:  { text: "Überwiegend klar",     symbol: "🌤️" },
  2:  { text: "Teilweise bewölkt",    symbol: "⛅" },
  3:  { text: "Bedeckt",              symbol: "☁️" },
  45: { text: "Nebel",                symbol: "🌫️" },
  48: { text: "Reifnebel",            symbol: "🌫️" },
  51: { text: "Leichter Nieselregen", symbol: "🌦️" },
  53: { text: "Nieselregen",          symbol: "🌦️" },
  55: { text: "Starker Nieselregen",  symbol: "🌧️" },
  56: { text: "Gefrierender Nieselregen", symbol: "🌧️" },
  57: { text: "Starker gefrierender Nieselregen", symbol: "🌧️" },
  61: { text: "Leichter Regen",       symbol: "🌦️" },
  63: { text: "Mäßiger Regen",        symbol: "🌧️" },
  65: { text: "Starker Regen",        symbol: "🌧️" },
  66: { text: "Gefrierender Regen",   symbol: "🌧️" },
  67: { text: "Starker gefrierender Regen", symbol: "🌧️" },
  71: { text: "Leichter Schneefall",  symbol: "🌨️" },
  73: { text: "Mäßiger Schneefall",   symbol: "🌨️" },
  75: { text: "Starker Schneefall",   symbol: "❄️" },
  77: { text: "Schneegriesel",        symbol: "🌨️" },
  80: { text: "Leichte Regenschauer", symbol: "🌦️" },
  81: { text: "Regenschauer",         symbol: "🌧️" },
  82: { text: "Heftige Regenschauer", symbol: "🌧️" },
  85: { text: "Leichte Schneeschauer", symbol: "🌨️" },
  86: { text: "Schneeschauer",        symbol: "❄️" },
  95: { text: "Gewitter",             symbol: "⛈️" },
  96: { text: "Gewitter mit Hagel",   symbol: "⛈️" },
  99: { text: "Schweres Gewitter mit Hagel", symbol: "⛈️" },
};

/** Zustand für einen WMO-Code zurückgeben (Fallback: unbewölkt-Symbol). */
export function wetterzustand(code) {
  return WMO_ZUSTAENDE[code] ?? { text: "Unbekannter Zustand", symbol: "🌡️" };
}

/** 16er-Kompass aus Windrichtung in Grad. */
const KOMPASS = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function kompassrichtung(grad) {
  if (grad == null || Number.isNaN(grad)) return "";
  return KOMPASS[Math.round(grad / 22.5) % 16];
}

/* ------------------------------ Formatierung ------------------------------ */

/**
 * Datums-/Zeitformat in der Zeitzone des Ortes.
 * @param {string} iso      ISO-Zeitstempel OHNE Zone, wie von Open-Meteo
 *                          geliefert (bereits örtliche Ortszeit), z. B. "2026-11-02T14:00".
 * @param {object} optionen Options-Objekt für Intl.DateTimeFormat.
 */
export function formatiereOrtszeit(iso, optionen) {
  // Open-Meteo liefert Zeiten bereits in der Zeitzone des angefragten Ortes
  // (timezone=auto). Wir hängen deshalb bewusst keine Zone an und lesen den
  // String direkt – so verrutschen keine Stunden.
  let text = iso;
  if (iso.length === 10) text = `${iso}T12:00:00`;   // Datum ohne Uhrzeit: mittags, um Datumswechsel zu vermeiden
  else if (iso.length <= 16) text = `${iso}:00`;     // "2026-11-02T14:00" → Sekunden ergänzen
  const d = new Date(text);
  return new Intl.DateTimeFormat("de-DE", optionen).format(d);
}

/** Zahl mit fester Nachkommastelle und deutscher Kommasetzung. */
export function zahl(wert, nachkommastellen = 1) {
  if (wert == null || Number.isNaN(wert)) return "–";
  return wert.toLocaleString("de-DE", {
    minimumFractionDigits: nachkommastellen,
    maximumFractionDigits: nachkommastellen,
  });
}

/** Temperatur, z. B. "7 °C". */
export function temperatur(wert) {
  return wert == null ? "–" : `${zahl(wert, 1)} °C`;
}

/** Untergrenzen (m/s) je Beaufort-Stärke: Bf 1 ab 0,3 m/s … Bf 12 ab 32,7 m/s. */
export const BEAUFORT_GRENZEN = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

/** Windgeschwindigkeit in m/s → Beaufort-Stärke (0–12). */
export function bftAusMs(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  return BEAUFORT_GRENZEN.filter((g) => ms >= g).length;
}
