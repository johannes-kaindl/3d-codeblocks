// Der ` ```3d file: `-Codeblock als MarkdownRenderChild — jetzt ein duenner Adapter
// um `ViewerHost`. Der Block kuemmert sich nur um: Config parsen, Datei aufloesen,
// `modify`-Abo, Sichtbarkeits-Observer. Alles Byte→Viewport→Poster→Fehler liegt im Host.
//
// Obsidian ruft `onunload()`, wenn es den Codeblock-DOM wegwirft (in Live Preview bei
// jedem Tastendruck) — dort disposen wir den Host und damit den WebGL-Kontext.
import { Notice, MarkdownRenderChild, type App, type TFile } from "obsidian";
import {
  NO_BLOCK_REASON,
  type ActiveViewport,
  type ViewportController,
} from "../core/active-viewport";
import { applyViewKey } from "../core/block-edit";
import { parseBlockConfig, type BlockConfig } from "../core/block-config";
import { detectFormat, type ModelFormat } from "../core/format";
import type { PluginSettings } from "../core/settings-types";
import type { ViewSpec } from "../core/view-spec";
import { toViewModel } from "../core/view-model";
import type { SceneColors } from "../viewer/scene";
import { BlockChangedError, writeBlockBody, type WritePorts } from "./block-writer";
import { readModel, resolveModelPath } from "./file-source";
import { buildBox, renderHint, renderMessage, type BoxParts } from "./render-box";
import {
  ViewerHost,
  describeError,
  needsContainerInspection,
  type ContextBudget,
  type ViewportFactory,
} from "./viewer-host";
import { buildToolbar, toolbarVisible } from "./viewport-toolbar";

// Re-Export, damit bestehende Importe (main.ts, Tests) stabil bleiben.
export type { ViewportFactory, ContextBudget, ViewportLike, ViewportCreateOptions } from "./viewer-host";

export interface BlockDeps {
  app: App;
  settings: () => PluginSettings;
  factory: ViewportFactory;
  budget: ContextBudget;
  loadModel(buffer: ArrayBuffer, format: ModelFormat, materialColor: string): Promise<unknown>;
  readColors(el: HTMLElement): SceneColors;
  active: ActiveViewport;
  writePorts: WritePorts;
  /** Zeilen dieses Blocks — `null`, wenn Obsidian sie nicht kennt (Popover, Export). */
  sectionInfo: () => { lineStart: number; lineEnd: number } | null;
  /** Ist die Sidebar (Task 10) gerade offen? Entscheidet mit, ob die Toolbar erscheint. */
  panelVisible: () => boolean;
}

export class ModelBlock extends MarkdownRenderChild implements ViewportController {
  private readonly deps: BlockDeps;
  private readonly source: string;
  private readonly sourcePath: string;

  private config: BlockConfig | null = null;
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private file: TFile | null = null;
  private loadedMtime: number | null = null;
  private observer: IntersectionObserver | null = null;
  private unsubscribeActive: (() => void) | null = null;
  private toolbar: HTMLElement | null = null;
  private unloaded = false;

  constructor(containerEl: HTMLElement, source: string, sourcePath: string, deps: BlockDeps) {
    super(containerEl);
    this.source = source;
    this.sourcePath = sourcePath;
    this.deps = deps;
  }

  onload(): void {
    const parsed = parseBlockConfig(this.source);

    if (parsed.config === null) {
      renderMessage(this.containerEl, toViewModel({ kind: "config-error", messages: parsed.errors }));
      return;
    }

    this.config = parsed.config;
    this.parts = buildBox(this.containerEl, {
      title: parsed.config.title,
      height: parsed.config.height ?? this.deps.settings().defaultHeight,
    });
    renderHint(this.parts.hint, parsed.warnings);

    this.host = new ViewerHost(this.parts.stage, this.parts.message, {
      ...this.deps,
      managed: true,
      budget: {
        register: (id, release) => this.deps.budget.register(id, release),
        unregister: (id) => this.deps.budget.unregister(id),
        touch: (id) => {
          this.deps.active.set(this);
          this.deps.budget.touch(id);
        },
      },
    });

    // Klasse aus der Registry ableiten statt einweg zu setzen — sonst bleibt
    // `tdcb-active` an jedem je beruehrten Block haengen, sobald ein anderer aktiv
    // wird (nichts setzt sie je wieder zurueck). `subscribe` liefert nur AENDERUNGEN,
    // der Anfangszustand ("nicht aktiv") ist bereits der Default ohne Klasse.
    this.unsubscribeActive = this.deps.active.subscribe((controller) => {
      this.containerEl.toggleClass("tdcb-active", controller === this);
    });

    this.syncToolbar();
    this.observeVisibility();
  }

