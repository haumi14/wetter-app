# Wetter-App – Vorhersage & Regenradar

Responsive Wetter-Webseite mit deutscher Oberfläche: Städtensuche mit
Autovervollständigung, lokalen Favoriten, aktuellem Wetter inkl. Meeres-Chips
(Wassertemperatur, Wellenhöhe, Luftfeuchte), einer animierten Wetter-Kulisse
im Kopfbereich (Regen, Sonne, Mond & Sterne, Schnee …), „Aussichten für
heute“, Sonnen-/Mondangaben, amtlichen BSH-Gezeiten (Ebbe & Flut),
Vorhersage bis 16 Tage mit Diagrammen (inkl. sichtbarer Prognoseunsicherheit)
sowie einer eigenen Regradar-Seite mit Modell-Vorschau.

## Ausführen

Die Seite ist eine **PWA** (Progressive Web App) aus statischen Dateien und
benötigt einen lokalen Webserver (ES-MODULE funktionieren nicht über
`file://`). Das mitgelieferte Skript liefert die Dateien aus **und** stellt
einen kleinen Proxy für die BSH-Gezeitendaten bereit (`/bsh-api/…`), denn
die BSH sendet keinen CORS-Header:

```bash
cd wetter-app
python dev-server.py              # Port 8777, inkl. BSH-Proxy
# dann im Browser: http://localhost:8777/
```

### Nutzung auf dem Handy

1. `python dev-server.py` auf dem Rechner starten, das Handy ist **im
   selben WLAN**.
2. Beim Start zeigt der Server die Adresse an, z. B.
   `http://192.168.2.42:8777` – diese im Handy-Browser öffnen.
3. Android/Chrome: Menü ⋮ → **„App installieren“** bzw. **„Zum Startbildschirm
   hinzufügen“** – die App öffnet sich daraufhin ohne Adressleiste
   (standalone), mit eigenem Icon.
4. Über den Heim-Proxy erreicht das Handy dann auch die **amtlichen BSH-Tiden**.

**Wohin auch immer, ohne heimischen Server:** die App funktioniert überall –
nur die Tidenkarte weicht dann automatisch auf die klar gekennzeichnete
**Modell-Näherung** (Copernikus-Meeresspiegel via Open-Meteo Marine) aus,
weil die BSH keine CORS-freigenommenen Daten anbietet und alle kostenlosen
öffentlichen CORS-Relais (AllOrigins, corsproxy.io, codetabs, thingproxy –
getestet im November 2026) entweder eingestellt, hinter API-Keys oder
unerreichbar sind. Für eine wirklich installierbare PWA außerhalb des
heimischen Netzes die Dateien auf einen HTTPS-Host legen (z. B. GitHub
Pages) – Service Worker und Installation verlangen HTTPS.

Der Server lauscht auf allen Netzinterfaces; `sw.js` und Manifest werden
sicherheitshalber mit `Cache-Control: no-cache` ausgeliefert, damit
Aktualisierungen auf dem Handy sofort ankommen.

## Ordnerstruktur

```
wetter-app/
├── index.html          # Aufbau beider Ansichten (Übersicht, Radar)
├── dev-server.py       # lokaler Server mit BSH-Proxy (/bsh-api/…)
├── css/styles.css      # responsives Design (Mobile First, WCAG-AA-Kontraste)
└── js/
    ├── app.js          # Routing, Suche, Favoriten, Ansichtsaufbau, Meeres-Chips
    ├── api.js          # alle Netzwerkzugriffe (Open-Meteo, RainViewer, BSH, MET Norway)
    ├── charts.js       # Chart.js-Diagramme inkl. Unsicherheitsbänder
    ├── radar.js        # Leaflet-Karte mit RainViewer-Frames + Zeitsteuerung
    ├── himmel.js       # dekorative Wetter-Kulisse (Regen/Sonne/Mond/Schnee/Nebel)
    ├── info.js         # Tagesaussicht, Sonne/Mond, Gezeiten
    ├── favorites.js    # Favoriten in localStorage
    └── wmo.js          # WMO-Wettercodes (Deutsch), Formatierung, Kompass, Bft
```

Bibliotheken werden per CDN eingebunden: **Chart.js 4.4.7** (Diagramme),
**Leaflet 1.9.4** (Karten).

## Diagramme

