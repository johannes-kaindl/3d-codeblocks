// Ein 3D-Codeblock als MarkdownRenderChild.
//
// Warum MarkdownRenderChild und nicht eigene Buchhaltung: Obsidian wirft den
// Codeblock-DOM beim Tippen in Live Preview staendig weg und ruft dabei `onunload()`.
// Genau dort geben wir den WebGL-Kontext frei — ohne das leckt der Renderer in Minuten.
//
// `loadModel` und `readColors` kommen als Dependency herein, damit der Lebenszyklus
// ohne three.js/WebGL testbar bleibt.
import { MarkdownRenderChild, type App, type TFile } from "obsidian";
import { parseBlockConfig, type BlockConfig } from "../core/block-config";
import { detectFormat, type ModelFormat } from "../core/format";
import { inspectGlb, unsupportedRequired } from "../core/gltf-inspect";
import type { PluginSettings } from "../core/settings-types";
import { toViewModel, type ViewerState } from "../core/view-model";
import type { SceneColors } from "../viewer/scene";
import { readModel, resolveModelPath } from "./file-source";
import { buildBox, renderHint, renderMessage, type BoxParts } from "./render-box";

export interface ViewportLike {
  setModel(object: unknown): void;
  setColors(colors: SceneColors): void;
  resize(): void;
  resetCamera(): void;
  capturePoster(): string | null;
  dispose(): void;
}

export interface ViewportCreateOptions {
  container: HTMLElement;
  colors: SceneColors;
  autoRotate: boolean;
  showGrid: boolean;
  onContextLost: () => void;
  onInteract: () => void;
}

export interface ViewportFactory {
  create(options: ViewportCreateOptions): ViewportLike;
  isWebGLAvailable(): boolean;
}

export interface ContextBudget {
  register(id: string, release: () => void): void;
  touch(id: string): void;
  unregister(id: string): void;
}

export interface BlockDeps {
  app: App;
  settings: () => PluginSettings;
  factory: ViewportFactory;
  budget: ContextBudget;
  loadModel(buffer: ArrayBuffer, format: ModelFormat, materialColor: string): Promise<unknown>;
  readColors(el: HTMLElement): SceneColors;
}

let nextBlockId = 0;

export class ModelBlock extends MarkdownRenderChild {
  private readonly id = `tdcb-${++nextBlockId}`;
  private readonly deps: BlockDeps;
  private readonly source: string;
  private readonly sourcePath: string;

  private config: BlockConfig | null = null;
  private parts: BoxParts | null = null;
  private viewport: ViewportLike | null = null;
  private file: TFile | null = null;
  private loadedMtime: number | null = null;
  private posterUrl: string | null = null;
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

