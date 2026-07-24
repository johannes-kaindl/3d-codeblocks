// Theme-Farben aus den Obsidian-CSS-Variablen lesen (UI-STANDARD §3: keine festen
// Farben im Plugin). Die Rueckfallwerte greifen nur, wenn Obsidian gar keine Variable
// liefert — ohne sie bekaeme three eine leere Farbe und der Hintergrund waere schwarz.
import type { SceneColors } from "../viewer/scene";

const FALLBACK: SceneColors = {
  background: "#1e1e1e",
  material: "#888888",
  grid: "#444444",
};

export function readSceneColors(el: HTMLElement): SceneColors {
  const style = getComputedStyle(el);
  const read = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  };

  return {
    background: read("--background-primary", FALLBACK.background),
    material: read("--text-muted", FALLBACK.material),
    grid: read("--background-modifier-border", FALLBACK.grid),
  };
}
