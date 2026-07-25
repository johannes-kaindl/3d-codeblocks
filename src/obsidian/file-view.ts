// Datei direkt öffnen: `.gltf/.glb/.stl` im Datei-Explorer anklicken öffnet diese
// View im ganzen Pane — wie der PDF-Viewer. `registerExtensions` verdrahtet die
// Endungen mit `VIEW_TYPE_3D` (in main.ts).
//
// Ein Modell pro Pane, immer voll interaktiv → `managed: false` (kein Poster/Budget).
// Kein Codeblock dahinter → nur steuerbar (Fit/Presets), nie speicherbar; siehe
// `readOnlyController`, den sich diese Klasse mit `ModelEmbed` teilt.
import { FileView, type TFile, type WorkspaceLeaf } from "obsidian";
import type { ActiveViewport } from "../core/active-viewport";
import { detectFormat } from "../core/format";
import { buildBox, type BoxParts } from "./render-box";
import { readOnlyController } from "./read-only-controller";
import { ViewerHost, needsContainerInspection, type HostBaseDeps } from "./viewer-host";

export const VIEW_TYPE_3D = "tdcb-3d-model";

export interface FileViewDeps extends HostBaseDeps {
  active: ActiveViewport;
}

export class ModelFileView extends FileView {
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;

  readonly controller = readOnlyController(
    () => this.host,
    () => this.file?.path ?? "3D model",
  );

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: FileViewDeps,
  ) {
    super(leaf);
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
    this.teardown();

    this.contentEl.empty();
    this.parts = buildBox(this.contentEl, { fill: true });
    this.host = new ViewerHost(this.parts.stage, this.parts.message, {
      ...this.deps,
      managed: false,
      budget: {
        register: (id, release) => this.deps.budget.register(id, release),
        unregister: (id) => this.deps.budget.unregister(id),
        touch: (id) => {
          this.deps.active.set(this.controller);
          this.deps.budget.touch(id);
        },
      },
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
    this.teardown();
  }

  onunload(): void {
    // Reihenfolge wie in ModelBlock: erst clearIf (raeumt nur auf, wenn diese View
    // auch die aktive war), dann erst den Host disposen — sonst saehe ein waehrend
    // `clearIf` benachrichtigter Listener schon einen toten Host.
    this.deps.active.clearIf(this.controller);
    this.teardown();
  }

  private teardown(): void {
    this.host?.dispose();
    this.host = null;
    this.parts = null;
  }
}
