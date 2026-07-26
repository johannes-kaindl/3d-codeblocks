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
  type TrsEdit,
} from "../core/gltf-patch";
import { glbJsonText } from "../core/gltf-inspect";
import type { EditRigCallbacks } from "../viewer/edit-controls";

export const EDIT_UNAVAILABLE_FORMAT = "Editing requires a glTF or GLB file";
export const EDIT_UNAVAILABLE_LOADING = "The model is still loading";

const same = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function trsEqual(a: NodeTrs, b: NodeTrs): boolean {
  return same(a.translation, b.translation) && same(a.scale, b.scale);
}

/** Vergleicht zwei Changesets Wert-fuer-Wert — Referenzgleichheit reicht nicht: `save()`
 * ruft `session.changes()` zweimal ab (vor und nach dem I/O), um einen waehrend des
 * Schreibens gelandeten Edit zu erkennen (Fix #5, Task-9-Review). */
function trsEditsEqual(a: TrsEdit[], b: TrsEdit[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (edit, i) => edit.index === b[i].index && trsEqual(edit, b[i]),
  );
}

/** Overlay-Eintraege fuer Nodes, die JETZT gesperrt sind, aber im Edit-File unveraendert
 * mitgeschrieben wurden, sind kein Datenverlust — der Patch schreibt immer das GANZE
 * Dokument, also taucht z.B. jeder `env__`-Node in jedem Edit-File auf. `EditSession.
 * applyOverlay` klassifiziert Gesperrtes VOR der Unveraendert-Pruefung als "lost"; ohne
 * diesen Vorfilter meldet enter() bei JEDEM Wiederbetreten faelschlich "N no longer
 * match" fuer exakt die Nodes, die der Nutzer nie anfassen durfte (Fix #3). */
