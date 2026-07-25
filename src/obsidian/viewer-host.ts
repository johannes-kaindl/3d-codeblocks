// Gemeinsamer Render-Kern aller vier Wege (Codeblock, gltf-Block, Embed, FileView).
//
// Aus einer Byte-Quelle + Format wird in `stage` ein Viewport — mit Fehlerbehandlung,
// Poster/Budget (managed) und Dispose. Die Datenquelle bleibt draussen: der Host
// bekommt einen `provideBytes`-Callback, damit er Datei, Blocktext und FileView gleich
// behandelt und fuer die on-click-Reaktivierung erneut lesen kann.
//
// `loadModel`/`readColors`/`factory` kommen als Dependency herein, damit der Kern ohne
// echtes three.js/WebGL testbar bleibt.
import { detectFormat, type ModelFormat } from "../core/format";
import { inspectGlb, unsupportedRequired } from "../core/gltf-inspect";
import type { PluginSettings } from "../core/settings-types";
import { toViewModel, type ViewerState } from "../core/view-model";
import type { ViewSpec } from "../core/view-spec";
import type { SceneColors } from "../viewer/scene";
import { renderMessage } from "./render-box";

export interface ViewportLike {
  setModel(object: unknown): void;
  setView(spec: ViewSpec | null): void;
  getView(): ViewSpec | null;
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

/** Alles, was jeder Weg zum Rendern braucht — ohne den weg-spezifischen `managed`-Schalter. */
export interface HostBaseDeps {
  settings: () => PluginSettings;
  factory: ViewportFactory;
  budget: ContextBudget;
  loadModel(buffer: ArrayBuffer, format: ModelFormat, materialColor: string): Promise<unknown>;
  readColors(el: HTMLElement): SceneColors;
}

export interface ViewerHostDeps extends HostBaseDeps {
  /** true = Poster/Budget nutzen (Inline, mehrere pro Notiz moeglich);
      false = immer voll interaktiv, kein Budget (FileView: ein Modell, ein Pane). */
  managed: boolean;
}

export interface RenderSource {
  provideBytes: () => Promise<ArrayBuffer>;
  format: ModelFormat;
  /** GLB-Container vor dem Loader pruefen (nur echte `.glb`-Dateien). */
  inspectContainer: boolean;
  /** alt-Text des Poster-Bilds. */
  label: string;
  view?: ViewSpec;
}

let nextHostId = 0;

export class ViewerHost {
  private readonly id = `tdcb-${++nextHostId}`;
  private viewport: ViewportLike | null = null;
  private posterUrl: string | null = null;
  private source: RenderSource | null = null;
  private disposed = false;

  constructor(
    private readonly stage: HTMLElement,
    private readonly message: HTMLElement,
    private readonly deps: ViewerHostDeps,
  ) {}

  /** Fehler zeigen, die VOR dem Rendern entstehen (missing-file, unsupported-format,
      invalid-gltf-json, config-error). */
  showError(state: ViewerState): void {
    this.show(state);
  }

  async render(source: RenderSource): Promise<void> {
    if (this.disposed) return;
    this.source = source;

    if (!this.deps.factory.isWebGLAvailable()) {
      this.show({ kind: "no-webgl" });
      return;
    }

    this.show({ kind: "loading" });

    let bytes: ArrayBuffer;
    try {
      bytes = await source.provideBytes();
    } catch (error) {
      this.show({ kind: "load-failed", detail: describeError(error) });
      return;
    }
    if (this.disposed) return;

    if (source.inspectContainer) {
      const inspection = inspectGlb(bytes);
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

    await this.mount(bytes, source);
  }

  refreshColors(): void {
    if (this.disposed || !this.viewport) return;
    this.viewport.setColors(this.deps.readColors(this.stage));
  }

  currentView(): ViewSpec | null {
    return this.viewport?.getView() ?? null;
  }

  applyView(spec: ViewSpec | null): void {
    this.viewport?.setView(spec);
  }

  dispose(): void {
    this.disposed = true;
    this.releaseViewport();
    this.deps.budget.unregister(this.id);
    this.posterUrl = null;
    this.source = null;
  }

  // --- intern ---------------------------------------------------------------

  private async mount(bytes: ArrayBuffer, source: RenderSource): Promise<void> {
    const colors = this.deps.readColors(this.stage);
    const settings = this.deps.settings();

    const viewport = this.deps.factory.create({
      container: this.stage,
      colors,
      autoRotate: settings.autoRotate,
      showGrid: settings.showGrid,
      onContextLost: () => this.show({ kind: "context-lost" }),
      onInteract: () => this.deps.budget.touch(this.id),
    });
    this.viewport = viewport;

    try {
      const object = await this.deps.loadModel(bytes, source.format, colors.material);
      if (this.disposed) {
        this.releaseViewport();
        return;
      }
      viewport.setModel(object);
      viewport.setView(source.view ?? null);
    } catch (error) {
      this.releaseViewport();
      this.show({ kind: "load-failed", detail: describeError(error) });
      return;
    }

    // FileView (unmanaged): ein Modell im Pane, immer voll interaktiv.
    if (!this.deps.managed) {
      this.show({ kind: "ready" });
      return;
    }

    if (settings.viewMode === "on-click") {
      this.degradeToPoster();
      return;
    }

    this.deps.budget.register(this.id, () => this.degradeToPoster());
    this.show({ kind: "ready" });
  }

  private degradeToPoster(): void {
    if (!this.viewport) return;

    this.posterUrl = this.viewport.capturePoster() ?? this.posterUrl;
    this.releaseViewport();
    this.show({ kind: "poster" });
    this.renderPoster();
  }

  private renderPoster(): void {
    this.stage.empty();

    if (this.posterUrl !== null) {
      const image = this.stage.createEl("img", { cls: "tdcb-poster" });
      image.src = this.posterUrl;
      image.alt = this.source?.label ?? "3D model still image";
    }

    const overlay = this.stage.createDiv({ cls: "tdcb-play" });
    overlay.createSpan({ text: "Click to activate" });
    overlay.addEventListener("click", () => void this.reactivate());
  }

  private async reactivate(): Promise<void> {
    if (this.disposed || !this.source) return;
    this.stage.empty();
    await this.render(this.source);
  }

  private releaseViewport(): void {
    this.viewport?.dispose();
    this.viewport = null;
  }

  private show(state: ViewerState): void {
    // Nur diese drei Zustaende brauchen die Viewport-Flaeche. Bei jedem Fehler waere
    // ein leerer Kasten in voller Hoehe nur Ballast ueber der Meldung — einklappen.
    const stageNeeded =
      state.kind === "loading" || state.kind === "ready" || state.kind === "poster";
    this.stage.toggleClass("tdcb-hidden", !stageNeeded);

    renderMessage(this.message, toViewModel(state), () => void this.retry());
  }

  private retry(): void {
    if (!this.source) return;
    this.stage.empty();
    void this.render(this.source);
  }
}

/** GLB-Container nur bei echten `.glb`-Dateien pruefen (nicht `.gltf`-JSON, nicht STL). */
export function needsContainerInspection(path: string): boolean {
  return detectFormat(path) === "gltf" && path.toLowerCase().endsWith(".glb");
}

// Exportiert, damit `block-child.ts` dieselbe Fehlertext-Hilfe nutzt statt sie zu spiegeln.
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
