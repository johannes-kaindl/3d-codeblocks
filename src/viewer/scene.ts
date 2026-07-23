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

export function buildScene(colors: SceneColors, showGrid: boolean): Scene {
  const scene = new Scene();
  scene.background = new Color(colors.background);

  scene.add(new HemisphereLight(0xffffff, 0x444444, 2.0));

  const key = new DirectionalLight(0xffffff, 1.2);
  key.position.set(1, 2, 1);
  scene.add(key);

  if (showGrid) scene.add(makeGrid(colors.grid));

  return scene;
}

export function makeGrid(color: string): GridHelper {
  const grid = new GridHelper(10, 10, new Color(color), new Color(color));
  grid.name = GRID_NAME;
  return grid;
}
