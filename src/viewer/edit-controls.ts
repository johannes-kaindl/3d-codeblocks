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
  const index = node?.userData.tdcbNodeIndex;
  return typeof index === "number" ? index : null;
}

export function findByIndex(root: Object3D, index: number): Object3D | null {
  return root.children.find((child) => child.userData.tdcbNodeIndex === index) ?? null;
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

  constructor(
    private readonly ctx: EditRigContext,
    private readonly cb: EditRigCallbacks,
  ) {
    this.controls = new TransformControls(ctx.camera, ctx.domElement);
    this.controls.setMode("translate");
    // three <r169: das Control selbst ist ein Object3D; ab r169 liefert getHelper()
    // das anzuzeigende Objekt. Feature-Detection statt Versionspin.
    const helper =
      (this.controls as unknown as { getHelper?: () => Object3D }).getHelper?.() ??
      (this.controls as unknown as Object3D);
    ctx.scene.add(helper);

    this.controls.addEventListener("dragging-changed", (event) => {
      const dragging = event.value === true;
      ctx.setOrbitEnabled(!dragging);
      if (dragging) this.cb.onInteract();
      if (!dragging && this.selected) {
        const index = this.selected.userData.tdcbNodeIndex as number;
        this.cb.onTransformEnd(index, objectTrs(this.selected));
      }
    });
    this.controls.addEventListener("objectChange", () => ctx.requestRender());

    ctx.domElement.addEventListener("pointerdown", this.handlePointerDown);
    ctx.domElement.addEventListener("pointerup", this.handlePointerUp);
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
    const helper =
      (this.controls as unknown as { getHelper?: () => Object3D }).getHelper?.() ??
      (this.controls as unknown as Object3D);
    this.ctx.scene.remove(helper);
    this.controls.dispose();
    this.ctx.setOrbitEnabled(true);
    this.ctx.requestRender();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.downAt = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const down = this.downAt;
    this.downAt = null;
    if (!down) return;
    if (Math.abs(event.clientX - down.x) > CLICK_TOLERANCE_PX) return;
    if (Math.abs(event.clientY - down.y) > CLICK_TOLERANCE_PX) return;
    if ((this.controls as unknown as { dragging?: boolean }).dragging) return;

    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hits = this.raycaster.intersectObject(this.ctx.modelRoot, true);
    const first = hits[0]?.object ?? null;
    const index = first ? topLevelIndex(this.ctx.modelRoot, first) : null;
    this.cb.onSelect(index !== null && this.cb.isSelectable(index) ? index : null);
  };
}