- **Temperatur & Niederschlag** (ein Diagramm, volle Breite):
  Temperatur als Linie – **orange über 0 °C, cyan darunter** (0-°C-Linie dunkel
  markiert); Niederschlag als **dunkelblaue Balken** auf einer rechten mm-Achse.
  Unsicherheitsbänder: Niederschlag **hellblau**, Temperatur hellorange/hellcyan.
  Die rechte mm-Achse ist fest auf **0–6 mm** skaliert; bei höheren Mengen steht
  ein **⚡ im Balken** (= „mehr als 6 mm“).
  Oberhalb der Kurve zeigt eine Symbolreihe die **Bewölkung**
  (`cloud_cover` bzw. `cloud_cover_mean`) – im Stundentakt der Tagesansicht,
  sonst pro Tag.
- **Wind** direkt darunter, gleiche Breite: Linie in **hellgrün** mit grünem
  Band; über der Kurve zeigt ein Pfeil pro Datenpunkt die **Windrichtung**
  (Herkunftsrichtung). Eine kleine **Windrose** im Kartenkopf (Norden oben)
  dient der Orientierung. Die **linke Achse zeigt Beaufort (Bf)** – Ticks
  exakt an die echten Bf-Untergrenzen (0,3/1,6/3,4/… m/s) gesetzt –, die
  **rechte Achse km/h**. Die Diagramme haben bewusst **keine Tooltips** –
  sie überdecken auf Handydisplays die halbe Kurve; die Achsen sind
  selbsterklärend beschriftet.
- Die schattierten Bänder sind die P10–P90-Spannen des Ensembles; ohne
  Ensemble-Daten entfallen sie und ein Hinweistext erklärt das.

## Eingebundene Datenquellen

Alle Quellen sind **frei und ohne API-Schlüssel** nutzbar – es liegen daher
keine Schlüssel im Frontend. Für einen Produktivbetrieb mit hohem Traffic sind
die jeweiligen kostenlosen Kontingente zu beachten (unten).

### 1. Open-Meteo Geocoding – Städtensuche
- `https://geocoding-api.open-meteo.com/v1/search?name=…&language=de`
- Liefert außer dem Ort auch `admin1` (Bundesland/Region) und `country`,
  damit gleichnamige Orte unterscheidbar sind (z. B. Hamburg USA vs. DE).
- Datenbasis: GeoNames, Lizenz CC-BY 4.0 (Quellenangabe im Footer).

### 2. Open-Meteo Forecast – Wetterdaten
- `https://api.open-meteo.com/v1/forecast`
- Aktueller Zustand (Temperatur, gefühlte Temperatur, Wetterzustand per
  WMO-Code, Wind in **m/s** über `wind_speed_unit=ms`, Böen, Luftfeuchte,
  Luftdruck), stündliche und tägliche Werte bis **16 Tage**
  (`forecast_days=16`), Zeiten via `timezone=auto` in der Zeitzone des Ortes.
- Zusätzlich täglich: `sunrise/sunset`, `moonrise/moonset`, `moon_phase`
  (0–1 → Phase als Symbol + Name), `uv_index_max`, `sunshine_duration`,
  `is_day` (Tag/Nacht für die Kulisse) und stündlich `wind_gusts_10m`.
  Aus diesen echten Werten baut `info.js` auch den Text „Aussichten für
  heute“ – ohne erfundene Inhalte.
- Kostenfrei für nicht-kommerzielle Nutzung (Limit: 10.000 Aufrufe/Tag);
  Daten stehen unter CC-BY 4.0 – Quellenangabe ist im Footer integriert.

### 3. Open-Meteo Ensemble – Prognoseunsicherheit
- `https://ensemble-api.open-meteo.com/v1/ensemble?models=gfs_seamless`
- 30 Ensemble-Läufe (GFS) × 16 Tage, stündlich. Daraus berechnet die App
  **P10 und P90** über die Mitglieder – als schattierte Bänder um
  Temperatur- und Windlinien sowie als Bereich um die Niederschlagsbalken.
  Für Tages-/Mehrtagesansichten werden pro Mitglied Tagesmax/-min,
  Windmaximum und Niederschlagssumme gebildet und danach die Perzentile.
  Wind wird von km/h in m/s umgerechnet.
- **Ehrlichkeitsregel:** Gibt es keine Ensembledaten (z. B. Dienstausfall),
  zeigen die Diagramme keine Bänder und die Seite weist ausdrücklich darauf
  hin, dass keine Unsicherheitsangabe verfügbar ist. Es werden nie erfundene
  Werte gezeichnet.

