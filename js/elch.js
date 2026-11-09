/**
 * elch.js – Der Wetter-Elch unter dem blauen Kopf.
 *
 * Passt das Kuscheltier-Bild unter der Kopfzeile an Wetter, Tages- und
 * Jahreszeit an und wechselt bei jedem Datenladen:
 *  · tagsüber  → passend zum WMO-Wettercode (Sonne, Niesel-, Starkregen,
 *                Gewitter, Hagel, Schnee, Schneesturm, Eisglätte, Nebel, Sturm …)
 *  · Sonne nach Regen der letzten Stunden → Regenbogen
 *  · sehr heiß (ab 32 °C)                 → Hitzewelle
 *  · nachts    → Elch schläft (nur in der ersten Stunde nach Sonnenuntergang
 *                schaut er bei klarem Himmel noch Sternen/Nordlicht zu)
 *  · Frühling/Herbst bei lockerem Himmel  → Jahreszeitenbild
 *  · 1. Dezember bis 6. Januar            → weihnachtliche Elche
 *  · Karfreitag bis Weiße Sonntag         → österliche Elche (täglich Wechsel)
 *
 * Die Bilder liegen in img/elche/ (Dateiname = Schlüssel). In der
 * Einzeldatei-Version wird ELCH_BILDER vom Build-Skript mit Data-URIs gefüllt.
 */

const BILD_ORDNER = "img/elche/";
const ELCH_BILDER = {}; // ELCH_BUILD_MARKER – Einzeldatei-Build füllt diese Karte

/** Quelle für einen Elch-Schlüssel: eingebettetes Bild oder Datei im img-Ordner. */
function elchQuelle(schluessel) {
  return ELCH_BILDER[schluessel] ?? `${BILD_ORDNER}${schluessel}.jpg`;
}

/** Kurzer freundlicher Spruch unter dem Bild. */
const ELCH_SPRUECHE = {
  sonnig: "Sonnengruß vom Elch – genieß den Tag!",
  teil_sonnig: "Ein bisschen Sonne, ein bisschen Wolke – der Elch ist zufrieden.",
  bewoelkt: "Kuschlig bedeckt – der Elch bleibt locker.",
  nieseln: "Tropfen für die Blumen – der Elch hat seine Mütze auf.",
  regen: "Regenzeit ist Kuschelzeit – der Elch steht trotzdem im Grünen.",
  starkregen: "Da gießt es richtig – der Elch hält tapfer dagegen.",
  gewitter: "Es donnert – der Elch drückt sich sicherheitshalber flach hin.",
  hagel: "Hagel! Da hält der Elch die Geweihspitzen hoch.",
  schnee: "Erster Schnee – der Elch ist extra kuschelig angezogen.",
  schneesturm: "Sturm und Schnee – der Elch bleibt lieber nah am Stall.",
  eisglaette: "Vorsicht, glatt! Der Elch tritt fest auf.",
  nebel: "Nebelbank – der Elch tapst langsam und neugierig weiter.",
  sturm: "Starker Wind – das Geweih dient als Seitenwind-Stütze.",
  hitzewelle: "Puh, heiß! Der Elch sucht ein schattiges Plätzchen.",
  regenbogen: "Sonne nach dem Regen – der Elch strahlt mit dem Regenbogen um die Wette.",
  klare_nacht: "Klare Nacht – der Elch schaut still hinauf zu den Sternen.",
  nordlicht: "Nordlichter-Nacht – der Elch kann vor Staunen kaum schlafen.",
  schlafen: "Pssst – nachts schläft der Elch tief und fest auf seiner Mondsichel.",
  fruehling: "Frühling! Der Elch tollt durch die ersten Blumen.",
  herbst: "Herbstzeit – der Elch mag es golden und gemütlich.",
  xmas_advent: "Advent, Advent – der Elch zählt schon die Tage.",
  xmas_nikolaus: "Der Nikolaus war wohl schon da – der Elch grinst.",
  xmas_heiligabend: "Stille Nacht – der Elch hält gebannt die Luft an.",
  xmas_bescherung: "Bescherung! Der Elch hat auch ein Geschenk gefunden.",
  xmas_tannenbaum: "O Tannenbaum – der Elch bewundert das Lichtermeer.",
  xmas_schneekugel: "Schneekristall-Zauber – der Elch purzelt durch den Schnee.",
  xmas_frost: "Frostiger Morgen – der Elch atmet Wölkchen.",
  xmas_fenster: "Fensterln in der Adventszeit – der Elch leuchtet von innen.",
  xmas_schlitten: "Schlittenfahrt! Der Elch ist bereit für die Tour.",
  xmas_schnee: "Weiße Weihnachten – genau so stellt sich der Elch das vor.",
  ostern_eier: "Frohe Ostern! Der Elch hat die Eier ausgeguckt.",
  ostern_hase: "Hase, wo bist du? Der Elch sucht mit großen Kulleraugen.",
  ostern_nest: "Ein schön gebettetes Osternest – der Elch ist ganz stolz.",
  ostern_weide: "Die ersten Weidenkätzchen – der Elch nascht nicht etwa.",
  ostern_krokusse: "Krokusse überall – der Elch tippelt vorsichtig durchs Beet.",
  ostern_guss: "Guss für die Hütte – der Elch feiert mit euch.",
};