    this.observeVisibility();
  }

  onunload(): void {
    this.unloaded = true;
    this.observer?.disconnect();
    this.observer = null;
    this.releaseViewport();
    this.deps.budget.unregister(this.id);
    this.posterUrl = null;
  }

  /** Oeffentlich, damit Tests den Ladeweg ohne IntersectionObserver anstossen koennen. */
  async loadNow(): Promise<void> {
    if (this.unloaded || this.config === null || this.parts === null) return;

    const file = resolveModelPath(this.deps.app, this.config.file, this.sourcePath);
    if (!file) {
      this.show({ kind: "missing-file", path: this.config.file });
      return;
    }

    const format = detectFormat(file.path);
    if (format === null) {
      this.show({ kind: "unsupported-format", path: this.config.file });
      return;
    }

    // Vor dem Lesen: ohne WebGL ist die Datei egal, und der Nutzer soll den
    // eigentlichen Grund sehen statt eines Folgefehlers.
    if (!this.deps.factory.isWebGLAvailable()) {
      this.show({ kind: "no-webgl" });
      return;
    }

    this.file = file;
    this.show({ kind: "loading" });

    let model;
    try {
      model = await readModel(this.deps.app, file);
    } catch (error) {
      this.show({ kind: "load-failed", detail: describe(error) });
      return;
    }
    if (this.unloaded) return;

    if (format === "gltf" && file.path.toLowerCase().endsWith(".glb")) {
      const inspection = inspectGlb(model.data);
      if (!inspection.valid) {
        this.show({ kind: "invalid-file" });
        return;
      }
      const blocked = unsupportedRequired(inspection);
      if (blocked.length > 0) {
        this.show({ kind: "compressed-gltf", extensions: blocked });
        return;
      }
    }

    this.loadedMtime = model.mtime;
    await this.mount(model.data, format);
  }

  /** Reagiert auf Regenerierung durch den Erzeuger-Loop (gleicher Pfad, neuer Inhalt). */
  async onFileModified(file: TFile): Promise<void> {
    if (this.unloaded || !this.file || file.path !== this.file.path) return;
    if (file.stat.mtime === this.loadedMtime) return;

    this.releaseViewport();
    this.posterUrl = null;
    await this.loadNow();
  }

  refreshColors(): void {
    if (this.unloaded || !this.viewport || !this.parts) return;
    this.viewport.setColors(this.deps.readColors(this.parts.stage));
  }

  // --- intern ---------------------------------------------------------------

  private async mount(data: ArrayBuffer, format: ModelFormat): Promise<void> {
    const parts = this.parts;
    if (!parts) return;

    const colors = this.deps.readColors(parts.stage);
    const settings = this.deps.settings();

    const viewport = this.deps.factory.create({
      container: parts.stage,
      colors,
      autoRotate: settings.autoRotate,
      showGrid: settings.showGrid,
      onContextLost: () => this.show({ kind: "context-lost" }),
      onInteract: () => this.deps.budget.touch(this.id),
    });
    this.viewport = viewport;

    try {
      const object = await this.deps.loadModel(data, format, colors.material);
      if (this.unloaded) {
        this.releaseViewport();
        return;
      }
      viewport.setModel(object);
    } catch (error) {
      this.releaseViewport();
      this.show({ kind: "load-failed", detail: describe(error) });
      return;
    }

    if (settings.viewMode === "on-click") {
      // Einmal rendern, Standbild sichern, Kontext sofort wieder freigeben —
      // beim Durchscrollen sieht man dann Etagen statt Dateinamen.
      this.degradeToPoster();
      return;
    }

    this.deps.budget.register(this.id, () => this.degradeToPoster());
    this.show({ kind: "ready" });
  }

  private degradeToPoster(): void {
    if (!this.viewport || !this.parts) return;

    this.posterUrl = this.viewport.capturePoster() ?? this.posterUrl;
    this.releaseViewport();
    this.show({ kind: "poster" });
    this.renderPoster();
  }

  private renderPoster(): void {
    const parts = this.parts;
    if (!parts) return;

    parts.stage.empty();

    if (this.posterUrl !== null) {
      const image = parts.stage.createEl("img", { cls: "tdcb-poster" });
      image.src = this.posterUrl;
      image.alt = this.config?.title ?? "3D model still image";
    }

    const overlay = parts.stage.createDiv({ cls: "tdcb-play" });
    overlay.createSpan({ text: "Click to activate" });
    overlay.addEventListener("click", () => void this.reactivate());
  }

  private async reactivate(): Promise<void> {
    if (this.unloaded || !this.file || !this.parts) return;

    const format = detectFormat(this.file.path);
    if (format === null) return;

    this.parts.stage.empty();
    this.show({ kind: "loading" });

    try {
      const model = await readModel(this.deps.app, this.file);
      if (this.unloaded) return;
      this.loadedMtime = model.mtime;

      const parts = this.parts;
      const colors = this.deps.readColors(parts.stage);
      const settings = this.deps.settings();

      const viewport = this.deps.factory.create({
        container: parts.stage,
        colors,
        autoRotate: settings.autoRotate,
        showGrid: settings.showGrid,
        onContextLost: () => this.show({ kind: "context-lost" }),
        onInteract: () => this.deps.budget.touch(this.id),
      });
      this.viewport = viewport;
      viewport.setModel(await this.deps.loadModel(model.data, format, colors.material));

      this.deps.budget.register(this.id, () => this.degradeToPoster());
      this.show({ kind: "ready" });
    } catch (error) {
      this.releaseViewport();
      this.show({ kind: "load-failed", detail: describe(error) });
    }
  }

  private releaseViewport(): void {
    this.viewport?.dispose();
    this.viewport = null;
  }

  private show(state: ViewerState): void {
    // Nur diese drei Zustaende brauchen die Viewport-Flaeche. Bei jedem Fehler
    // waere ein leerer schwarzer Kasten in voller Hoehe nur Ballast ueber der
    // Meldung — also einklappen.
    const stageNeeded =
      state.kind === "loading" || state.kind === "ready" || state.kind === "poster";
    this.parts?.stage.toggleClass("tdcb-hidden", !stageNeeded);

    const host = this.parts?.message ?? this.containerEl;
    renderMessage(host, toViewModel(state), () => void this.loadNow());
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
      // Grosszuegiger Vorlauf: laden, bevor der Block ins Bild scrollt.
      { rootMargin: "200% 0px" },
    );
    this.observer.observe(parts.root);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
