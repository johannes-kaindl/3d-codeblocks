// Renderer-Lebenszyklus, on-demand-Rendering, Poster. Kennt Obsidian nicht.
//
// Zwei Eigenheiten, die kein Detail sind:
//  1. KEIN rAF-Dauerloop — ein Frame wird nur geplant, wenn sich etwas geaendert hat
//     oder Autorotate laeuft. Eine offene Notiz kostet im Ruhezustand keine GPU-Zeit.
//  2. `dispose()` gibt ALLES frei (Geometrien, Materialien, Texturen, Kontext). Obsidian
//     wirft Codeblock-DOM beim Tippen staendig weg; ohne das leckt WebGL in Minuten.
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  Mesh,
  NeutralToneMapping,
  NoToneMapping,
  Object3D,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { fitCamera, type CameraFit } from "../core/camera-fit";
import { cameraToView, viewToCamera, type ViewSpec } from "../core/view-spec";
import { EditRig, type EditRigCallbacks } from "./edit-controls";
import { fileCameraFit } from "./file-camera";
import type { FileCamera } from "./loaders";
import { decideLighting, type LightingMode, type ModelLightsMode } from "../core/lighting";
import { GRID_NAME, type SceneColors, buildScene, hasOwnLights, makeGrid, setFillLights } from "./scene";

const FOV_DEG = 50;

export interface ViewportOptions {
  container: HTMLElement;
  colors: SceneColors;
  autoRotate: boolean;
  showGrid: boolean;
  lighting: LightingMode;
  modelLights: ModelLightsMode;
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
  private currentColors: SceneColors;
  private needsRender = true;
  private frame: number | null = null;
  private disposed = false;
  /** Solange das Layout nach einem `setModel()` noch nicht STEHT, bindet `resize()` den
      Fit an die jeweils AKTUELLE Groesse nach (s. `layoutSettleSize`) — statt ihn wie
      frueher einmalig bei der ersten (moeglicherweise noch nicht endgueltigen) Groesse
      einzufrieren. Sobald zwei aufeinanderfolgende `resize()`-Aufrufe dieselbe Groesse
      melden, gilt das Layout als fertig und `resize()` faellt auf reines
      Aspect-Update zurueck (Bug B5, Task "GUI-Smoke B5 rot — Doppelklick-Reset landet
      auf distance 1": ein Block wurde bei 614px eingepasst und danach auf 314px
      verschmaelert, ohne dass die Kamera nachgezogen wurde — `getView()` maass die
      Abweichung dann faelschlich gegen die NEUE Breite). */
  private layoutSettled = false;
  private layoutSettleSize: { width: number; height: number } | null = null;
  /** Hat der Nutzer die Kamera SELBST bewegt (echter Orbit/Pan/Zoom)? Dann darf
      `resize()` den Fit nicht mehr nachziehen, egal wie instabil das Layout noch ist —
      sonst risse ein Sidebar-Wechsel eine laufende Interaktion weg. Erkannt wird das
      NICHT über OrbitControls' "start"/"end" (die haengen an `setPointerCapture` und
      feuern bei synthetischen Pointer-Events im GUI-Smoke gemessen unzuverlaessig —
      B6b blieb rot, obwohl der Orbit selbst nachweislich griff), sondern über das
      "change"-Event: jede Positions-/Zieländerung, die NICHT aus einem eigenen Fit
      (`applyFit()`) stammt, ist per Definition eine Nutzeraktion. */
  private userMoved = false;
  private applyingFit = false;
  /** Datei-Kamera, gesetzt bevor ein Modell da ist — angewendet sobald Bounds vorliegen.
      Schliesst `pendingView` gegenseitig aus: es gilt immer nur die zuletzt gesetzte Ansicht. */
  private pendingFileCamera: FileCamera | null = null;
  /** Gewuenschte Ansicht, gesetzt bevor ein Modell da ist — angewendet sobald `setModel` Bounds liefert. */
  private pendingView: ViewSpec | null = null;
  /** Vom Setting gewuenschter Autorotate-Wert — getrennt von `controls.autoRotate`,
      weil der Edit-Modus die Drehung hart pausiert (Smoke-#5-Befund: gegen ein
      rotierendes Ziel laesst sich kein Raum greifen). */
  private autoRotateWanted: boolean;
  private editSuspendsRotate = false;
  private lighting: LightingMode;
  private modelLights: ModelLightsMode;
  /** PMREM-Ergebnis. Gehoert in `dispose()` — eine entkommende Environment-Textur ist
      genau die Sorte Leck, vor der der Klassenkommentar oben warnt. */
  private environmentMap: Texture | null = null;

