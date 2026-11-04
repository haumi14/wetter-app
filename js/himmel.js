/**
 * himmel.js – Dekorative Wetter-Kulisse im Kopfbereich der Startseite.
 *
 * Die Szene wird aus dem aktuellen Wetterzustand (WMO-Code + is_day) gebaut:
 *   · Sonne (tagsüber bei klar/hochnebel)      – glowender Kern + Drehstrahlen
 *   · Mond + Sternenfeld (nachts bei klar)     – Mondsichel mit Schimmer
 *   · ziehende Wolken                           – zwei Ebenen mit verschiedenen Tempi
 *   · Regentropfen / Schnee                     – per Zufall verteilte Elemente
 *   · Nebelschwaden                             – weiche wandernde Bänder
 *   · Gewitter                                  – Regen + gelegentlicher Blitz
 *
 * Rein visuell, aria-hidden, und aus Respekt vor Bewegungsempfindlichkeit
 * komplett statisch bei "prefers-reduced-motion: reduce".
 */

const KULISSE_ID = "himmels-kulisse";

/* WMO-Gruppen: https://open-meteo.com/en/docs -> WMO Weather interpretation codes */
function wetterGruppe(code) {
  if (code == null) return "klar";
  if (code <= 1) return "klar";
  if (code === 2 || code === 3) return "wolken";       // auflockernd / bedeckt
  if (code === 45 || code === 48) return "nebel";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "regen";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "schnee";
  if (code >= 95) return "gewitter";
  return "wolken";
}

const zufallsZahl = (min, max) => min + Math.random() * (max - min);

function element(klasse, stil = {}) {
  const k = document.createElement("div");
  k.className = klasse;
  Object.assign(k.style, stil);
  return k;
}

/* ------------------------------ Szenenbausteine ---------------------------- */

function fuegeSonneBei(kulisse) {
  const kern = element("kulisse-sonne");
  const strahlen = element("kulisse-sonnen-strahlen");
  kern.appendChild(strahlen);
  kulisse.appendChild(kern);
}

function fuegeMondBei(kulisse, anzahlSterne) {
  kulisse.appendChild(element("kulisse-mond"));
  for (let i = 0; i < anzahlSterne; i++) {
    kulisse.appendChild(element("kulisse-stern", {
      left: `${zufallsZahl(2, 98)}%`,
      top: `${zufallsZahl(4, 70)}%`,
      width: `${zufallsZahl(1.5, 3.5)}px`,
      height: `${zufallsZahl(1.5, 3.5)}px`,
      animationDelay: `${zufallsZahl(0, 4)}s`,
      animationDuration: `${zufallsZahl(2.4, 5)}s`,
    }));
  }
}

function fuegeWolkenBei(kulisse, anzahl, { schnell = false } = {}) {
  for (let i = 0; i < anzahl; i++) {
    const dauer = schnell ? zufallsZahl(26, 40) : zufallsZahl(50, 90);
    kulisse.appendChild(element("kulisse-wolke", {
      top: `${zufallsZahl(2, 55)}%`,
      transform: `scale(${zufallsZahl(0.7, 1.6)})`,
      opacity: `${zufallsZahl(0.35, 0.8)}`,
      animationDuration: `${dauer}s`,
      animationDelay: `-${zufallsZahl(0, dauer)}s`,
    }));
  }
}

function fuegeRegenBei(kulisse, anzahl) {
  for (let i = 0; i < anzahl; i++) {
    const dauer = zufallsZahl(0.5, 1.1);
    kulisse.appendChild(element("kulisse-tropfen", {
      left: `${zufallsZahl(-5, 100)}%`,
      animationDuration: `${dauer}s`,
      animationDelay: `-${zufallsZahl(0, dauer)}s`,
      opacity: `${zufallsZahl(0.35, 0.9)}`,
    }));
  }
}

function fuegeSchneeBei(kulisse, anzahl) {
  for (let i = 0; i < anzahl; i++) {
    const dauer = zufallsZahl(4, 9);
    kulisse.appendChild(element("kulisse-flocke", {
      left: `${zufallsZahl(-5, 100)}%`,
      width: `${zufallsZahl(3, 7)}px`,
      height: `${zufallsZahl(3, 7)}px`,
      animationDuration: `${dauer}s`,
      animationDelay: `-${zufallsZahl(0, dauer)}s`,
      opacity: `${zufallsZahl(0.4, 0.95)}`,
    }));
  }
}

function fuegeNebelBei(kulisse) {
  for (let i = 0; i < 3; i++) {
    const dauer = zufallsZahl(40, 70);
    kulisse.appendChild(element("kulisse-nebel", {
      top: `${20 + i * 26}%`,
      animationDuration: `${dauer}s`,
      animationDelay: `-${zufallsZahl(0, dauer)}s`,
      opacity: `${zufallsZahl(0.25, 0.5)}`,
    }));
  }
}

function fuegeBlitzBei(kulisse) {
  // Gelegentliches, helles Aufleuchten der ganzen Fläche (kein grelles Flackern).
  const blitz = element("kulisse-blitz");
  blitz.style.animationDuration = `${zufallsZahl(7, 14)}s`;
  kulisse.appendChild(blitz);
}

/* ------------------------------- Hauptschnittstelle ------------------------ */

/**
 * Baut die Kulisse passend zum aktuellen Wetter neu auf.
 * @param {{weather_code?: number, is_day?: number}} current  current-Werte der API
 */
export function wetterKulisseAnwenden(current) {
  const kulisse = document.getElementById(KULISSE_ID);
  if (!kulisse) return;

  const gruppe = wetterGruppe(current?.weather_code);
  const istTag = current?.is_day == null ? istTagsueber() : current.is_day === 1;

  kulisse.className = `himmels-kulisse kulisse-${gruppe}${istTag ? "" : " kulisse-nacht"}`;
  kulisse.innerHTML = ""; // alte Szene vollständig entfernen

  // Himmelskörper
  if (gruppe === "klar" || gruppe === "wolken") {
    if (istTag) fuegeSonneBei(kulisse);
    else fuegeMondBei(kulisse, gruppe === "klar" ? 40 : 18);
  } else if (gruppe === "gewitter" || gruppe === "regen") {
    if (!istTag) fuegeMondBei(kulisse, 0); // dezenter Mond hinter dichten Wolken unten
  }

  // Wolken: bei "klar" keine, bei bedeckt/regen viele.
  if (gruppe === "wolken") fuegeWolkenBei(kulisse, current.weather_code === 3 ? 7 : 4);
  if (gruppe === "regen" || gruppe === "schnee" || gruppe === "gewitter") fuegeWolkenBei(kulisse, 5, { schnell: true });
  if (gruppe === "nebel") fuegeNebelBei(kulisse);

  // Niederschlag
  if (gruppe === "regen") fuegeRegenBei(kulisse, 45);
  if (gruppe === "gewitter") { fuegeRegenBei(kulisse, 60); fuegeBlitzBei(kulisse); }
  if (gruppe === "schnee") fuegeSchneeBei(kulisse, 35);
}

/** Fallback, falls is_day fehlt: einfach Tageszeit (07–19 Uhr) annehmen. */
function istTagsueber() {
  const stunde = new Date().getHours();
  return stunde >= 7 && stunde < 19;
}
