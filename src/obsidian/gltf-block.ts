// Der ` ```gltf `-Codeblock: glTF-JSON steht direkt im Block (kein Datei-Verweis).
// Fuer kleine, handgeschriebene oder Skizzen-Modelle im Vault. GLB (binaer) passt
// nicht in einen Text-Block — dafuer bleibt `file:`/Embed der Weg.
import { MarkdownRenderChild } from "obsidian";
import { buildBox, type BoxParts } from "./render-box";
import { ViewerHost, type HostBaseDeps } from "./viewer-host";

export class GltfBlock extends MarkdownRenderChild {
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private unloaded = false;
  /** Das laufende Render-Promise (fuer Tests abwartbar). */
  rendering: Promise<void> = Promise.resolve();

  constructor(
    containerEl: HTMLElement,
    private readonly source: string,
    private readonly deps: HostBaseDeps,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.parts = buildBox(this.containerEl, { height: this.deps.settings().defaultHeight });
    this.host = new ViewerHost(this.parts.stage, this.parts.message, { ...this.deps, managed: true });
    // Kein IntersectionObserver: der Blocktext ist schon da, es gibt keine Datei-I/O
    // zu sparen. Direkt rendern.
    this.rendering = this.loadNow();
  }

  onunload(): void {
    this.unloaded = true;
    this.host?.dispose();
    this.host = null;
  }

  refreshColors(): void {
    this.host?.refreshColors();
  }

  /** Ein gltf-Block hat keinen Datei-Bezug — Regenerierung betrifft ihn nicht. */
  onFileModified(): void {}

  /** Oeffentlich fuer Tests. */
  async loadNow(): Promise<void> {
    if (this.unloaded || !this.host) return;

    // JSON vor dem Loader pruefen, damit der Nutzer den echten Grund sieht statt eines
    // three.js-internen Parserfehlers.
    try {
      JSON.parse(this.source);
    } catch {
      this.host.showError({ kind: "invalid-gltf-json" });
      return;
    }

    await this.host.render({
      provideBytes: () => Promise.resolve(new TextEncoder().encode(this.source).buffer),
      format: "gltf",
      inspectContainer: false,
      label: "glTF code block",
    });
  }
}
