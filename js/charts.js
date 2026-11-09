/**
 * charts.js – Diagramme mit Chart.js 4.
 *
 * Es gibt zwei Charts:
 *  1. „Temperatur & Niederschlag“ (volle Breite):
 *     - Temperatur als Linie: Plusgrade orange, Minusgrade cyan
 *     - Niederschlag als Balken auf einer zweiten (rechten) mm-Achse, dunkelblau
 *     - zugehörige Unsicherheitsbänder (Ensemble P10–P90): Temperatur hellorange/
 *       hellcyan, Niederschlag hellblau – nur wenn die Datenquelle sie liefert
 *     - Bewölkung als kleine Symbolreihe ganz oben im Diagramm (Datenpunkte-Takt)
 *  2. „Wind“ (darunter, gleiche Breite): Linie in m/s + grünes Unsicherheitsband.
 *
 * Tooltips und Legende sind deutsch und enthalten die Einheiten.
 */

import { BEAUFORT_GRENZEN, bftAusMs } from "./wmo.js";

export const FARBEN = {
  // Temperatur: Vorzeichen-Farben der Linie
  plus:  "#ff8c1a",   // Orange  (> 0 °C)
  minus: "#00b8d4",   // Cyan    (< 0 °C)
  // Bänder um die Temperatur-/Wind-/Regenkurven
  temperaturMax: { linie: "#ff8c1a", band: "rgba(255, 152, 0, 0.16)" },
  temperaturMin: { linie: "#00b8d4", band: "rgba(0, 184, 212, 0.16)" },
  wind:          { linie: "#4fb86a", band: "rgba(79, 184, 106, 0.16)" }, // hellgrün (Wunsch)
  blitz:         "#ffcf00",
  regen:         { linie: "#0b3d91", band: "rgba(116, 166, 232, 0.40)" }, // dunkelblau / hellblau
  text: "#1c2733",
  gitter: "rgba(28, 39, 51, 0.12)",
  nullLinie: "rgba(28, 39, 51, 0.45)",   // 0-°C-Linie etwas betonen
};

/** Deutsch formatierte Zahl für Achsen und Tooltips. */
function d(wert, n = 1) {
  if (wert == null || Number.isNaN(wert)) return "";
  return Number(wert).toLocaleString("de-DE", { maximumFractionDigits: n, minimumFractionDigits: 0 });
}

/** Bewölkung in Prozent → kleines Symbol (Datenquelle: hourly cloud_cover). */
export function wolkensymbol(prozent) {
  if (prozent == null || Number.isNaN(prozent)) return "";
  if (prozent < 12.5) return "☀️";
  if (prozent < 37.5) return "🌤️";
  if (prozent < 75)   return "⛅";
  return "☁️";
}

/**
 * Chart.js-Plugin: malt die Bewölkungssymbole als schmale Zeile direkt
 * oberhalb der Zeichenfläche – passend zu den Werten des jeweiligen Charts
 * (im Stundentakt bei Tagesansicht, pro Tag bei Mehrphasenansicht).
 */
const bewoelkungsPlugin = {
  id: "bewoelkung",
  afterDatasetsDraw(chart) {
    const vorgaben = chart.options.__bewoelkung;
    if (!vorgaben?.werte?.length) return;
    const xAchse = chart.scales.x;
    const flaeche = chart.chartArea;
    const k = chart.ctx;
    k.save();
    k.font = "12px system-ui, sans-serif";
    k.textAlign = "center";
    k.textBaseline = "top";
    vorgaben.werte.forEach((wert, i) => {
      const symbol = wolkensymbol(wert);
      if (!symbol) return;
      const x = xAchse.getPixelForValue(i);
      if (x < flaeche.left - 4 || x > flaeche.right + 4) return;   // außerhalb des sichtbaren Bereichs
      k.fillText(symbol, x, flaeche.top + 1);
    });
    k.restore();
  },
};
if (typeof Chart !== "undefined") Chart.register(bewoelkungsPlugin);

