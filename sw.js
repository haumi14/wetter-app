/**
 * sw.js – Service Worker der Wetter-App (PWA).
 *
 * Strategien:
 *  · App-Shell (HTML/JS/CSS/Icons/Bibliotheken): "stale while revalidate" –
 *    beim Start sofort aus dem Cache, dahinter frisch nachladen. Die App ist
 *    damit auch ohne Netz startfähig (letzte Daten bleiben im Daten-Cache).
 *  · Navigationsaufruf: zuerst Netz (damit Änderungen ankommen), bei
 *    Netzfehler die zwischengespeicherte Startseite.
 *  · Wetter-APIs (Open-Meteo, RainViewer, BSH-Proxy): Netz zuerst, bei
 *    Fehler der letzte erfolgreiche Abruf ("letzte bekannte Werte" statt
 *    leerer Seite). Das ist ehrlich: Die App zeigt ohnehin Zeitstempel an.
 *  · Kartenkacheln (OSM/RainViewer): Cache zuerst, begrenzt (LRU-artig).
 */

const FASSADE = "wetter-fassade-v9";   // App-Shell (fest vorab hinterlegt)
const DATEN = "wetter-daten-v7";       // letzte API-Antworten
const KACHELN = "wetter-kacheln-v7";   // Kartenkacheln

const FASSADE_DATEIEN = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/api.js",
  "js/charts.js",
  "js/himmel.js",
  "js/elch.js",
  "js/info.js",
  "js/dwd.js",
  "js/radar.js",
  "js/favorites.js",
  "js/wmo.js",
  "vendor/chart.umd.min.js",
  "vendor/leaflet.js",
  "vendor/leaflet.css",
  "data/bsh-gdi-pegel.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

const API_MUSTER = [
  "api.open-meteo.com",
  "ensemble-api.open-meteo.com",
  "marine-api.open-meteo.com",
  "geocoding-api.open-meteo.com",
  "api.rainviewer.com",
  "bsh-api/",          // lokaler Proxy (/bsh-api/…)
  "gezeiten.bsh.de",
  "gdi.bsh.de",        // offenes BSH-Datenportal (CSD-freigegeben)
  "api.brightsky.dev", // DWD-Warnungen + Messstationen (Bright Sky)
];

const KACHEL_MUSTER = [
  "tile.openstreetmap.org",
  "radar_tile_exists",  // RainViewer-Kacheln (Pfad enthält host-Namen)
];

self.addEventListener("install", (ereignis) => {
  ereignis.waitUntil(
    caches.open(FASSADE).then((cache) => cache.addAll(FASSADE_DATEIEN))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (ereignis) => {
  ereignis.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen.filter((n) => ![FASSADE, DATEN, KACHELN].includes(n)).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

function istApi(anfrage) {
  const u = anfrage.url;
  return API_MUSTER.some((m) => u.includes(m));
}
function istKachel(anfrage) {
  const u = anfrage.url;
  return KACHEL_MUSTER.some((m) => u.includes(m));
}

/** Kachel-Cache begrenzen: wenn zu voll, den Inhalt komplett leeren.
 *  (einfach & robust; Kacheln sind billige Neulader) */
async function kachelCacheBegrenzen() {
  const cache = await caches.open(KACHELN);
  const schluessel = await cache.keys();
  if (schluessel.length > 240) {
    await cache.delete(schluessel[0]);
    await cache.delete(schluessel[1]);
  }
}

self.addEventListener("fetch", (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== "GET") return;
  const url = new URL(anfrage.url);

  // Navigationsaufruf UND gleichartige statische Dateien:
  // Netz zuerst (damit Aktualisierungen sofort ankommen), bei Netz-/Offline-
  // Fehlern der letzte Cache-Stand. So bleibt die App entwickler-freundlich
  // UND offline-startfähig.
  const gleichartig = url.origin === self.location.origin;
  if (anfrage.mode === "navigate" || gleichartig) {
    ereignis.respondWith(
      fetch(anfrage)
        .then((antwort) => {
          if (antwort.ok) {
            const kopie = antwort.clone();
            caches.open(FASSADE).then((c) => c.put(anfrage, kopie));
          }
          return antwort;
        })
        .catch(async () =>
          (await caches.match(anfrage))
          || (anfrage.mode === "navigate" ? await caches.match("index.html") : null)
          || Response.error())
    );
    return;
  }

  // Wetter-APIs: Netz zuerst, Fehler/Offline → letzter Erfolg aus dem Daten-Cache.
  if (istApi(anfrage)) {
    ereignis.respondWith(
      fetch(anfrage)
        .then((antwort) => {
          if (antwort.ok) {
            const kopie = antwort.clone();
            caches.open(DATEN).then((c) => c.put(anfrage, kopie));
          }
          return antwort;
        })
        .catch(async () => (await caches.match(anfrage)) || Response.error())
    );
    return;
  }

  // Kartenkacheln: Cache zuerst (schnelles Schwenken), daneben begrenzen.
  if (istKachel(anfrage)) {
    ereignis.respondWith(
      caches.match(anfrage).then((gefunden) => {
        const laden = fetch(anfrage).then((antwort) => {
          if (antwort.ok) {
            const kopie = antwort.clone();
            caches.open(KACHELN).then(async (c) => { await c.put(anfrage, kopie); kachelCacheBegrenzen(); });
          }
          return antwort;
        }).catch(() => gefunden || Response.error());
        return gefunden || laden;
      })
    );
  }
  // (Alles andere – Anfragen fremder Seiten ohne eigene Strategie –
  //  lässt der Service Worker unverändert passieren.)
});
