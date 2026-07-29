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
import { readModel } from "./file-source";
import { buildBox, syncBadge, type BoxParts } from "./render-box";
import { editBadgeState } from "../core/edit-badge";
import { readOnlyController } from "./read-only-controller";
import type { TrackedView } from "./tracked-view";
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

export class ModelFileView extends FileView implements TrackedView {
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private loadedMtime: number | null = null;
  private badge: HTMLElement | null = null;
  private unloaded = false;
  /** Laufendes Render-Promise (für Tests abwartbar) — wie bei `ModelEmbed`. */
  rendering: Promise<void> = Promise.resolve();

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
      onChange: () => {
        this.syncEditFrame();
        this.deps.active.notify();
      },
    });
  }

  /** Sichtbarer Rahmen um den Viewport, solange der Edit-Modus laeuft (Spec §2.1,
      styles.css). Wie beim Embed gibt es hier keine Toolbar, an der er wie beim
      Codeblock mit haengen wuerde — ohne dieses Toggle gaebe es gar keine optische
      Rueckmeldung, dass der Modus laeuft. `parts` fehlt vor dem ersten Render. */
  private syncEditFrame(): void {
    this.parts?.viewport.toggleClass("tdcb-editing", this.edit.active);
    this.syncBadge();
  }

  /** "Unapplied edits"-Badge (Smoke-#5-Befund) — aufgerufen bei jedem Edit-Zustands-
      wechsel, nach dem Render und aus `main.ts` bei Vault-Dateiereignissen. */
  syncBadge(): void {
    if (!this.parts || this.unloaded) return;
    this.badge = syncBadge(
      this.parts.viewport,
      this.badge,
      editBadgeState({
        modelPath: this.file?.path ?? null,
        editing: this.edit.active,
        exists: (path) => this.deps.editIo.exists(path),
      }),
    );
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

    this.rendering = this.renderFile(file);
    await this.rendering;
  }

  /** Regenerierung waehrend die Datei offen ist (der Vorzeige-Loop dieses Plugins:
   *  Erzeuger schreibt die Datei neu, der Viewer zieht nach). OHNE diese Verdrahtung
   *  bliebe eine hier laufende Edit-Session nach der ersten Regenerierung dauerhaft
   *  stale — die FileView ist derselbe vollwertige Edit-Ort wie Block und Embed.
   *  Verdrahtet in `main.ts` ueber dieselbe `views`-Menge wie die Inline-Wege. */
  onFileModified(file: TFile): void {
    if (this.unloaded || this.file === null) return;
    if (file.path !== this.file.path || file.stat.mtime === this.loadedMtime) return;
    this.rendering = this.reloadAndReapply(file);
  }

  /** Regenerierung ueberlebt einen aktiven Edit — Session per Name auf den frisch
      geladenen Stand legen (wortgleich zu `ModelEmbed.reloadAndReapply()`). */
  private async reloadAndReapply(file: TFile): Promise<void> {
    await this.renderFile(file);
    if (this.edit.active) await this.edit.reapplyAfterReload();
  }

  refreshColors(): void {
    this.host?.refreshColors();
  }

  refreshAutoRotate(): void {
    this.host?.refreshAutoRotate();
  }

  /** Baut Box und Host nur, wenn sie fehlen (wie `ModelEmbed.render()`): ein Reload
      derselben Datei soll den Host WIEDERVERWENDEN, nicht die Edit-Verdrahtung unter
      dem laufenden Coordinator austauschen. `onLoadFile` erzwingt den Neubau ueber
      `teardown()`, ein Dateiwechsel bekommt also weiterhin einen frischen Host. */
  private async renderFile(file: TFile): Promise<void> {
    if (this.unloaded) return;

    if (!this.parts) {
      this.contentEl.empty();
      this.parts = buildBox(this.contentEl, { fill: true });
      this.host = new ViewerHost(this.parts.stage, this.parts.message, {
        ...this.deps,
        managed: false,
        budget: wrapBudgetWithActive(this.deps.budget, this.deps.active, this.controller),
      });
    }
    if (!this.host) return;

    const format = detectFormat(file.path);
    if (format === null) {
      this.host.showError({ kind: "unsupported-format", path: file.path });
      return;
    }

    await this.host.render({
      provideBytes: async () => {
        const model = await readModel(this.app, file);
        this.loadedMtime = model.mtime;
        return model.data;
      },
      format,
      inspectContainer: needsContainerInspection(file.path),
      label: file.basename,
    });

    // Erst hier existiert `parts` (und nach einem Dateiwechsel ein FRISCHES) — der
    // erste Badge-Zustand kann nicht frueher gezeichnet werden.
    this.syncBadge();
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
    this.unloaded = true;
    this.deps.active.clearIf(this.controller);
    this.edit.exitSilently();
    this.teardown();
  }

  private teardown(): void {
    this.host?.dispose();
    this.host = null;
    this.parts = null;
    this.loadedMtime = null;
    // MIT zuruecksetzen: `parts` wird beim naechsten Render neu gebaut, der alte
    // Badge zeigt dann in verworfenes DOM. Bliebe die Referenz stehen, wuerde
    // `syncBadge()` sie als "schon vorhanden" behandeln und den Hinweis im neuen
    // Viewport nie zeichnen (Dateiwechsel im selben Pane).
    this.badge = null;
  }
}