/**
 * Chart.js-Plugin: Richtungspfeile für den Wind.
 * Pro Datenpunkt wird ein kleiner Pfeil in einer Zeile über dem Diagramm
 * gezeichnet und nach der Windrichtung gedreht. Meteorologisch gilt: Die
 * Richtung ist der Ursprung des Windes – der Pfeil zeigt dorthin, WOHER der
 * Wind kommt (wie Windmesser-/Kompassangabe „Wind aus NW“).
 */
const windpfeilPlugin = {
  id: "windpfeile",
  afterDatasetsDraw(chart) {
    const vorgaben = chart.options.__windrichtung;
    if (!vorgaben?.werte?.length) return;
    const xAchse = chart.scales.x;
    const flaeche = chart.chartArea;
    const k = chart.ctx;
    const farbe = vorgaben.farbe ?? FARBEN.wind.linie;
    k.save();
    k.font = "700 9px system-ui, sans-serif";
    k.textAlign = "center";
    k.textBaseline = "bottom";
    vorgaben.werte.forEach((grad, i) => {
      if (grad == null || Number.isNaN(grad)) return;
      const x = xAchse.getPixelForValue(i);
      if (x < flaeche.left - 4 || x > flaeche.right + 4) return;
      const y = flaeche.top + 11;                 // Mittelpunkt des Pfeils
      // Drehung: 0 Grad = Norden (Pfeil zeigt nach oben/oben-herkunft NW...)
      k.save();
      k.translate(x, y);
      k.rotate((grad % 360) * Math.PI / 180);
      k.strokeStyle = farbe;
      k.fillStyle = farbe;
      k.lineWidth = 1.5;
      k.beginPath();
      k.moveTo(0, 6);
      k.lineTo(0, -4);
      k.stroke();
      k.beginPath();                            // Pfeilspitze (zeigt nach Norden, wenn 0°)
      k.moveTo(-3.2, -1.5);
      k.lineTo(0, -6.5);
      k.lineTo(3.2, -1.5);
      k.closePath();
      k.fill();
      k.restore();
    });
    // Hinweis: Die Windrose im Kartenkopf erklärt die Orientierung (Norden oben).
    k.restore();
  },
};
if (typeof Chart !== "undefined") Chart.register(windpfeilPlugin);

/**
 * Chart.js-Plugin: Blitz-Symbol im Balken, wenn die Niederschlagsmenge über
 * der festen Obergrenze der rechten Achse (6 mm) liegt. Der Balken wird durch
 * die Achse automatisch bei 6 mm abgeschnitten – der ⚡-Hinweis zeigt an, dass
 * dort oben „mehr als 6 mm“ gemeint sind.
 */
const blitzPlugin = {
  id: "regenblitz",
  afterDatasetsDraw(chart) {
    const flaeche = chart.chartArea;
    chart.data.datasets.forEach((ds, index) => {
      if (ds.type !== "bar" || !ds.__blitz) return;
      const achse = chart.scales[ds.yAxisID ?? "y"];
      const meta = chart.getDatasetMeta(index);
      meta.data.forEach((element, i) => {
        const wert = ds.data[i];
        if (wert == null || wert <= achse.max) return;      // nur über der Achsengrenze
        const x = element.x;
        if (x < flaeche.left || x > flaeche.right) return;
        chart.ctx.save();
        chart.ctx.font = "14px system-ui, sans-serif";
        chart.ctx.textAlign = "center";
        chart.ctx.textBaseline = "top";
        chart.ctx.fillText("⚡", x, flaeche.top + 2);         // oben inside dem (abgeschnittenen) Balken
        chart.ctx.restore();
      });
    });
  },
};
if (typeof Chart !== "undefined") Chart.register(blitzPlugin);

/** Feste Obergrenze der Niederschlagsachse (mm) – darüber: Blitz im Balken. */
export const REGEN_ACHSEN_MAX = 6;

