// Datei direkt öffnen: `.gltf/.glb/.stl` im Datei-Explorer anklicken öffnet diese
// View im ganzen Pane — wie der PDF-Viewer. `registerExtensions` verdrahtet die
// Endungen mit `VIEW_TYPE_3D` (in main.ts).
//
// Ein Modell pro Pane, immer voll interaktiv → `managed: false` (kein Poster/Budget).
// Kein Codeblock dahinter → nur steuerbar (Fit/Presets), nie speicherbar; siehe
// `readOnlyController`, den sich diese Klasse mit `ModelEmbed` teilt.
import { FileView, Notice, type TFile, type WorkspaceLeaf } from "obsidian";
import type { ActiveViewport } from "../core/active-viewport";
import { detectFormat } from "../core/format";
import { parseLockedPrefixes } from "../core/settings-types";
import { EditCoordinator, type EditIo } from "./edit-mode";
import { buildBox, type BoxParts } from "./render-box";
import { readOnlyController } from "./read-only-controller";
import {
  ViewerHost,
  needsContainerInspection,
  wrapBudgetWithActive,
  type HostBaseDeps,
} from "./viewer-host";

export const VIEW_TYPE_3D = "tdcb-3d-model";

export interface FileViewDeps extends HostBaseDeps {
  active: ActiveViewport;
  /** I/O fuer den Edit-Modus (Original lesen, Edit-Datei schreiben) — `vaultEditIo(app)`. */
  editIo: EditIo;
  /** Bestaetigungsdialog vorm Verwerfen ungespeicherter Edits. */
  confirmDiscard: () => Promise<boolean>;
}

export class ModelFileView extends FileView {
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;

  /** Kein Toolbar in dieser View — nur die Sidebar (Task 12) bedient den Edit-Modus. */
  private readonly edit: EditCoordinator;

  readonly controller = readOnlyController(
    () => this.host,
    () => this.file?.path ?? "3D model",
    () => this.edit.uiModel(),
  );

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: FileViewDeps,
  ) {
    super(leaf);
    this.edit = new EditCoordinator({
      io: this.deps.editIo,
      filePath: () => this.file?.path ?? null,
      host: () => this.host,
      lockedPrefixes: () => parseLockedPrefixes(this.deps.settings().lockedNodePrefixes),
      notice: (m) => new Notice(m),
      confirmDiscard: this.deps.confirmDiscard,
      onChange: () => this.deps.active.notify(),
    });
  }

  getViewType(): string {
    return VIEW_TYPE_3D;
  }

  getIcon(): string {
    return "box";
  }

  getDisplayText(): string {
    return this.file?.basename ?? "3D model";
  }

  async onLoadFile(file: TFile): Promise<void> {
    // Dateiwechsel im selben Pane ist KEIN Reload desselben Modells (anders als
    // `onFileModified` bei Block/Embed) — ein ggf. aktiver Edit muss vor dem neuen
    // Host still enden, sonst haengt der Coordinator am toten alten Host/Rig.
    this.edit.exitSilently();
    this.teardown();

    this.contentEl.empty();
    this.parts = buildBox(this.contentEl, { fill: true });
    this.host = new ViewerHost(this.parts.stage, this.parts.message, {
      ...this.deps,
      managed: false,
      budget: wrapBudgetWithActive(this.deps.budget, this.deps.active, this.controller),
    });

    const format = detectFormat(file.path);
    if (format === null) {
      this.host.showError({ kind: "unsupported-format", path: file.path });
      return;
    }

    await this.host.render({
      provideBytes: () => this.app.vault.readBinary(file),
      format,
      inspectContainer: needsContainerInspection(file.path),
      label: file.basename,
    });
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    // Ohne das bleibt die Registry beim Dateiwechsel im selben Pane auf diesem
    // Controller stehen, obwohl der Host schon weg ist (bis `onLoadFile` einen neuen
    // baut) — `clearIf` raeumt nur auf, wenn dieser Controller auch der aktive war.
    this.deps.active.clearIf(this.controller);
    // VOR dem Host-Dispose: der Coordinator disposed sein Rig noch auf dem lebenden
    // Viewport (kein Confirm, Edits sind fluechtig — Spec §4).
    this.edit.exitSilently();
    this.teardown();
  }

  onunload(): void {
    // Reihenfolge wie in ModelBlock: erst clearIf (raeumt nur auf, wenn diese View
    // auch die aktive war), dann Edit still beenden, dann erst den Host disposen —
    // sonst saehe ein waehrend `clearIf` benachrichtigter Listener schon einen toten Host.
    this.deps.active.clearIf(this.controller);
    this.edit.exitSilently();
    this.teardown();
  }

  private teardown(): void {
    this.host?.dispose();
    this.host = null;
    this.parts = null;
  }
}