  constructor(options: ViewportOptions) {
    this.options = options;
    this.autoRotateWanted = options.autoRotate;
    this.lighting = options.lighting;
    this.modelLights = options.modelLights;
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

    this.currentColors = options.colors;
    // Noch ohne Modellwissen: `hasOwnLights` kann erst nach `setModel` antworten.
    // `applyLighting()` zieht die Fuelllichter dort nach.
    this.scene = buildScene(
      options.colors,
      decideLighting(this.lighting, this.modelLights, false).fillLights,
    );
    this.camera = new PerspectiveCamera(FOV_DEG, this.aspect(), 0.1, 1000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = options.autoRotate;
    this.controls.addEventListener("change", () => {
      // s. Feldkommentar an `userMoved`: jede Aenderung ausserhalb eines eigenen Fits
      // ist eine Nutzeraktion (Orbit, Pan, Zoom-Rad) — auch waehrend des Damping-
      // Nachlaufs nach einem Drag, der ja Teil derselben Interaktion ist.
      if (!this.applyingFit) this.userMoved = true;
      this.requestRender();
    });
    // Nur echte Nutzerinteraktion fuettert das Kontext-Budget — sonst wuerde
    // Autorotate den Viewport dauerhaft als "gerade benutzt" markieren.
    this.controls.addEventListener("start", () => options.onInteract());

    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    // Doppelklick setzt die Kamera auf den Einpass-Blick zurueck.
    this.renderer.domElement.addEventListener("dblclick", this.handleDoubleClick);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(options.container);

    this.applyLighting();
    this.resize();
  }

  /** Den Plan auf Renderer und Szene anwenden. Wird bei jeder Aenderung gerufen, die
      ihn beeinflussen kann: Konstruktor, `setModel` (erst dort steht fest, ob das
      Modell eigene Lichter mitbringt) und `setLighting`. */
  private applyLighting(): void {
    const plan = decideLighting(
      this.lighting,
      this.modelLights,
      this.model ? hasOwnLights(this.model) : false,
    );

    this.renderer.toneMapping =
      plan.toneMapping === "aces"
        ? ACESFilmicToneMapping
        : plan.toneMapping === "neutral"
          ? NeutralToneMapping
          : NoToneMapping;

    if (plan.environment) {
      if (!this.environmentMap) {
        const pmrem = new PMREMGenerator(this.renderer);
        this.environmentMap = pmrem.fromScene(new RoomEnvironment()).texture;
        pmrem.dispose();
      }
      this.scene.environment = this.environmentMap;
    } else {
      this.scene.environment = null;
    }

    setFillLights(this.scene, plan.fillLights);

    // Tone Mapping steckt im Shader-Programm: ohne Invalidierung behalten bereits
    // kompilierte Materialien die alte Kurve, und ein Umschalten bliebe wirkungslos.
    this.model?.traverse((child) => {
      if (child instanceof Mesh) {
        const material = child.material as { needsUpdate?: boolean } | undefined;
        if (material) material.needsUpdate = true;
      }
    });

    this.requestRender();
  }

  /** Beleuchtungs-Einstellungen zur Laufzeit anwenden — Gegenstueck zu `setAutoRotate`. */
  setLighting(lighting: LightingMode, modelLights: ModelLightsMode): void {
    if (this.disposed) return;
    this.lighting = lighting;
    this.modelLights = modelLights;
    this.applyLighting();
  }

  setModel(object: Object3D): void {
    if (this.disposed) return;

    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
    }

    this.model = object;
    this.scene.add(object);

    // Erst jetzt ist bekannt, ob das Modell eigene Lichter mitbringt.
    this.applyLighting();

    const box = new Box3().setFromObject(object);
    this.bounds = { min: box.min.clone(), max: box.max.clone() };
    this.updateGrid();
    // Neues Modell, neue Settle-Beobachtung: der Container kann sich seit dem letzten
    // Fit weiterentwickelt haben (Sidebar, Split) — `resize()` prueft ab jetzt wieder
    // von vorn, ob die aktuelle Groesse die endgueltige ist (s. Feldkommentar oben).
    this.layoutSettled = false;
    this.layoutSettleSize = { width: this.options.container.clientWidth, height: this.options.container.clientHeight };
    this.userMoved = false;
    if (this.pendingFileCamera) this.setFileCamera(this.pendingFileCamera);
    else this.setView(this.pendingView);
  }

