// Orchestriert den Edit-Modus: Betreten (mit Overlay), Speichern (Patch aufs frisch
// gelesene Original), Verwerfen, Reload-Ueberleben. I/O und Host sind injiziert —
// die Klasse ist ohne Obsidian und ohne three testbar.
import { TFile, type App } from "obsidian";
import { editFormatFor, editTargetPath } from "../core/edit-target";
import { EditSession, type EditRigLike, type EditUiModel } from "../core/edit-session";
import {
  analyzeTopLevelNodes,
  extractTrsByName,
  patchGlbContainer,
  patchGltfJson,
  type NodeTrs,
} from "../core/gltf-patch";
import { glbJsonText } from "../core/gltf-inspect";
import type { EditRigCallbacks } from "../viewer/edit-controls";

export const EDIT_UNAVAILABLE_FORMAT = "Editing requires a glTF or GLB file";
export const EDIT_UNAVAILABLE_LOADING = "The model is still loading";

export interface EditIo {
  exists(path: string): boolean;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeText(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

export function vaultEditIo(app: App): EditIo {
  const fileAt = (path: string): TFile | null => {
    const found = app.vault.getAbstractFileByPath(path);
    return found instanceof TFile ? found : null;
  };
  return {
    exists: (path) => fileAt(path) !== null,
    readText: async (path) => {
      const file = fileAt(path);
      if (!file) throw new Error(`File not found: ${path}`);
      return app.vault.read(file);
    },
    readBinary: async (path) => {
      const file = fileAt(path);
      if (!file) throw new Error(`File not found: ${path}`);
      return app.vault.readBinary(file);
    },
    writeText: async (path, text) => {
      const file = fileAt(path);
      if (file) await app.vault.modify(file, text);
      else await app.vault.create(path, text);
    },
    writeBinary: async (path, data) => {
      const file = fileAt(path);
      if (file) await app.vault.modifyBinary(file, data);
      else await app.vault.createBinary(path, data);
    },
  };
}

export interface EditHostLike {
  createEditRig(cb: EditRigCallbacks): EditRigLike | null;
  pin(on: boolean): void;
}

export interface EditModeDeps {
  io: EditIo;
  filePath: () => string | null;
  host: () => EditHostLike | null;
  lockedPrefixes: () => string[];
  notice: (message: string) => void;
  confirmDiscard: () => Promise<boolean>;
  onChange: () => void;
}

export class EditCoordinator {
  private session: EditSession | null = null;
  private rig: EditRigLike | null = null;
  private selected: number | null = null;
  private mode: "translate" | "scale" = "translate";

  constructor(private readonly deps: EditModeDeps) {}

  get active(): boolean {
    return this.session !== null;
  }

  availability(): { ok: boolean; reason: string | null } {
    const path = this.deps.filePath();
    if (path === null || editFormatFor(path) === null) {
      return { ok: false, reason: EDIT_UNAVAILABLE_FORMAT };
    }
    if (this.deps.host() === null) return { ok: false, reason: EDIT_UNAVAILABLE_LOADING };
    return { ok: true, reason: null };
  }

  uiModel(): EditUiModel {
    const session = this.session;
    const availability = this.availability();
    const selection =
      session && this.selected !== null
        ? {
            name: session.list().find((n) => n.index === this.selected)?.name ?? `#${this.selected}`,
            trs: session.current(this.selected) ?? { translation: [0, 0, 0], scale: [1, 1, 1] },
          }
        : null;
    return {
      active: this.active,
      disabledReason: availability.reason,
      mode: this.mode,
      dirty: session?.dirty ?? false,
      selection,
      enter: () => void this.enter(),
      save: () => void this.save(),
      discard: () => void this.discard(),
      setMode: (mode) => this.setMode(mode),
      reset: () => this.resetSelected(),
      applyTrs: (trs) => this.applyFieldEdit(trs),
    };
  }

  async enter(): Promise<void> {
    if (this.active) return;
    const availability = this.availability();
    if (!availability.ok) {
      this.deps.notice(availability.reason ?? EDIT_UNAVAILABLE_FORMAT);
      return;
    }
    const path = this.deps.filePath();
    const host = this.deps.host();
    if (path === null || host === null) return;

    let json: unknown;
    try {
      json = JSON.parse(await this.readOriginalText(path));
    } catch (error) {
      this.deps.notice(`Could not read model: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const session = new EditSession(analyzeTopLevelNodes(json, this.deps.lockedPrefixes()));
    this.session = session;

    const target = editTargetPath(path);
    if (target && !target.inPlace && this.deps.io.exists(target.path)) {
      await this.applyEditFileOverlay(target.path, session);
    }

    this.rig = host.createEditRig(this.rigCallbacks());
    for (const edit of session.changes()) this.rig?.applyTrs(edit.index, {
      translation: edit.translation,
      scale: edit.scale,
    });
    host.pin(true);
    this.deps.onChange();
  }

  async save(): Promise<void> {
    const session = this.session;
    const path = this.deps.filePath();
    if (!session || path === null) return;
    const target = editTargetPath(path);
    if (!target) return;

    try {
      const format = editFormatFor(path);
      if (format === "gltf-json") {
        const original = await this.deps.io.readText(path);
        await this.deps.io.writeText(target.path, patchGltfJson(original, session.changes()));
      } else {
        const original = await this.deps.io.readBinary(path);
        await this.deps.io.writeBinary(target.path, patchGlbContainer(original, session.changes()));
      }
      session.markSaved();
      this.deps.notice(`Edits saved to ${target.path}`);
    } catch (error) {
      // Modus und Session bleiben erhalten — kein Datenverlust (Spec §5).
      this.deps.notice(`Could not save edits: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.deps.onChange();
  }

  async discard(): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (session.dirty && !(await this.deps.confirmDiscard())) return;
    for (const edit of session.changes()) {
      session.resetNode(edit.index);
      const base = session.current(edit.index);
      if (base) this.rig?.applyTrs(edit.index, base);
    }
    this.exitSilently();
  }

  /** Nach Regenerierung + Viewer-Reload: Session per Name auf den neuen Stand legen. */
  async reapplyAfterReload(): Promise<void> {
    const old = this.session;
    const path = this.deps.filePath();
    const host = this.deps.host();
    if (!old || path === null || host === null) return;

    const byName = old.editsByName();
    this.rig?.dispose();
    this.rig = null;

    let json: unknown;
    try {
      json = JSON.parse(await this.readOriginalText(path));
    } catch {
      this.deps.notice("Could not re-read model after reload — edit mode closed");
      this.exitSilently();
      return;
    }
    const session = new EditSession(analyzeTopLevelNodes(json, this.deps.lockedPrefixes()));
    const { lost } = session.applyOverlay(byName);
    if (lost.length > 0) this.deps.notice(`${lost.length} edited node(s) no longer exist: ${lost.join(", ")}`);
    this.session = session;
    this.selected = null;

    this.rig = host.createEditRig(this.rigCallbacks());
    for (const edit of session.changes()) this.rig?.applyTrs(edit.index, {
      translation: edit.translation,
      scale: edit.scale,
    });
    host.pin(true);
    this.deps.onChange();
  }

  /** Beim Unload — bewusst ohne Confirm (Edits sind fluechtig, Spec §4). */
  exitSilently(): void {
    this.rig?.dispose();
    this.rig = null;
    this.session = null;
    this.selected = null;
    this.deps.host()?.pin(false);
    this.deps.onChange();
  }

  private setMode(mode: "translate" | "scale"): void {
    this.mode = mode;
    this.rig?.setMode(mode);
    this.deps.onChange();
  }

  private resetSelected(): void {
    const session = this.session;
    if (!session || this.selected === null) return;
    session.resetNode(this.selected);
    const base = session.current(this.selected);
    if (base) this.rig?.applyTrs(this.selected, base);
    this.deps.onChange();
  }

  private applyFieldEdit(trs: NodeTrs): void {
    const session = this.session;
    if (!session || this.selected === null) return;
    session.set(this.selected, trs);
    this.rig?.applyTrs(this.selected, trs);
    this.deps.onChange();
  }

  private handleSelect(index: number | null): void {
    this.selected = index;
    this.rig?.select(index);
    this.deps.onChange();
  }

  private rigCallbacks(): EditRigCallbacks {
    return {
      isSelectable: (index) => this.session?.isSelectable(index) ?? false,
      onSelect: (index) => this.handleSelect(index),
      onTransformEnd: (index, trs) => {
        this.session?.set(index, trs);
        this.deps.onChange();
      },
      onInteract: () => {},
    };
  }

  private async readOriginalText(path: string): Promise<string> {
    if (editFormatFor(path) === "gltf-json") return this.deps.io.readText(path);
    const text = glbJsonText(await this.deps.io.readBinary(path));
    if (text === null) throw new Error("not a valid GLB container");
    return text;
  }

  private async applyEditFileOverlay(editPath: string, session: EditSession): Promise<void> {
    try {
      const text =
        editFormatFor(editPath) === "gltf-json"
          ? await this.deps.io.readText(editPath)
          : (glbJsonText(await this.deps.io.readBinary(editPath)) ?? "null");
      const overlay = extractTrsByName(JSON.parse(text));
      const { applied, lost } = session.applyOverlay(overlay);
      const lostSuffix = lost.length > 0 ? ` — ${lost.length} no longer match` : "";
      if (applied > 0 || lost.length > 0) {
        this.deps.notice(`Loaded existing edits for ${applied} node(s)${lostSuffix}`);
      }
    } catch {
      this.deps.notice(`Could not read ${editPath} — starting from the original`);
    }
  }
}
