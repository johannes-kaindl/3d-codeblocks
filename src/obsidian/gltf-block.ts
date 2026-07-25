// Der ` ```gltf `-Codeblock: glTF-JSON steht direkt im Block (kein Datei-Verweis).
// Fuer kleine, handgeschriebene oder Skizzen-Modelle im Vault. GLB (binaer) passt
// nicht in einen Text-Block — dafuer bleibt `file:`/Embed der Weg.
//
// Kein Codeblock-Text, in den sich eine Kamera zurueckschreiben liesse (der Block
// IST schon der ganze Inhalt, keine `view:`-Zeile vorgesehen) → nur steuerbar
// (Fit/Presets), nie speicherbar; siehe `readOnlyController`, den sich diese Klasse
// mit `ModelEmbed`/`ModelFileView` teilt. Ohne diesen Controller blieb ein `gltf`-
// Block komplett ausserhalb der Aktiv-Verdrahtung: Interaktion hier liess Sidebar,
// Highlight-Rahmen und die drei Befehle weiter auf das zuletzt aktive ANDERE Modell
// zeigen.
import { MarkdownRenderChild } from "obsidian";
import type { ActiveViewport } from "../core/active-viewport";
import { buildBox, type BoxParts } from "./render-box";
import { readOnlyController } from "./read-only-controller";
import { ViewerHost, wrapBudgetWithActive, type HostBaseDeps } from "./viewer-host";

export interface GltfBlockDeps extends HostBaseDeps {
  active: ActiveViewport;
}

export class GltfBlock extends MarkdownRenderChild {
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private unloaded = false;
  /** Das laufende Render-Promise (fuer Tests abwartbar). */
  rendering: Promise<void> = Promise.resolve();

  readonly controller = readOnlyController(
    () => this.host,
    () => "glTF code block",
  );

  constructor(
    containerEl: HTMLElement,
    private readonly source: string,
    private readonly deps: GltfBlockDeps,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.parts = buildBox(this.containerEl, { height: this.deps.settings().defaultHeight });
    this.host = new ViewerHost(this.parts.stage, this.parts.message, {
      ...this.deps,
      managed: true,
      budget: wrapBudgetWithActive(this.deps.budget, this.deps.active, this.controller),
    });
    // Kein IntersectionObserver: der Blocktext ist schon da, es gibt keine Datei-I/O
    // zu sparen. Direkt rendern.
    this.rendering = this.loadNow();
  }

  onunload(): void {
    this.unloaded = true;
    // Reihenfolge wie in ModelBlock/ModelEmbed: erst clearIf (raeumt nur auf, wenn
    // dieser Block auch der aktive war), dann erst den Host disposen.
    this.deps.active.clearIf(this.controller);
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