/* ------------------------- Hilfsrechnungen ------------------------- */

/** Minuten nach dem heutigen Sonnenuntergang am Ort (null ohne Daten). */
function minutenNachSonnenuntergang(vor, jetzt) {
  const untergang = vor.daily?.sunset?.[0];
  if (!untergang) return null;
  const u = new Date(untergang);           // Open-Meteo liefert Ortszeit, z. B. "2026-11-09T16:45"
  if (isNaN(u)) return null;
  const gleichTicken = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate(),
                                jetzt.getHours(), jetzt.getMinutes());
  return (gleichTicken - u) / 60000;       // für deutsche Orte identisch zur Zuschaueruhr
}

/** Ostersonntag nach Meeus (anonymer Gregorianischer Kalender). */
function ostersonntag(jahr) {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tageszahl = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jahr, monat - 1, tageszahl);
}

/** Tage zwischen zwei Kalendertagen (auf Mitternacht normalisiert). */
function tagesAbstand(von, bis) {
  const MITTERNACHT = 24 * 3600 * 1000;
  const a = new Date(von.getFullYear(), von.getMonth(), von.getDate());
  const b = new Date(bis.getFullYear(), bis.getMonth(), bis.getDate());
  return Math.round((b - a) / MITTERNACHT);
}

/** Hat es in den letzten drei Stunden vor „jetzt“ (Ortszeit der API) geregnet? */
function kurzZuvorRegen(vor) {
  const h = vor.hourly;
  if (!h?.time?.length || !h.precipitation) return false;
  let ende = h.time.indexOf(vor.current?.time);
  if (ende < 0) ende = 1;
  for (let i = Math.max(0, ende - 3); i < ende; i++) {
    if ((h.precipitation[i] ?? 0) > 0.1) return true;
  }
  return false;
}

/* ------------------------- Elch-Auswahl ---------------------------- */

