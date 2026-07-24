// Szene, Licht und optionales Bodengitter.
//
// Die Lichtfarben sind bewusst neutral-weiss: Beleuchtung ist keine UI-Farbe. Alles,
// was der Nutzer als FLAECHE sieht (Hintergrund, Material, Gitter), kommt dagegen aus
// Obsidian-Theme-Variablen (UI-STANDARD §3).
import { Color, DirectionalLight, GridHelper, HemisphereLight, Scene } from "three";

export interface SceneColors {
  background: string;
  material: string;
  grid: string;
}

export const GRID_NAME = "tdcb-grid";

// Das Grid wird NICHT hier gebaut, sondern erst wenn das Modell da ist — Größe und
// Höhe hängen an dessen Bounding-Box (der Viewport ruft `makeGrid`). Ein festes 10er-
// Grid wäre unter einem 120 großen Modell unsichtbar.
export function buildScene(colors: SceneColors): Scene {
  const scene = new Scene();
  scene.background = new Color(colors.background);

  scene.add(new HemisphereLight(0xffffff, 0x444444, 2.0));

  const key = new DirectionalLight(0xffffff, 1.2);
  key.position.set(1, 2, 1);
  scene.add(key);

  return scene;
}

/** Grid in der Größe des Modells (Grundfläche X/Z, Y-up), an dessen Unterkante. */
export function makeGrid(color: string, size: number, y: number): GridHelper {
  const c = new Color(color);
  const grid = new GridHelper(size, 10, c, c);
  grid.position.y = y;
  grid.name = GRID_NAME;
  return grid;
}