  setColors(colors: SceneColors): void {
    if (this.disposed) return;

    this.currentColors = colors;
    this.scene.background = new Color(colors.background);
    this.updateGrid();

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

  /** "Auto-rotate"-Setting zur Laufzeit anwenden. Waehrend des Edit-Modus wird nur
      der Wunsch gemerkt — die Drehung bleibt pausiert, bis das Rig verschwindet. */
  setAutoRotate(on: boolean): void {
    if (this.disposed) return;
    this.autoRotateWanted = on;
    this.controls.autoRotate = on && !this.editSuspendsRotate;
    this.requestRender();
  }

  resize(): void {
    if (this.disposed) return;

    const { clientWidth, clientHeight } = this.options.container;
    if (clientWidth === 0 || clientHeight === 0) return;

    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = this.aspect();
    this.camera.updateProjectionMatrix();

    if (!this.layoutSettled && !this.userMoved && this.bounds) {
      const stable =
        this.layoutSettleSize?.width === clientWidth && this.layoutSettleSize?.height === clientHeight;
      if (stable) {
        this.layoutSettled = true;
      } else {
        this.layoutSettleSize = { width: clientWidth, height: clientHeight };
        // Denselben Fit, den `setModel()` schon einmal versucht hat, an der JETZT
        // aktuellen Groesse wiederholen — kein neuer Fit-Typ, nur eine neue Aspect-Basis.
        if (this.pendingFileCamera) this.setFileCamera(this.pendingFileCamera);
        else this.setView(this.pendingView);
      }
    }

    this.requestRender();
  }

  resetCamera(): void {
    this.setView(null);
  }

  /** Kamera auf die Ansicht setzen; `null` = automatisch einpassen. */
  setView(spec: ViewSpec | null): void {
    this.pendingView = spec;
    this.pendingFileCamera = null;
    if (this.disposed || !this.bounds) return;

    const fit =
      spec === null
        ? fitCamera(this.bounds.min, this.bounds.max, FOV_DEG, this.aspect())
        : viewToCamera(spec, this.bounds.min, this.bounds.max, FOV_DEG, this.aspect());

    // Zurueck auf den Haus-Bildwinkel: eine vorher angefahrene Datei-Kamera darf ihren
    // eigenen `yfov` nicht an die naechste gerechnete Ansicht vererben.
    this.camera.fov = FOV_DEG;
    this.applyFit(fit);
  }

  /** Eine in der Datei definierte Kamera exakt anfahren. Nimmt `unknown` wie `setModel`,
      damit die Obsidian-Schicht three nicht kennen muss — der Typ ist `FileCamera`.
      Danach orbitiert der Nutzer frei; das Ziel liegt auf der Blickachse des Autors.

      Der Bildwinkel der Datei wird mit uebernommen: die Position allein ergibt noch nicht
      dasselbe Bild. ⚠️ Bekannte Grenze: `getView()` misst seine Basisdistanz weiterhin bei
      `FOV_DEG`, weil `setView()` bei genau diesem Wert wiederherstellt — wer aus einer
      Datei-Kamera heraus "Save view" drueckt, bekommt deshalb einen leicht anderen
      Ausschnitt zurueck. Der Alternativfehler waere groesser: ein von Anfang an falsch
      gerahmtes Bild bei JEDEM Oeffnen statt einer Abweichung nach einem Speichervorgang. */
  setFileCamera(camera: unknown): void {
    const file = camera as FileCamera;
    this.pendingFileCamera = file;
    this.pendingView = null;
    if (this.disposed || !this.bounds) return;

    this.camera.fov = file.yfov > 0 ? (file.yfov * 180) / Math.PI : FOV_DEG;
    this.applyFit(fileCameraFit(file, this.bounds.min, this.bounds.max));
  }

  /** Kamera, Clipping und Orbit-Ziel aus einem fertigen Fit setzen — der eine Ort, an dem
      beide Wege (gerechnete Ansicht und Datei-Kamera) zusammenlaufen. */
  private applyFit(fit: CameraFit): void {
    this.applyingFit = true;
    this.camera.position.set(fit.position.x, fit.position.y, fit.position.z);
    this.camera.near = fit.near;
    this.camera.far = fit.far;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(fit.target.x, fit.target.y, fit.target.z);
    this.controls.update();
    this.applyingFit = false;
    this.requestRender();
  }

  /** Aktuelle Kamera als Spec — `null`, solange kein Modell geladen ist.
      Die Basisdistanz wird HIER neu berechnet (nicht beim Laden zwischengespeichert):
      `setView()` → `viewToCamera()` passt `fitCamera(...)` immer ans AKTUELLE
      Seitenverhaeltnis an. Ein beim Laden eingefrorener Wert waere bei aspect < 1
      (schmaler Bereich, hohe Blöcke, Handy quer→hoch) nicht mehr derselbe wie beim
      Speichern — bis zu ~1.6x daneben bei fov 50 — und die gespeicherte `view:`-Zeile
      wuerde beim naechsten Oeffnen zu nah/zu weit einrasten. Beide Richtungen muessen
      dasselbe Seitenverhaeltnis benutzen. */
  getView(): ViewSpec | null {
    if (this.disposed || !this.bounds) return null;
    const base = fitCamera(this.bounds.min, this.bounds.max, FOV_DEG, this.aspect()).distance;
    return cameraToView(this.camera.position, this.controls.target, base);
  }

  /** Rig fuer den Edit-Modus — `null`, solange kein Modell geladen ist. */
  createEditRig(cb: EditRigCallbacks): EditRig | null {
    if (this.disposed || !this.model) return null;
    // Edit-Modus pausiert die Drehung hart — gegen ein rotierendes Ziel laesst sich
    // weder klicken noch ziehen (Smoke-#5-Befund). Der Settings-Wunsch bleibt in
    // `autoRotateWanted` erhalten und kommt beim Rig-Dispose zurueck.
    this.editSuspendsRotate = true;
    this.controls.autoRotate = false;
    return new EditRig(
      {
        scene: this.scene,
        camera: this.camera,
        domElement: this.renderer.domElement,
        modelRoot: this.model,
        setOrbitEnabled: (on) => {
          this.controls.enabled = on;
        },
        requestRender: () => this.requestRender(),
        onDispose: () => {
          this.editSuspendsRotate = false;
          this.controls.autoRotate = this.autoRotateWanted;
          this.requestRender();
        },
      },
      cb,
    );
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
    this.scene.environment = null;
    this.environmentMap?.dispose();
    this.environmentMap = null;

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** Grid an die Bounding-Box anpassen: Grundfläche X/Z, an der Unterkante (min.y). */
  private updateGrid(): void {
    const existing = this.scene.getObjectByName(GRID_NAME);
    if (existing) {
      this.scene.remove(existing);
      disposeObject(existing);
    }
    if (!this.options.showGrid || !this.bounds) return;

    const extentX = this.bounds.max.x - this.bounds.min.x;
    const extentZ = this.bounds.max.z - this.bounds.min.z;
    const size = Math.max(extentX, extentZ, 1) * 1.4;
    this.scene.add(makeGrid(this.currentColors.grid, size, this.bounds.min.y));
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
