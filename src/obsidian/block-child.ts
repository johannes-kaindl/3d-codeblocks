// Der ` ```3d file: `-Codeblock als MarkdownRenderChild — jetzt ein duenner Adapter
// um `ViewerHost`. Der Block kuemmert sich nur um: Config parsen, Datei aufloesen,
// `modify`-Abo, Sichtbarkeits-Observer. Alles Byte→Viewport→Poster→Fehler liegt im Host.
//
// Obsidian ruft `onunload()`, wenn es den Codeblock-DOM wegwirft (in Live Preview bei
// jedem Tastendruck) — dort disposen wir den Host und damit den WebGL-Kontext.
import { MarkdownRenderChild, type App, type TFile } from "obsidian";
import { parseBlockConfig, type BlockConfig } from "../core/block-config";
import { detectFormat, type ModelFormat } from "../core/format";
import type { PluginSettings } from "../core/settings-types";
import { toViewModel } from "../core/view-model";
import type { SceneColors } from "../viewer/scene";
import { readModel, resolveModelPath } from "./file-source";
import { buildBox, renderHint, renderMessage, type BoxParts } from "./render-box";
import {
  ViewerHost,
  needsContainerInspection,
  type ContextBudget,
  type ViewportFactory,
} from "./viewer-host";

// Re-Export, damit bestehende Importe (main.ts, Tests) stabil bleiben.
export type { ViewportFactory, ContextBudget, ViewportLike, ViewportCreateOptions } from "./viewer-host";

export interface BlockDeps {
  app: App;
  settings: () => PluginSettings;
  factory: ViewportFactory;
  budget: ContextBudget;
  loadModel(buffer: ArrayBuffer, format: ModelFormat, materialColor: string): Promise<unknown>;
  readColors(el: HTMLElement): SceneColors;
}

export class ModelBlock extends MarkdownRenderChild {
  private readonly deps: BlockDeps;
  private readonly source: string;
  private readonly sourcePath: string;

  private config: BlockConfig | null = null;
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private file: TFile | null = null;
  private loadedMtime: number | null = null;
  private observer: IntersectionObserver | null = null;
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
    });

    this.observeVisibility();
  }

  onunload(): void {
    this.unloaded = true;
    this.observer?.disconnect();
    this.observer = null;
    this.host?.dispose();
    this.host = null;
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