### 4. RainViewer – Regenradar
- `https://api.rainviewer.com/public/weather-maps.json`
  liefert die letzten ~2 Stunden Radarframes (10-Minuten-Schritt) mit
  Zeitstempel; Kacheln: `{host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png`
  (Farbschema 2 „Universal Blue“, max. Zoom 7).
- Die Zeitsteuerung (Slider + ▶-Zeitraffer) zeigt den Aufnahmezeitpunkt
  deutlich in UTC und lokal an.
- **Nutzungsbedingungen:** frei für private/nicht-kommerzielle Nutzung,
  keine Erfolgsgarantie; Quellenangabe mit Link auf rainviewer.com erwünscht
  (in Karte und Footer erfolgt). Bei Ausfall zeigt die Seite eine verständliche
  Meldung statt einer leeren Karte.
- **Kartenhintergrund:** offene OpenStreetMap-Kacheln (`tile.openstreetmap.org`,
  © OpenStreetMap-Mitwirkende, ODbL), per CSS-Filter entfärbt (Klasse
  `basiskarte-dezent`, nur `grayscale`) – die Küstenstruktur bleibt gut
  lesbar und der farbige Radar-Overlay (Deckkraft 0,8) sticht deutlich heraus.
  Ein roter Punkt markiert den gewählten Ort. Deren Nutzungsrichtlinie verbietet
  intensiven Dauerbetrieb; für echten Produktivbetrieb bitte einen eigenen
  Tileserver oder einen kostenpflichtigen Anbieter verwenden.
  (CARTO-Basemaps wurden verworfen, weil sie inzwischen API-Schlüssel
  erzwingen.)
- **Legende:** Farbwerte entstammen der offiziellen RainViewer-Farbtabelle
  (dBZ-Skala); dBZ = Reflektivität, höhere Werte = stärkerer Niederschlag.
- **Vorschau (+1 h/+2 h):** RainViews kostenlose API liefert keine
  Nowcast-Kacheln mehr (Antwortfeld `nowcast` ist leer). Die Vorschau-Ebene
  leitet den erwarteten Niederschlag daher **sichtbar gekennzeichnet** aus
  echtem Modellniederschlag ab (Open-Meteo GFS, 1°-Raster, mm/h) – mit
  Tooltip je Gebiet und dem ausdrücklichen Hinweis „keine amtliche Nowcast“.

### 5. BSH – Amtliche Gezeiten (Ebbe & Flut)
- `https://gezeiten.bsh.de/data/tides_overview.json` (172 Pegel) und
  `…/data/DE__<BshNr>_tides.json` (Hoch-/Niedrigwasser mit Zeit + Höhe cm,
  Referenz meist PNP). Quelle: Bundesamt für Seeschifffahrt und Hydrographie,
  amtliche Gezeitenvorausberechnung gemäß §1 SeeAufG.
- Die BSH sendet **keinen CORS-Header** → `dev-server.py` proxyt die Dateien
  über `/bsh-api/…`; danach versucht die App noch den Direktzugriff. Ist beides
  nicht erreichbar (z. B. Handy unterwegs), zeigt die Karte automatisch die
  klar gekennzeichnete **Modell-Näherung** (Copernikus-Meeresspiegel über
  Open-Meteo Marine, weltweit ohne Proxy) samt Link auf gezeiten.bsh.de –
  nie eine Sackgasse. Ist auch die Pegelliste nicht erreichbar, wählt die App
  eine kleine eigene Auswahl von Küstenstationen (dann nur Modellwerte).
- Die Pegelauswahl enthält alle BSH-Pegel; voreingestellt ist **Husum,
  Schleuse**. Wird eine Küstenstadt (< 120 km Luftlinie) gewählt, springt die
  Auswahl automatisch auf den nächsten Pegel. Verlinkung auf den BSH-Datensatz.
- Hinweis: Höhen stehen über der Praxis-Null (PNP) bzw. NHN je Pegel – die
  Referenz wird in der Karte mit ausgegeben.

### 6. MET Norway Oceanforecast – Wassertemperatur & Wellenhöhe
- `https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=…&lon=…`
- Norwegian Meteorological Institute: Wellen aus **WAVEWATCHIII/WAM**
  (Nord-/Norwegische See 4 km Auflösung), Wassertemperatur aus
  **TOPAZ/SKAGGERRAK**. Kein API-Schlüssel, `Access-Control-Allow-Origin: *`.
