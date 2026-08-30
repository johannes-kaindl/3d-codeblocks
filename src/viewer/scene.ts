// Szene, Licht und optionales Bodengitter.
//
// Die Lichtfarben sind bewusst neutral-weiss: Beleuchtung ist keine UI-Farbe. Alles,
// was der Nutzer als FLAECHE sieht (Hintergrund, Material, Gitter), kommt dagegen aus
// Obsidian-Theme-Variablen (UI-STANDARD §3).
import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Light,
  Object3D,
  Scene,
} from "three";

export interface SceneColors {
  background: string;
  material: string;
  grid: string;
}

export const GRID_NAME = "tdcb-grid";
export const FILL_LIGHT_NAME = "tdcb-fill-light";

// Das Grid wird NICHT hier gebaut, sondern erst wenn das Modell da ist — Größe und
// Höhe hängen an dessen Bounding-Box (der Viewport ruft `makeGrid`). Ein festes 10er-
// Grid wäre unter einem 120 großen Modell unsichtbar.
export function buildScene(colors: SceneColors, withFillLights: boolean): Scene {
  const scene = new Scene();
  scene.background = new Color(colors.background);
  setFillLights(scene, withFillLights);
  return scene;
}

/** Die plugin-eigenen Lichter an- oder abhaengen. Idempotent: zweimal einschalten
    haengt nicht zwei Saetze an (sonst ueberstrahlt die Szene nach ein paar
    Settings-Wechseln, und der Fehler sieht aus wie ein Beleuchtungsproblem). */
export function setFillLights(scene: Scene, on: boolean): void {
  for (const child of [...scene.children]) {
    if (child.name === FILL_LIGHT_NAME) {
      scene.remove(child);
      (child as Light).dispose?.();
    }
  }
  if (!on) return;

  const ambient = new HemisphereLight(0xffffff, 0x444444, 2.0);
  ambient.name = FILL_LIGHT_NAME;
  scene.add(ambient);

  const key = new DirectionalLight(0xffffff, 1.2);
  key.position.set(1, 2, 1);
  key.name = FILL_LIGHT_NAME;
  scene.add(key);
}

/** Bringt das geladene Modell eigene Lichter mit? `GLTFLoader` haengt
    `KHR_lights_punctual` als three-`Light` in den Szenenbaum, sie sind also schon da,
    wenn `setModel` laeuft. STL und die uebrigen Formate liefern nie welche. */
export function hasOwnLights(object: Object3D): boolean {
  let found = false;
  object.traverse((child) => {
    if ((child as Light).isLight === true) found = true;
  });
  return found;
}

/** Grid in der Größe des Modells (Grundfläche X/Z, Y-up), an dessen Unterkante. */
export function makeGrid(color: string, size: number, y: number): GridHelper {
  const c = new Color(color);
  const grid = new GridHelper(size, 10, c, c);
  grid.position.y = y;
  grid.name = GRID_NAME;
  return grid;
}