/** Gemeinsame Optionen; zweite mm-Achse nur, wenn sie gebraucht wird. */
function basisOptionen({ yTitel, y1Titel, beiNull, mitSymbolen }) {
  const optionen = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: mitSymbolen ? 22 : 4 } },  // Platz für die Symbolzeile
    plugins: {
      legend: {
        labels: {
          color: FARBEN.text,
          usePointStyle: true,
          generateLabels(chart) {
            const eintraege = [];
            chart.data.datasets.forEach((ds) => {
              if (ds.__rolle === "spanne-lo") {
                eintraege.push({ text: ds.label, fillStyle: ds.__bandfarbe,
                  strokeStyle: "transparent", lineWidth: 0, pointStyle: "rect" });
              } else if (!ds.__rolle) {
                eintraege.push({
                  text: ds.label,
                  fillStyle: ds.type === "bar" ? ds.backgroundColor : "transparent",
                  strokeStyle: ds.__linienfarbe ?? ds.borderColor,
                  lineWidth: 2, pointStyle: ds.__legendenPunktstil ?? "circle",
                });
              }
            });
            return eintraege;
          },
        },
        // Klicks auf die Legende verändern nichts (Würde die Bänder falsch darstellen).
        onClick: () => {},
      },
      // Tooltips bewusst AUS: Sie überdecken auf kleinen Displays (Handy!)
      // die halbe Grafik und stören beim reinen Anschauen der Kurven.
      tooltip: { enabled: false },
    },
    scales: {
      x: {
        ticks: { color: FARBEN.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 13 },
        grid: { color: FARBEN.gitter },
      },
      y: {
        title: { display: true, text: yTitel, color: FARBEN.text },
        ticks: { color: FARBEN.text, callback: (wert) => d(wert, 1) },
        // Die 0-°C-Linie wird dunkler gezeichnet → Orange/Cyan-Grenze ablesbar.
        grid: { color: (ctx) => ctx.tick.value === 0 && yTitel.includes("°C")
          ? FARBEN.nullLinie : FARBEN.gitter },
        beginAtZero: beiNull,
      },
    },
  };
  if (y1Titel) {
    optionen.scales.y1 = {
      position: "right",
      title: { display: true, text: y1Titel, color: FARBEN.regen.linie },
      ticks: { color: FARBEN.regen.linie, callback: (wert) => d(wert, 1) },
      grid: { drawOnChartArea: false },   // eigenes Gitter vermeiden (sonst Unruhe)
      min: 0, max: REGEN_ACHSEN_MAX,      // feste Skala 0–6 mm (Wunsch); darüber: Blitz
    };
  }
  return optionen;
}

const chartCache = new Map();

/**
 * Chart erstellen/ersetzen.
 * @param {string} canvasId
 * @param {object} k
 *   labels       – Beschriftung der X-Achse
 *   ausschnitt   – optional { groesse: Punkte im Standard-Ausschnitt,
 *                            start: Anfangsindex } → Diagramm startet schmal
 *                            und ist per Finger wisch-/zoombar (s. unten)
 *   hauptreihen  – [{ label, werte, typ:'linie'|'balken', farbe, einheit,
 *                     vorzeichen?: bool (Temperatur einfärben), punktstil?, yAchse?,
 *                     nachweis?, blitz?: bool }]
 *   baender      – [{ p10, p90, farbe, einheit, name, yAchse? }]
 *   yTitel       – linke Achse;  y1Titel – rechte Achse (fest 0–6 mm)
 *   beiNull      – linke Skala startet bei 0
 *   bewoelkung   – { werte: [Prozent …] } für die Symbolzeile oben
 *   windrichtung – { werte: [Grad …] }  für Richtungspfeile oben
 */
