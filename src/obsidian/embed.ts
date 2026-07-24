// `![[datei.gltf]]`-Embeds. Obsidian rendert dafuer einen `.internal-embed`-Span; ein
// Markdown-Postprocessor faengt die 3d-Dateien ab und haengt einen ViewerHost hinein.
// (Es gibt keine dedizierte public Embed-API — der Postprocessor-Weg ist store-konform.)
import { MarkdownRenderChild, type App, type Plugin, type TFile } from "obsidian";
import { matchModelEmbed, type EmbedSrc } from "../core/embed-src";
import { detectFormat } from "../core/format";
import { buildBox, type BoxParts } from "./render-box";
import { readModel, resolveModelPath } from "./file-source";
import type { TrackedView } from "./tracked-view";
import { ViewerHost, needsContainerInspection, type HostBaseDeps } from "./viewer-host";

export type { TrackedView } from "./tracked-view";

export interface EmbedDeps extends HostBaseDeps {
  app: App;
}

export class ModelEmbed extends MarkdownRenderChild {
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private file: TFile | null = null;
  private loadedMtime: number | null = null;
  private unloaded = false;
  /** Laufendes Render-Promise (fuer Tests abwartbar). */
  rendering: Promise<void> = Promise.resolve();

  constructor(
    containerEl: HTMLElement,
    private readonly embed: EmbedSrc,
    private readonly sourcePath: string,
    private readonly deps: EmbedDeps,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.parts = buildBox(this.containerEl, {
      height: this.embed.height ?? this.deps.settings().defaultHeight,
    });
    this.host = new ViewerHost(this.parts.stage, this.parts.message, { ...this.deps, managed: true });
    this.rendering = this.loadNow();
  }

  onunload(): void {
    this.unloaded = true;
    this.host?.dispose();
    this.host = null;
  }

  /** Oeffentlich fuer Tests. */
  async loadNow(): Promise<void> {
    if (this.unloaded || !this.host) return;

    const file = resolveModelPath(this.deps.app, this.embed.path, this.sourcePath);
    if (!file) {
      this.host.showError({ kind: "missing-file", path: this.embed.path });
      return;
    }

    const format = detectFormat(file.path);
    if (format === null) {
      this.host.showError({ kind: "unsupported-format", path: this.embed.path });
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
      label: this.embed.path,
    });
  }

  onFileModified(file: TFile): void {
    if (this.unloaded || !this.file) return;
    if (file.path !== this.file.path || file.stat.mtime === this.loadedMtime) return;
    void this.loadNow();
  }

  refreshColors(): void {
    this.host?.refreshColors();
  }
}

/** Registriert den Postprocessor, der 3d-Embeds in Viewports verwandelt. `track` meldet
    jeden neuen Embed beim Plugin an (für `modify`/Theme-Wechsel). */
export function registerModelEmbeds(
  plugin: Plugin,
  deps: EmbedDeps,
  track: (view: TrackedView) => void,
): void {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    for (const span of Array.from(el.querySelectorAll<HTMLElement>(".internal-embed"))) {
      const src = span.getAttribute("src");
      if (!src) continue;
      const match = matchModelEmbed(src);
      if (!match) continue;

      span.empty();
      const embed = new ModelEmbed(span, match, ctx.sourcePath, deps);
      track(embed);
      ctx.addChild(embed);
    }
  });
}