/** Wählt den Elch-Schlüssel für die aktuelle Situation. */
export function waehleElch(vor, jetzt = new Date()) {
  const c = vor.current ?? {};
  const code = c.weather_code;
  const boen = c.wind_gusts_10m ?? 0;
  const temp = c.temperature_2m ?? 15;
  const istTag = c.is_day == null
    ? jetzt.getHours() >= 7 && jetzt.getHours() < 19
    : c.is_day === 1;
  const monat = jetzt.getMonth() + 1;
  const tag = jetzt.getDate();

  /* Nacht: Der Elch schläft. Nur kurz nach Sonnenuntergang bleibt er wach und
     staunt bei klarem Himmel über Sterne (Winter: Nordlicht) – dann schläft auch
     er ein. */
  if (!istTag) {
    if (code == null || code <= 1) {
      const abend = minutenNachSonnenuntergang(vor, jetzt);
      if (abend != null && abend >= 0 && abend <= 90) {
        return monat >= 11 || monat <= 2 ? "nordlicht" : "klare_nacht";
      }
    }
    return "schlafen";
  }

  /* Ostern: Karfreitag bis Weißer Sonntag, danach täglich wechselnd. */
  const os = ostersonntag(jetzt.getFullYear());
  const karfreitag = new Date(os.getTime() - 2 * 86400000);
  const seitKarfreitag = tagesAbstand(karfreitag, jetzt);
  if (seitKarfreitag >= 0 && seitKarfreitag <= 10) {
    const reihenfolge = ["ostern_guss", "ostern_weide", "ostern_eier", "ostern_hase",
                         "ostern_nest", "ostern_krokusse"];
    return reihenfolge[seitKarfreitag % reihenfolge.length];
  }

  /* Weihnachtszeit: 1. Dezember bis 6. Januar – feste Anlässe, sonst Wechsel. */
  if (monat === 12 || (monat === 1 && tag <= 6)) {
    const schneeCode = (code >= 71 && code <= 77) || code === 85 || code === 86;
    if (monat === 12) {
      if (tag === 6) return "xmas_nikolaus";
      if (tag === 24) return "xmas_heiligabend";
      if (tag === 25) return "xmas_bescherung";
      if (tag === 26) return "xmas_schlitten";
    }
    if (monat === 1 && tag === 1) return "xmas_frost";
    if (schneeCode) return "xmas_schnee";
    const weihnachtsPool = ["xmas_advent", "xmas_tannenbaum", "xmas_schneekugel",
                            "xmas_fenster", "xmas_schlitten", "xmas_frost", "xmas_schnee"];
    return weihnachtsPool[tag % weihnachtsPool.length];
  }

  /* Sturm-Warnung: böiger Wind ohne Niederschlag – noch vor den Jahreszeiten. */
  if (boen >= 17 && (code == null || code <= 3) && (c.precipitation ?? 0) < 0.05) {
    return "sturm";
  }

  /* Frühling (ab 20. März) und Herbst (September bis November) bei lockerem Himmel. */
  if (code != null && code <= 3) {
    const fruehling = (monat === 3 && tag >= 20) || monat === 4 || monat === 5
      || (monat === 6 && tag <= 20);
    const herbst = monat === 9 || monat === 10 || monat === 11;
    if (fruehling) return "fruehling";
    if (herbst) return "herbst";
  }

  if (code == null) return "sonnig";
  if (code === 96 || code === 99) return "hagel";
  if (code === 95) return "gewitter";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return boen >= 15 ? "schneesturm" : "schnee";
  }
  if (code === 56 || code === 57 || code === 66 || code === 67) return "eisglaette";
  if (code === 45 || code === 48) return "nebel";
  if (code === 51 || code === 53 || code === 55) return "nieseln";
  if (code === 61 || code === 63 || code === 65 || code === 80 || code === 81 || code === 82) {
    return (code === 65 || code === 82 || (c.precipitation ?? 0) >= 2) ? "starkregen" : "regen";
  }
  if (code <= 1) {
    if (temp >= 32) return "hitzewelle";
    if (kurzZuvorRegen(vor)) return "regenbogen";
    return "sonnig";
  }
  if (code === 2) return "teil_sonnig";
  return "bewoelkt";
}

/* ------------------------------ Anzeige ---------------------------- */

/** Setzt Elch-Bild und Spruch unter dem blauen Kopf neu zusammen. */
export function elchAktualisieren(vor) {
  const bild = document.getElementById("elch-bild");
  const spruch = document.getElementById("elch-spruch");
  if (!bild || !vor?.current) return;
  const schluessel = waehleElch(vor);
  bild.src = elchQuelle(schluessel);
  bild.alt = `Plüsch-Elch passend zum Wetter: ${ELCH_SPRUECHE[schluessel] ?? ""}`;
  bild.hidden = false;
  if (spruch) spruch.textContent = ELCH_SPRUECHE[schluessel] ?? "";
}
