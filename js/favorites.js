/**
 * favorites.js – Favoritenliste, gespeichert im Browser (localStorage).
 * Ein Eintrag ist ein vollständiger Orts-Datensatz aus der Geocoding-Suche.
 */

const SCHLUESSEL = "wetter.favoriten.v1";

/** Alle Favoriten lesen (immer ein Array, auch bei defekten Daten). */
export function leseFavoriten() {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    const liste = roh ? JSON.parse(roh) : [];
    return Array.isArray(liste) ? liste.filter((f) => f && f.name && f.lat != null) : [];
  } catch {
    return [];
  }
}

function speichereFavoriten(liste) {
  localStorage.setItem(SCHLUESSEL, JSON.stringify(liste));
}

/** Ortsname + Region als eindeutiger Schlüssel, damit „Hamburg DE/US“ trennbar ist. */
function schluessel(ort) {
  return `${ort.name}|${ort.admin1}|${ort.country}`;
}

/** Hinzufügen; gibt true zurück, wenn neu hinzugefügt. */
export function fuelleHinzu(ort) {
  const liste = leseFavoriten();
  if (liste.some((f) => schluessel(f) === schluessel(ort))) return false;
  liste.push(ort);
  speichereFavoriten(liste);
  return true;
}

/** Entfernen (gleicher Schlüssel wie beim Hinzufügen). */
export function entferne(ort) {
  speichereFavoriten(leseFavoriten().filter((f) => schluessel(f) !== schluessel(ort)));
}

/**
 * Favoritenleiste zeichnen.
 * @param {HTMLElement} container
 * @param {(ort: object) => void} beiAuswahl   Klick auf den Chip-Text
 * @param {() => void} [nachAenderung]         zum Neubauen der Liste nach Löschen
 */
export function zeigeFavoriten(container, beiAuswahl, nachAenderung) {
  container.innerHTML = "";
  const liste = leseFavoriten();
  if (liste.length === 0) {
    const leer = document.createElement("span");
    leer.className = "bereichs-titel";
    leer.textContent = "Noch keine Favoriten – über „Stadt merken“ anlegen.";
    container.appendChild(leer);
    return;
  }
  for (const ort of liste) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.setAttribute("role", "listitem");

    // Der eigentliche, per Tastatur bedienbare Auswahl-Knopf
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.style = "all: unset; cursor: pointer; font: inherit; color: inherit;";
    knopf.textContent = ort.name;
    knopf.title = `${[ort.admin1, ort.country].filter(Boolean).join(", ")} – anzeigen`;
    knopf.addEventListener("click", () => beiAuswahl(ort));

    const loeschen = document.createElement("button");
    loeschen.className = "chip-loeschen";
    loeschen.type = "button";
    loeschen.setAttribute("aria-label", `${ort.name} aus Favoriten entfernen`);
    loeschen.textContent = "✕";
    loeschen.addEventListener("click", () => { entferne(ort); nachAenderung(); });

    chip.append(knopf, loeschen);
    container.appendChild(chip);
  }
}