export function zeigeChart(canvasId, k) {
  const ctx = document.getElementById(canvasId);
  const datensaetze = [];

  // Zuerst die Bänder (zeichnen hinter den Hauptreihen, order höher = dahinter)
  for (const band of k.baender ?? []) {
    if (!band.p10 || !band.p90) continue;
    const grundstil = {
      type: "line", yAxisID: band.yAchse ?? "y", pointRadius: 0, pointHitRadius: 12,
      borderWidth: 1, borderDash: [4, 3], tension: 0.25, spanGaps: true, order: 5,
      __einheit: band.einheit,
    };
    datensaetze.push({
      ...grundstil, data: band.p10, order: 4,
      borderColor: band.farbe.band.replace(/[\d.]+\)$/, "0.5)"),
      fill: { target: "+1", above: band.farbe.band },
      __rolle: "spanne-lo", __bandfarbe: band.farbe.band, __hi: band.p90,
      label: `${band.name} · Spanne 10.–90. %`,
      __tooltiptitel: `Spanne (10.–90. %)${k.baender.length > 1 ? " " + band.name : ""}`,
    });
    datensaetze.push({
      ...grundstil, data: band.p90,
      borderColor: "transparent", fill: false, __rolle: "spanne-hi",
    });
  }

  // Hauptreihen (Linien/Balken)
  for (const reihe of k.hauptreihen) {
    if (reihe.typ === "balken") {
      datensaetze.push({
        label: reihe.label, type: "bar", data: reihe.werte, yAxisID: reihe.yAchse ?? "y",
        backgroundColor: reihe.farbe.linie, borderRadius: 3, maxBarThickness: 34,
        order: 1, __einheit: reihe.einheit, __nachweis: reihe.nachweis,
        __blitz: reihe.blitz,   // true: ⚡ in den Balken zeichnen, wenn Wert > Achsenmaximum
      });
    } else {
      const linie = {
        label: reihe.label, type: "line", data: reihe.werte, yAxisID: reihe.yAchse ?? "y",
        borderColor: reihe.farbe.linie, backgroundColor: reihe.farbe.linie,
        borderWidth: 2.5, pointRadius: reihe.werte.length > 40 ? 0 : 2.5,
        tension: 0.25, spanGaps: true, order: 1,
        __einheit: reihe.einheit, __nachweis: reihe.nachweis,
        __legendenPunktstil: reihe.punktstil,
        __linienfarbe: reihe.farbe.linie,   // Legendensymbol behält die Grundfarbe
      };
      if (reihe.vorzeichen) {
        // Linienabschnitte nach Vorzeichen einfärben: Orange > 0 °C, Cyan < 0 °C
        linie.segment = {
          borderColor: (c) => {
            const a = c.p0.parsed?.y, b = c.p1.parsed?.y;
            if (a == null || b == null) return FARBEN.plus;
            return (a + b) / 2 < 0 ? FARBEN.minus : FARBEN.plus;
          },
        };
        linie.pointBackgroundColor = (c) =>
          (c.raw != null && c.raw < 0) ? FARBEN.minus : FARBEN.plus;
        linie.pointBorderColor = linie.pointBackgroundColor;
      }
      datensaetze.push(linie);
    }
  }

  const optionen = basisOptionen({
    yTitel: k.yTitel, y1Titel: k.y1Titel, beiNull: k.beiNull,
    mitSymbolen: !!k.bewoelkung || !!k.windrichtung,
  });

  // Wind-Diagramm (Werte in km/h): links Beaufort (Bf, an den echten Bf-Grenzen
  // getickt), rechts km/h.
  if (k.windAchsen) {
    const alle = [
      ...k.hauptreihen.flatMap((r) => r.werte ?? []),
      ...(k.baender ?? []).flatMap((b) => [...(b.p10 ?? []), ...(b.p90 ?? [])]),
    ].filter((v) => v != null && !Number.isNaN(v));
    const achsenMax = Math.max(20, Math.ceil(Math.max(20, ...alle) * 1.15 / 10) * 10);
    optionen.scales.y = {
      position: "left",
      min: 0, max: achsenMax, beginAtZero: true,
      title: { display: true, text: "Beaufort (Bf)", color: FARBEN.text },
      grid: { color: FARBEN.gitter },
      afterBuildTicks: (achse) => {
        // Ticks genau an den Beaufort-Untergrenzen (m/s → km/h umgerechnet)
        achse.ticks = [0, ...BEAUFORT_GRENZEN.map((g) => g * 3.6).filter((g) => g <= achse.max)]
          .map((v) => ({ value: v }));
      },
      ticks: {
        color: FARBEN.text, autoSkip: false, includeBounds: false,
        callback: (wert) => (wert < 0.1 ? "0"
          : String(BEAUFORT_GRENZEN.findIndex((g) => Math.abs(g * 3.6 - wert) < 0.1) + 1)),
      },
    };
    optionen.scales.y1 = {
      position: "right",
      min: 0, max: achsenMax,
      title: { display: true, text: "km/h", color: FARBEN.wind.linie },
      ticks: { color: FARBEN.wind.linie, callback: (wert) => d(wert, 0) },
      grid: { drawOnChartArea: false },
    };
    optionen.__windZusatz = true;
  }

  optionen.__bewoelkung = k.bewoelkung;
  optionen.__windrichtung = k.windrichtung;   // { werte: [Grad …] } für das Windpfeil-Plugin

  chartCache.get(canvasId)?.destroy();
  const chart = new Chart(ctx, {
    data: { labels: k.labels, datasets: datensaetze },
    options: optionen,
  });
  chartCache.set(canvasId, chart);
  aktiviereAusschnitt(chart, ctx, k);
}

