// Der Edit-Zustand — die Wahrheit des Editors. Pure; die three.js-Szene ist nur Anzeige.
//
// Zwei Bezugspunkte, bewusst getrennt: `changes()` vergleicht gegen das ORIGINAL
// (der Patch schreibt immer die Gesamt-Abweichung), `dirty` gegen den letzten
// Save-Stand (steuert nur den Speichern-Button).
import type { EditableNode, NodeTrs, TrsEdit, Vec3 } from "./gltf-patch";

export interface EditRigLike {
  setMode(mode: "translate" | "scale"): void;
  select(index: number | null): void;
  applyTrs(index: number, trs: NodeTrs): void;
  dispose(): void;
}

/** Ein UI-Modell fuer BEIDE Bedienorte (Toolbar am Block, Sidebar-Panel). */
export interface EditUiModel {
  active: boolean;
  disabledReason: string | null;
  mode: "translate" | "scale";
  dirty: boolean;
  selection: { name: string; trs: NodeTrs } | null;
  enter(): void;
  save(): void;
  discard(): void;
  setMode(mode: "translate" | "scale"): void;
  reset(): void;
  applyTrs(trs: NodeTrs): void;
}

const same = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const sameTrs = (a: NodeTrs, b: NodeTrs) => same(a.translation, b.translation) && same(a.scale, b.scale);
const copy = (trs: NodeTrs): NodeTrs => ({ translation: [...trs.translation], scale: [...trs.scale] });

export class EditSession {
  private readonly byIndex = new Map<number, EditableNode>();
  private readonly currentTrs = new Map<number, NodeTrs>();
  private readonly savedTrs = new Map<number, NodeTrs>();

  constructor(private readonly nodes: EditableNode[]) {
    for (const node of nodes) {
      this.byIndex.set(node.index, node);
      this.currentTrs.set(node.index, copy(node.base));
      this.savedTrs.set(node.index, copy(node.base));
    }
  }

  list(): EditableNode[] {
    return this.nodes;
  }

  isSelectable(index: number): boolean {
    return this.byIndex.get(index)?.lock === null;
  }

  current(index: number): NodeTrs | null {
    const trs = this.currentTrs.get(index);
    return trs ? copy(trs) : null;
  }

  set(index: number, trs: NodeTrs): void {
    if (!this.isSelectable(index)) return;
    this.currentTrs.set(index, copy(trs));
  }

  resetNode(index: number): void {
    const node = this.byIndex.get(index);
    if (node) this.currentTrs.set(index, copy(node.base));
  }

  get dirty(): boolean {
    for (const [index, trs] of this.currentTrs) {
      const saved = this.savedTrs.get(index);
      if (saved && !sameTrs(trs, saved)) return true;
    }
    return false;
  }

  /** Abweichungen vom ORIGINAL — das ist, was der Patch schreibt. */
  changes(): TrsEdit[] {
    const edits: TrsEdit[] = [];
    for (const node of this.nodes) {
      const trs = this.currentTrs.get(node.index);
      if (trs && !sameTrs(trs, node.base)) {
        edits.push({ index: node.index, translation: [...trs.translation], scale: [...trs.scale] });
      }
    }
    return edits;
  }

  markSaved(): void {
    for (const [index, trs] of this.currentTrs) this.savedTrs.set(index, copy(trs));
  }

  applyOverlay(byName: Map<string, NodeTrs>): { applied: number; lost: string[] } {
    const lost: string[] = [];
    let applied = 0;
    const byNodeName = new Map(this.nodes.map((n) => [n.name, n]));
    for (const [name, trs] of byName) {
      const node = byNodeName.get(name);
      if (!node || node.lock !== null) {
        lost.push(name);
        continue;
      }
      // Overlay nur zaehlen, wenn es wirklich abweicht — sonst meldet die Notice
      // "N uebernommen" fuer Nodes, die im Edit-File unveraendert mitgeschrieben wurden.
      if (sameTrs(trs, node.base)) continue;
      this.currentTrs.set(node.index, copy(trs));
      applied += 1;
    }
    return { applied, lost };
  }

  /** Abweichungen vom Original, per Name — fuers Wieder-Anwenden nach einem Reload. */
  editsByName(): Map<string, NodeTrs> {
    const map = new Map<string, NodeTrs>();
    for (const edit of this.changes()) {
      const node = this.byIndex.get(edit.index);
      if (node) map.set(node.name, { translation: edit.translation, scale: edit.scale });
    }
    return map;
  }
}
