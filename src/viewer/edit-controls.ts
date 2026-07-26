// Gizmo + Picking fuer den Edit-Modus. Kennt Obsidian nicht.
//
// Nur translate/scale — der rotate-Modus wird nie aktiviert (Kontrakt-Soll: das
// outpost-Datenmodell sind achsenparallele Boxen, Rotationen sind nicht abbildbar).
import { type Camera, type Object3D, Raycaster, type Scene, Vector2 } from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { EditRigLike } from "../core/edit-session";
import type { NodeTrs } from "../core/gltf-patch";

export interface EditRigContext {
  scene: Scene;
  camera: Camera;
  domElement: HTMLElement;
  modelRoot: Object3D;
  setOrbitEnabled(on: boolean): void;
  requestRender(): void;
  /** Wird als LETZTES in `dispose()` gerufen — der Viewport stellt hier z. B. den
      pausierten Autorotate wieder her. */
  onDispose?(): void;
}

export interface EditRigCallbacks {
  isSelectable(index: number): boolean;
  onSelect(index: number | null): void;
  onTransformEnd(index: number, trs: NodeTrs): void;
  onInteract(): void;
}

/** Treffer im Baum → Index des Top-Level-Vorfahren (Kind eines `root`-Kindes zaehlt zum Kind). */
export function topLevelIndex(root: Object3D, hit: Object3D): number | null {
  let node: Object3D | null = hit;
  while (node && node.parent !== root) node = node.parent;
  const index: unknown = node?.userData.tdcbNodeIndex;
  return typeof index === "number" ? index : null;
}

export function findByIndex(root: Object3D, index: number): Object3D | null {
  return root.children.find((child) => child.userData.tdcbNodeIndex === index) ?? null;
}

/** Top-Level-Indizes, die MEHRFACH unter `root` vorkommen.
 *
 * three's `GLTFLoader` klont Objekte fuer Nodes mit geteiltem mesh-Index und
 * propagiert dabei dieselbe `associations`-Wertreferenz auf alle Klone — danach koennen
 * zwei Top-Level-Kinder denselben `tdcbNodeIndex` tragen. `findByIndex` nimmt dann
 * einfach das erste: ein Klick auf Raum B verschoebe still Raum A, und gespeichert
 * wuerde der falsche JSON-Node. Solche Indizes sind nicht aufloesbar, also auch nicht
 * auswaehlbar — lieber gar keine Auswahl als die falsche. */
export function duplicatedIndices(root: Object3D): Set<number> {
  const seen = new Set<number>();
  const duplicated = new Set<number>();
  for (const child of root.children) {
    const index: unknown = child.userData.tdcbNodeIndex;
    if (typeof index !== "number") continue;
    if (seen.has(index)) duplicated.add(index);
    else seen.add(index);
  }
  return duplicated;
}

/** Die ganze Auswahl-Entscheidung als pure Funktion: aus einem Raycast-Treffer wird ein
 * auswaehlbarer Top-Level-Index — oder `null`. Herausgeloest, damit sie ohne WebGL,
 * Kamera und Pointer-Events testbar ist. `duplicated` wird VOR `isSelectable` geprueft:
 * ein mehrdeutiger Index darf gar nicht erst als Kandidat durchgereicht werden. */
export function pickIndex(
  root: Object3D,
  hit: Object3D | null,
  duplicated: ReadonlySet<number>,
  isSelectable: (index: number) => boolean,
): number | null {
  if (!hit) return null;
  const index = topLevelIndex(root, hit);
  if (index === null || duplicated.has(index)) return null;
  return isSelectable(index) ? index : null;
}