  onunload(): void {
    this.unloaded = true;
    // Reihenfolge wichtig: erst clearIf (loest ggf. noch die Abmeld-Benachrichtigung
    // aus und nimmt die Klasse mit), dann abbestellen.
    this.deps.active.clearIf(this);
    this.unsubscribeActive?.();
    this.unsubscribeActive = null;
    this.observer?.disconnect();
    this.observer = null;
    this.host?.dispose();
    this.host = null;
  }

  // --- ViewportController -----------------------------------------------------

  label(): string {
    return this.config?.title ?? this.config?.file ?? "3D model";
  }

  getView(): ViewSpec | null {
    return this.host?.currentView() ?? null;
  }

  applyView(spec: ViewSpec | null): void {
    this.host?.applyView(spec);
  }

  canSave(): boolean {
    return this.deps.sectionInfo() !== null;
  }

  async save(spec: ViewSpec | null): Promise<void> {
    const info = this.deps.sectionInfo();
    if (info === null) {
      new Notice(NO_BLOCK_REASON);
      return;
    }

    // Obsidian liefert `source` u. U. mit einem trailing "\n" (siehe `stripTrailingNewline`).
    // `bodyAt` in block-writer.ts haengt nie einen Trenner an einen rekonstruierten Rumpf —
    // ungekuerzt wuerde der Abgleich JEDES Mal als "Note changed" scheitern und der
    // geschriebene Rumpf eine Leerzeile vor der schliessenden Fence bekommen.
    const body = stripTrailingNewline(this.source);
    const next = applyViewKey(body, spec);
    if (next === body) return;

    try {
      await writeBlockBody(
        this.deps.writePorts,
        { path: this.sourcePath, lineStart: info.lineStart, lineEnd: info.lineEnd, fence: "3d" },
        body,
        next,
      );
      new Notice(spec === null ? "View cleared" : "View saved");
    } catch (error) {
      new Notice(
        error instanceof BlockChangedError
          ? error.message
          : `Could not save view: ${describeError(error)}`,
      );
    }
  }

  /** Oeffentlich, damit Tests den Ladeweg ohne IntersectionObserver anstossen koennen. */
  async loadNow(): Promise<void> {
    if (this.unloaded || this.config === null || this.host === null) return;

    const file = resolveModelPath(this.deps.app, this.config.file, this.sourcePath);
    if (!file) {
      this.host.showError({ kind: "missing-file", path: this.config.file });
      return;
    }

    const format = detectFormat(file.path);
    if (format === null) {
      this.host.showError({ kind: "unsupported-format", path: this.config.file });
      return;
    }

    this.file = file;
    await this.host.render({
      provideBytes: async () => {
        const model = await readModel(this.deps.app, file);
        this.loadedMtime = model.mtime;
        return model.data;
      },
      format,
      inspectContainer: needsContainerInspection(file.path),
      label: this.config.title ?? file.path,
      view: this.config.view,
    });
  }

  /** Reagiert auf Regenerierung durch den Erzeuger-Loop (gleicher Pfad, neuer Inhalt). */
  async onFileModified(file: TFile): Promise<void> {
    if (this.unloaded || !this.file || !this.host) return;
    if (file.path !== this.file.path || file.stat.mtime === this.loadedMtime) return;
    await this.loadNow();
  }

  refreshColors(): void {
    this.host?.refreshColors();
  }

  /** Leiste an- oder abhaengen, je nach Einstellung und Sichtbarkeit der Sidebar. */
  syncToolbar(): void {
    if (!this.parts || this.unloaded) return;

    this.toolbar?.remove();
    this.toolbar = null;

    const { panelPlacement } = this.deps.settings();
    if (!toolbarVisible(panelPlacement, this.deps.panelVisible())) return;

    this.toolbar = buildToolbar(this.parts.root, this);
  }

  private observeVisibility(): void {
    const parts = this.parts;
    if (!parts || typeof IntersectionObserver === "undefined") return;

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.disconnect();
          this.observer = null;
          void this.loadNow();
        }
      },
      { rootMargin: "200% 0px" },
    );
    this.observer.observe(parts.root);
  }
}

/** Genau EIN trailing Zeilenende ("\n" oder "\r\n") entfernen — nicht mehr, nicht
    ueber Regex mit Rueckwaertssuche, die bei sehr langen Quellen teuer waere. Ohne
    trailing Zeilenende bleibt der Text unveraendert. */
function stripTrailingNewline(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n")) return text.slice(0, -1);
  return text;
}
