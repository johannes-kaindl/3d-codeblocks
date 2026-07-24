// Renderer-Lebenszyklus, on-demand-Rendering, Poster. Kennt Obsidian nicht.
//
// Zwei Eigenheiten, die kein Detail sind:
//  1. KEIN rAF-Dauerloop — ein Frame wird nur geplant, wenn sich etwas geaendert hat
//     oder Autorotate laeuft. Eine offene Notiz kostet im Ruhezustand keine GPU-Zeit.
//  2. `dispose()` gibt ALLES frei (Geometrien, Materialien, Texturen, Kontext). Obsidian
//     wirft Codeblock-DOM beim Tippen staendig weg; ohne das leckt WebGL in Minuten.
import {
  Box3,
  Color,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { fitCamera } from "../core/camera-fit";
import { GRID_NAME, type SceneColors, buildScene, makeGrid } from "./scene";

const FOV_DEG = 50;

export interface ViewportOptions {
  container: HTMLElement;
  colors: SceneColors;
  autoRotate: boolean;
  showGrid: boolean;
  onContextLost: () => void;
  onInteract: () => void;
}

export class Viewport {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly options: ViewportOptions;
  private readonly resizeObserver: ResizeObserver;
  /** Fenster des Containers, nicht das globale — sonst bricht rAF in Popout-Fenstern. */
  private readonly view: Window;

  private model: Object3D | null = null;
  private bounds: { min: Vector3; max: Vector3 } | null = null;
  private needsRender = true;
  private frame: number | null = null;
  private disposed = false;

  constructor(options: ViewportOptions) {
    this.options = options;
    this.view = options.container.ownerDocument.defaultView ?? window;

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      // Fuer `capturePoster()`: ohne das liefert `toDataURL` nach dem Frame-Wechsel
      // ein leeres Bild. Poster werden in BEIDEN Modi gebraucht (Klick-Modus und
      // LRU-Degradierung), deshalb dauerhaft an statt situativ.
      preserveDrawingBuffer: true,
      powerPreference: "default",
    });
    this.renderer.setPixelRatio(Math.min(this.view.devicePixelRatio, 2));
    options.container.appendChild(this.renderer.domElement);

    this.scene = buildScene(options.colors, options.showGrid);
    this.camera = new PerspectiveCamera(FOV_DEG, this.aspect(), 0.1, 1000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = options.autoRotate;
    this.controls.addEventListener("change", () => this.requestRender());
    // Nur echte Nutzerinteraktion fuettert das Kontext-Budget — sonst wuerde
    // Autorotate den Viewport dauerhaft als "gerade benutzt" markieren.
    this.controls.addEventListener("start", () => options.onInteract());

    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    // Doppelklick setzt die Kamera auf den Einpass-Blick zurueck.
    this.renderer.domElement.addEventListener("dblclick", this.handleDoubleClick);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(options.container);

    this.resize();
  }

  setModel(object: Object3D): void {
    if (this.disposed) return;

    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
    }

    this.model = object;
    this.scene.add(object);

    const box = new Box3().setFromObject(object);
    this.bounds = { min: box.min.clone(), max: box.max.clone() };
    this.resetCamera();
  }

  setColors(colors: SceneColors): void {
    if (this.disposed) return;

    this.scene.background = new Color(colors.background);

    const grid = this.scene.getObjectByName(GRID_NAME);
    if (grid) {
      this.scene.remove(grid);
      disposeObject(grid);
      this.scene.add(makeGrid(colors.grid));
    }

    if (this.model) {
      this.model.traverse((child) => {
        if (child instanceof Mesh && child.userData.tdcbThemedMaterial === true) {
          const material = child.material as { color?: Color };
          material.color?.set(colors.material);
        }
      });
    }

    this.requestRender();
  }

  resize(): void {
    if (this.disposed) return;

    const { clientWidth, clientHeight } = this.options.container;
    if (clientWidth === 0 || clientHeight === 0) return;

    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = this.aspect();
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  resetCamera(): void {
    if (this.disposed || !this.bounds) return;

    const fit = fitCamera(this.bounds.min, this.bounds.max, FOV_DEG, this.aspect());
    this.camera.position.set(fit.position.x, fit.position.y, fit.position.z);
    this.camera.near = fit.near;
    this.camera.far = fit.far;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(fit.target.x, fit.target.y, fit.target.z);
    this.controls.update();
    this.requestRender();
  }

  /** Aktuellen Frame als Data-URL — Grundlage des Poster-Modus. */
  capturePoster(): string | null {
    if (this.disposed) return null;
    try {
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.frame !== null) this.view.cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.removeEventListener("dblclick", this.handleDoubleClick);
    this.controls.dispose();

    disposeObject(this.scene);

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private aspect(): number {
    const { clientWidth, clientHeight } = this.options.container;
    return clientHeight > 0 ? clientWidth / clientHeight : 1;
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.options.onContextLost();
  };

  private readonly handleDoubleClick = (): void => {
    this.options.onInteract();
    this.resetCamera();
  };

  private requestRender(): void {
    this.needsRender = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame !== null || this.disposed) return;
    this.frame = this.view.requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.frame = null;
    if (this.disposed) return;

    // `update()` feuert bei echter Aenderung 'change' → setzt `needsRender`.
    this.controls.update();

    if (this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
      // Noch ein Frame, damit nachlaufendes Damping zu Ende laeuft.
      this.schedule();
    } else if (this.controls.autoRotate) {
      this.schedule();
    }
  };
}

/** Geometrien, Materialien und deren Texturen rekursiv freigeben. */
export function disposeObject(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Partial<Mesh> & Object3D;
    mesh.geometry?.dispose();

    const material = mesh.material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      disposeMaterial(entry as unknown as Record<string, unknown> & { dispose(): void });
    }
  });
}

const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "alphaMap",
  "envMap",
] as const;

function disposeMaterial(material: Record<string, unknown> & { dispose(): void }): void {
  for (const slot of TEXTURE_SLOTS) {
    const texture = material[slot];
    if (texture instanceof Texture) texture.dispose();
  }
  material.dispose();
}