export function objectTrs(object: Object3D): NodeTrs {
  return {
    translation: [object.position.x, object.position.y, object.position.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

/** Klick-vs-Drag-Schwelle in Pixeln — ein Orbit-Drag darf nicht als Auswahl enden. */
const CLICK_TOLERANCE_PX = 5;

export class EditRig implements EditRigLike {
  private readonly controls: TransformControls;
  private readonly raycaster = new Raycaster();
  private selected: Object3D | null = null;
  private downAt: { x: number; y: number } | null = null;
  // Eigene Merker statt `controls.dragging` im pointerup zu lesen: TransformControls
  // haengt in seinem Konstruktor (`connect()`) bereits einen eigenen pointerup-Listener
  // an domElement, VOR unserem eigenen (s.u.). Bei gleichem Event-Typ laufen DOM-Listener
  // in Registrierungsreihenfolge — TransformControls setzt `dragging` also schon auf
  // `false` zurueck, bevor unser Handler ihn lesen wuerde. Ein eigenes Flag, gesetzt
  // beim Drag-Start (dragging-changed), macht die Klick-Erkennung unabhaengig davon.
  private gizmoDragged = false;
  // Einmal beim Rig-Bau bestimmt (der Modellbaum steht dann fest): Indizes, die sich
  // nicht eindeutig auf ein Objekt abbilden lassen. Zuweisung im Konstruktor-RUMPF,
  // nicht als Feld-Initialisierer — `ctx` ist eine Parameter-Property und dort noch
  // nicht garantiert gesetzt.
  private readonly duplicated: ReadonlySet<number>;

  constructor(
    private readonly ctx: EditRigContext,
    private readonly cb: EditRigCallbacks,
  ) {
    this.duplicated = duplicatedIndices(ctx.modelRoot);
    this.controls = new TransformControls(ctx.camera, ctx.domElement);
    this.controls.setMode("translate");
    ctx.scene.add(this.helper());

    this.controls.addEventListener("dragging-changed", (event) => {
      const dragging = event.value === true;
      ctx.setOrbitEnabled(!dragging);
      if (dragging) {
        this.gizmoDragged = true;
        this.cb.onInteract();
      }
      if (!dragging && this.selected) {
        const index = this.selected.userData.tdcbNodeIndex as number;
        this.cb.onTransformEnd(index, objectTrs(this.selected));
      }
    });
    this.controls.addEventListener("objectChange", () => ctx.requestRender());

    ctx.domElement.addEventListener("pointerdown", this.handlePointerDown);
    ctx.domElement.addEventListener("pointerup", this.handlePointerUp);
  }

  /** three <r169: das Control selbst ist ein Object3D; ab r169 liefert getHelper() das
   *  anzuzeigende Objekt. Feature-Detection statt Versionspin. */
  private helper(): Object3D {
    return (
      (this.controls as unknown as { getHelper?: () => Object3D }).getHelper?.() ??
      (this.controls as unknown as Object3D)
    );
  }

  setMode(mode: "translate" | "scale"): void {
    this.controls.setMode(mode);
    this.ctx.requestRender();
  }

  select(index: number | null): void {
    const target = index === null ? null : findByIndex(this.ctx.modelRoot, index);
    this.selected = target;
    if (target) this.controls.attach(target);
    else this.controls.detach();
    this.ctx.requestRender();
  }

  applyTrs(index: number, trs: NodeTrs): void {
    const target = findByIndex(this.ctx.modelRoot, index);
    if (!target) return;
    target.position.set(...trs.translation);
    target.scale.set(...trs.scale);
    this.ctx.requestRender();
  }

  dispose(): void {
    this.ctx.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.ctx.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.detach();
    this.ctx.scene.remove(this.helper());
    this.controls.dispose();
    this.ctx.setOrbitEnabled(true);
    this.ctx.requestRender();
    this.ctx.onDispose?.();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.downAt = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const down = this.downAt;
    this.downAt = null;
    // Konsumieren, bevor irgendein early return greift: ein Gizmo-Drag darf nie als
    // Auswahl-Klick durchrutschen, egal wie klein die Positionsdifferenz ausfiel.
    const wasGizmoDrag = this.gizmoDragged;
    this.gizmoDragged = false;
    if (!down) return;
    if (Math.abs(event.clientX - down.x) > CLICK_TOLERANCE_PX) return;
    if (Math.abs(event.clientY - down.y) > CLICK_TOLERANCE_PX) return;
    if (wasGizmoDrag) return;

    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hits = this.raycaster.intersectObject(this.ctx.modelRoot, true);
    const first = hits[0]?.object ?? null;
    // `isSelectable` als Lambda weiterreichen, nicht als blosse Methodenreferenz —
    // sonst haenge die Bindung an `cb` am Aufrufer.
    this.cb.onSelect(
      pickIndex(this.ctx.modelRoot, first, this.duplicated, (index) => this.cb.isSelectable(index)),
    );
  };
}