- Die API snapt automatisch zum nächsten offenen See-Punkt. Liegt der
  gewählte Ort zu weit von jeder Küste entfernt (HTTP 422/leere Zeitreihe),
  probiert die App noch **Open-Meteo Marine** (Copernicus-Meer) und zeigt
  sonst nur die Luftfeuchte-Chip – es wird nichts erfunden.
- Die Chips hängen direkt über der Vorhersage (Luftfeuchte kommt aus der
  laufenden Open-Meteo-Vorhersage); der Tooltip nennt Quelle + Stand.
- **Nutzungsbedingungen:** kostenlos mit fairem Zugriff; MET Norway bittet
  um eine identifizierbare Nutzerkennung im `User-Agent`. Da Browser das
  UA-Feld nicht frei setzen können, sollte ein Produktivbetrieb über einen
  kleinen Serverproxy mit korrektem UA laufen (analog zum BSH-Proxy).

## Wetter-Kulisse (`js/himmel.js`)

Rein dekorative, wetterabhängige Szene im blauen Kopfbereich – gebaut aus
den echten aktuellen Werten (`weather_code`, `is_day`):

- **Klar bei Tag:** glowende Sonne mit langsam rotierendem Strahlenkranz.
- **Klar bei Nacht:** Mond mit Schimmer + funkelndes Sternenfeld.
- **Aufgelockert/bedeckt:** ziehende Wolken in zwei Tempo-Ebenen (nachts
  dunkler).
- **Regen/Gewitter:** fallende Regentropfen, Gewitter zusätzlich mit
  seltenem, weichem Blitzlicht; **Schnee:** flockig tanzende Flocken;
  **Nebel:** weiche driftende Schwaden.
- Barrierefrei: `aria-hidden`, keine Zeiger-Interaktion (`pointer-events:
  none`) und bei `prefers-reduced-motion: reduce` verschwinden sämtliche
  bewegten Elemente – die Kopfzeile bleibt statisch.

## Bedienung & Barrierearmut

- **Suche:** Ab 2 Zeichen, 350 ms Debounce; Vorschläge als Combobox mit
  Pfeiltasten/Enter/Escape bedienbar (WAI-ARIA-„listbox“-Muster).
- **Favoriten:** localStorage-Schlüssel `wetter.favoriten.v1`,
  Hinzufügen über „＋ Stadt merken“, Entfernen pro Chip; zuletzt gewählte
  Stadt wird beim Wiederkommen automatisch geladen
  (`wetter.letzterOrt.v1`).
- **Zeiträume:** „Ausgewählter Tag“ (stündlich), 3 Tage, 1 Woche, 16 Tage.
  Fehlende Daten werden durch Klartext-Hinweise gekennzeichnet
  (z. B. „Daten liegen nur für X Tage vor“).
- **Fehler/Ladezustände:** Skelett-Ladephase, Tastatur- und
  Screenreader-taugliche Statusmeldungen (`role="status"`/`alert`),
  Fehlerfelder mit „Erneut versuchen“-Knopf, verständliche Meldungen bei
  Netzwerk-/API-Fehlern und unzulässigen Suchen.
- Kontrastreiche Farben (WCAG-AA für Text), 40–48 px große Trefferzonen,
  Fokus-Ring, Sprungmarke „Zum Inhalt springen“, `prefers-reduced-motion`
  wird respektiert.

## Hinweis zum Produktiveinsatz

- Open-Meteo-Forecast: frei bis 10.000 Abfragen/Tag (nicht-kommerziell);
  darüber kommerzieller Plan erforderlich.
- RainViewer: ausdrücklich nur für private/persönliche Nutzung; für
  gewerbliche Produkte einen Radarvertrag bzw. RainViewer-Kommerzplan prüfen.
- OSM-Kacheln: Traffic begrenzen (Zoom-Limits, Caching) oder eigenen
  Tileserver betreiben.
- Ein Backend-Zwischenspeicher (Proxy) wird empfohlen, um API-Limits
  einzuhalten und Clients nicht pro Nutzer-counten zu lassen; die App ist so
  strukturiert, dass dafür nur `js/api.js` angepasst werden müsste.