/* ------------------- Ausschnitt: wischen & zoomen -------------------------
 * Auf kleinen Displays (Handy, besonders Querformat) ist ein 24-Stunden-
 * Diagramm viel zu gedrängt. Deshalb startet es als kurzer Ausschnitt
 * (z. B. 6 Stunden) und lässt sich verschieben:
 *   · mit dem Finger wischen (horizontal)          → Ausschnitt verschieben
 *   · zwei Finger auseinander/zusammen             → mehr/weniger sehen
 *   · Doppeltippen                                 → alles zeigen – und zurück
 *   · Tastatur (Fokussierung mit Tab): ← → sowie + − und 0
 * Die Y-Achse bleibt dabei unverändert ablesbar.                                   */
function aktiviereAusschnitt(chart, canvas, k) {
  const n = (k.labels ?? []).length;
  const hinweis = document.getElementById(`${canvas.id}-hinweis`);
  const minBreite = 4;
  let breit = n, von = 0;
  if (n >= 8 && k.ausschnitt?.groesse) {
    breit = Math.min(Math.max(k.ausschnitt.groesse, minBreite + 1), n);
    von = Math.min(Math.max(k.ausschnitt.start ?? 0, 0), n - breit);
  }
  if (!Number.isFinite(breit)) breit = n;
  if (!Number.isFinite(von)) von = 0;   // nie mit NaN in die Achse schreiben
  // Erster Ausschnitt – darauf springt der Doppeltipp aus der Totalen zurück
  const startBreit = breit, startVon = von;
  const StandardAusschnitt = Math.min(Math.max(Math.round(n / 3), minBreite + 1), n);
  if (n < 8) {            // kurze Reihen (3/7 Tage): alles zeigen, nichts klemmen
    if (hinweis) hinweis.textContent = "";
    return;
  }
  canvas.setAttribute("tabindex", "0");
  canvas.style.touchAction = "pan-y";   // Hoch/Runterscrollen bleibt der Seite

  function anwenden() {
    const min = Math.round(Math.min(Math.max(von, 0), n - breit));
    chart.options.scales.x.min = min;
    chart.options.scales.x.max = min + breit - 1;
    chart.update("none");
    if (hinweis) {
      hinweis.textContent = breit >= n
        ? "Ganzer Zeitraum sichtbar · Doppeltipp zeigt wieder den Ausschnitt"
        : `Ausschnitt: ${k.labels[min]}–${k.labels[min + breit - 1]} · ${breit} von ${n} `
          + `· wischen ↔ · 2 Finger = Zoom · Doppeltipp = alles`;
    }
  }
  anwenden();

  const zeiger = new Map();
  let klemme = 0, weg = 0, losgelassen = null;   // weg: Wischstrecke, losgelassen: letzter Tipp
  const schrittBreite = () => {
    const flaeche = chart.chartArea;
    return Math.max(8, (flaeche.right - flaeche.left) / Math.max(1, breit - 1));
  };
  const verschiebe = (schritte) => {
    von = Math.round(Math.min(Math.max(von - schritte, 0), n - breit));
    anwenden();
  };

  canvas.addEventListener("pointerdown", (e) => {
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* Touchtest-Browser */ }
    if (zeiger.size === 2) {
      const [a, b] = [...zeiger.values()];
      klemme = Math.max(1, Math.abs(a.x - b.x)) / Math.max(1, breit);
    }
    weg = 0;
  });
  canvas.addEventListener("pointermove", (e) => {
    const alt = zeiger.get(e.pointerId);
    if (!alt) return;
    const dx = e.clientX - alt.x;
    if (zeiger.size === 1) {
      weg += Math.abs(dx) + Math.abs(e.clientY - alt.y);
      alt.x = e.clientX; alt.y = e.clientY;
      const s = dx / schrittBreite();          // Bewegung in Stunden/Tagen
      if (s !== 0) {
        von = Math.min(Math.max(von - s, 0), n - breit);
        anwenden();
      }
    } else if (zeiger.size === 2) {
      alt.x = e.clientX; alt.y = e.clientY;
      const [a, b] = [...zeiger.values()];
      const paare = Math.abs(a.x - b.x);
      const neueBreite = Math.round(Math.min(Math.max(paare / (klemme || 1), minBreite), n));
      if (neueBreite !== breit) {
        const mitte = von + (breit - 1) / 2;
        breit = neueBreite;
        von = Math.min(Math.max(Math.round(mitte - (breit - 1) / 2), 0), n - breit);
        anwenden();
      }
    }
  });
  const hoch = (e) => {
    zeiger.delete(e.pointerId);
    if (weg < 12) {                              // kaum Bewegung → evtl. Doppeltipp
      const jetzt = Date.now();
      if (losgelassen && jetzt - losgelassen < 400) {
        // Umschalten: Ausschnitt ⇄ ganzer Zeitraum (immer, auch aus der Totalen)
        if (breit >= n) {
          breit = Math.min(Math.max(startBreit, minBreite + 1), n);
          von = breit >= n ? 0 : Math.min(Math.max(startVon, 0), n - breit);
        } else {
          breit = n; von = 0;
        }
        anwenden();
        losgelassen = null;                      // nicht dreifach schalten
        return;
      }
      losgelassen = jetzt;
    }
  };
  canvas.addEventListener("pointerup", hoch);
  canvas.addEventListener("pointercancel", hoch);
  canvas.addEventListener("keydown", (e) => {
    const pfeile = { ArrowLeft: -1, ArrowRight: 1 };
    if (pfeile[e.key]) { verschiebe(pfeile[e.key]); e.preventDefault(); }
    else if (e.key === "+" || e.key === "-") {
      breit = Math.min(Math.max(breit + (e.key === "+" ? -3 : 3), minBreite), n);
      von = Math.min(von, n - breit); anwenden(); e.preventDefault();
    } else if (e.key === "0") { breit = n; von = 0; anwenden(); e.preventDefault(); }
  });
}

/** Alle Charts zerstören (bei Ortswechsel/Neuaufbau). */
export function chartsLoeschen() {
  chartCache.forEach((c) => c.destroy());
  chartCache.clear();
}