function dropUnchangedLockedEntries(
  overlay: Map<string, NodeTrs>,
  session: EditSession,
): Map<string, NodeTrs> {
  const byName = new Map(session.list().map((n) => [n.name, n]));
  const filtered = new Map<string, NodeTrs>();
  for (const [name, trs] of overlay) {
    const node = byName.get(name);
    const unchangedLocked = node !== undefined && node.lock !== null && trsEqual(trs, node.base);
    if (!unchangedLocked) filtered.set(name, trs);
  }
  return filtered;
}

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
  // Monotoner Zaehler gegen Ueberholung ueber awaits hinweg (Fix #1, Task-9-Review):
  // enter()/reapplyAfterReload() ziehen ihn VOR dem ersten await, exitSilently() erhoeht
  // ihn ebenfalls. Jede Fortsetzung prueft danach, ob sie noch die aktuelle ist — sonst
  // bricht sie ab, statt verwaisten Rig/Pin-Zustand ueber einen laengst verlassenen oder
  // erneut betretenen Modus zu legen.
  private epoch = 0;

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
    if (path === null) return;
    // Epoch VOR dem ersten await ziehen — ein zweiter enter() (Doppelklick) oder ein
    // exitSilently() waehrend des Wartens erhoeht ihn erneut; diese Fortsetzung erkennt
    // daran, ueberholt zu sein (Fix #1).
    const epoch = ++this.epoch;

    let json: unknown;
    try {
      json = JSON.parse(await this.readOriginalText(path));
    } catch (error) {
      if (epoch === this.epoch) {
        this.deps.notice(`Could not read model: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (epoch !== this.epoch) return;

    const session = new EditSession(analyzeTopLevelNodes(json, this.deps.lockedPrefixes()));

    const target = editTargetPath(path);
    if (target && !target.inPlace && this.deps.io.exists(target.path)) {
      await this.applyEditFileOverlay(target.path, session);
      if (epoch !== this.epoch) return;
    }

    // Host frisch lesen statt den vor den awaits gefangenen Wert wiederzuverwenden — er
    // kann sich waehrend des Wartens geaendert haben (neuer Viewport, Teardown).
    const host = this.deps.host();
    if (host === null) return;
    const rig = host.createEditRig(this.rigCallbacks());
    if (!rig) {
      // Kein Rig → kein stiller "aktiv, aber ohne Gizmo"-Zustand (Fix #4).
      this.deps.notice(EDIT_UNAVAILABLE_LOADING);
      return;
    }

    this.session = session;
    this.rig = rig;
    for (const edit of session.changes()) {
      rig.applyTrs(edit.index, { translation: edit.translation, scale: edit.scale });
    }
    host.pin(true);
    this.deps.onChange();
  }

  async save(): Promise<void> {
    const session = this.session;
    const path = this.deps.filePath();
    if (!session || path === null) return;
    const target = editTargetPath(path);
    if (!target) return;

    // Vor dem I/O einfrieren: laendet waehrend des Schreibens noch ein Edit (z.B. ein
    // Gizmo-Drag), darf `markSaved()` das nicht stillschweigend mit-baselinen — sonst
    // gilt ein nie geschriebener Edit als gespeichert (Fix #5, kein Datenverlust §5).
    const snapshot = session.changes();

    try {
      const format = editFormatFor(path);
      if (format === "gltf-json") {
        const original = await this.deps.io.readText(path);
        await this.deps.io.writeText(target.path, patchGltfJson(original, snapshot));
      } else {
        const original = await this.deps.io.readBinary(path);
        await this.deps.io.writeBinary(target.path, patchGlbContainer(original, snapshot));
      }
      // Nur baselinen, wenn sich waehrend des Schreibens nichts mehr veraendert hat —
      // sonst bleibt die Session bewusst dirty, statt den neuen Edit zu verschlucken.
      if (trsEditsEqual(session.changes(), snapshot)) session.markSaved();
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
    if (session.dirty) {
      // Epoch VOR dem Confirm-Await ziehen (gleicher Schutz wie enter()/reapplyAfterReload(),
      // Fix #1, Task-9-Review): waehrend der Nutzer im Dialog entscheidet, kann ein Reload
      // das Rig austauschen (reapplyAfterReload() erhoeht denselben Zaehler). Diese
      // Fortsetzung erkennt sich dann als ueberholt und darf NICHT mehr das frisch geladene
      // Rig/Session unter dem alten discard()-Aufruf wegreissen (Carry-over aus Task 9).
      const epoch = ++this.epoch;
      if (!(await this.deps.confirmDiscard())) return;
      if (epoch !== this.epoch) return;
    }
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
    if (!old || path === null || this.deps.host() === null) return;
    // Gleicher Epoch-Schutz wie enter() (Fix #1): exitSilently() waehrend des Wartens
    // darf diese Fortsetzung nicht mehr auf einen laengst verlassenen Modus anwenden.
    const epoch = ++this.epoch;

    const byName = old.editsByName();
    this.rig?.dispose();
    this.rig = null;

    let json: unknown;
    try {
      json = JSON.parse(await this.readOriginalText(path));
    } catch {
      if (epoch === this.epoch) {
        this.deps.notice("Could not re-read model after reload — edit mode closed");
        this.exitSilently();
      }
      return;
    }
    if (epoch !== this.epoch) return;

    const session = new EditSession(analyzeTopLevelNodes(json, this.deps.lockedPrefixes()));
    const { lost } = session.applyOverlay(byName);
    if (lost.length > 0) this.deps.notice(`${lost.length} edited node(s) no longer exist: ${lost.join(", ")}`);
    this.session = session;
    this.selected = null;

    // Host frisch lesen statt den vor dem Warten gefangenen Wert — er kann sich waehrend
    // des Reloads geaendert haben (neuer Viewport, Teardown).
    const host = this.deps.host();
    if (host === null) {
      this.deps.onChange();
      return;
    }
    const rig = host.createEditRig(this.rigCallbacks());
    if (!rig) {
      // Session bleibt aktiv (sie ueberlebt den Reload per Definition dieser Methode),
      // aber ohne Gizmo — kein stilles "pinned ohne Rig" (Fix #4, gleiche Form).
      this.deps.notice(EDIT_UNAVAILABLE_LOADING);
      this.deps.onChange();
      return;
    }
    this.rig = rig;
    for (const edit of session.changes()) {
      rig.applyTrs(edit.index, { translation: edit.translation, scale: edit.scale });
    }
    host.pin(true);
    this.deps.onChange();
  }

  /** Beim Unload — bewusst ohne Confirm (Edits sind fluechtig, Spec §4). */
  exitSilently(): void {
    this.epoch += 1;
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
      let text: string;
      if (editFormatFor(editPath) === "gltf-json") {
        text = await this.deps.io.readText(editPath);
      } else {
        // Kein `?? "null"`-Fallback (Fix #2): ein defekter GLB-Container wuerde sonst
        // stillschweigend als "leeres Overlay" durchgehen (analyzeTopLevelNodes([]) bei
        // `null`-JSON) statt in den Catch zu fallen und die Notice auszuloesen.
        const binText = glbJsonText(await this.deps.io.readBinary(editPath));
        if (binText === null) throw new Error("not a valid GLB container");
        text = binText;
      }
      const overlay = extractTrsByName(JSON.parse(text));
      // Gesperrte, aber unveraenderte Nodes zaehlen nicht als "verloren" (Fix #3) —
      // sie stehen in JEDEM Edit-File, weil der Patch immer das ganze Dokument schreibt.
      const { applied, lost } = session.applyOverlay(dropUnchangedLockedEntries(overlay, session));
      // Verlorene Nodes benannt melden, nicht nur gezaehlt (Fix #6) — konsistent mit
      // reapplyAfterReload().
      const lostSuffix = lost.length > 0 ? ` — ${lost.length} no longer match: ${lost.join(", ")}` : "";
      if (applied > 0 || lost.length > 0) {
        this.deps.notice(`Loaded existing edits for ${applied} node(s)${lostSuffix}`);
      }
    } catch {
      this.deps.notice(`Could not read ${editPath} — starting from the original`);
    }
  }
}
