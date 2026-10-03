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
//
// Zweiter Modus `shapes` (Spec Modell per Prompt § 3): derselbe Block, nur ist der Text
// shapes-DSL statt glTF-JSON. Die Umwandlung macht der ViewerHost (format "shapes");
// hier kommen nur Kopfzeilen (title, height, view) hinzu, die ein gltf-Block nicht hat.
import { MarkdownRenderChild } from "obsidian";
import type { ActiveViewport, ViewportController } from "../core/active-viewport";
import type { PanelTarget } from "../core/shapes/panel-state";
import { parseShapes } from "../core/shapes/parse";
import type { ShapesHeader } from "../core/shapes/types";
import type { ViewRef } from "../core/view-spec";
import { buildBox, type BoxParts } from "./render-box";
import { readOnlyController } from "./read-only-controller";
import { buildActionBar, type ActionButton } from "./viewport-toolbar";
import { ViewerHost, wrapBudgetWithActive, type HostBaseDeps } from "./viewer-host";

export interface GltfBlockDeps extends HostBaseDeps {
  active: ActiveViewport;
  /** Pfad der Notiz, in der der Block steht (nur `shapes`: Ziel fuer das Prompt-Panel). */
  sourcePath?: string;
  /** Zeilen des Blocks (Zaunzeilen) — `null`, wenn Obsidian sie nicht kennt (Embed, Popover). */
  sectionInfo?: () => { lineStart: number; lineEnd: number } | null;
  openInPanel?: (target: PanelTarget) => void;
  moveToFile?: () => void;
}

export type InlineBlockKind = "gltf" | "shapes";

export class GltfBlock extends MarkdownRenderChild {
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private unloaded = false;
  /** Das laufende Render-Promise (fuer Tests abwartbar). */
  rendering: Promise<void> = Promise.resolve();

  // Im Konstruktor gesetzt: Feld-Initialisierer laufen vor den Parameter-Properties, `kind` waere dort noch leer.
  readonly controller: ViewportController;

  constructor(
    containerEl: HTMLElement,
    private readonly source: string,
    private readonly deps: GltfBlockDeps,
    private readonly kind: InlineBlockKind = "gltf",
  ) {
    super(containerEl);
    this.controller = {
      ...readOnlyController(() => this.host, () => this.label()),
      ...(kind === "shapes" ? { shapesTarget: () => this.target() } : {}),
    };
  }

  private label(): string {
    if (this.kind !== "shapes") return "glTF code block";
    return parseShapes(this.source).header.title ?? "shapes code block";
  }

  /** Beim Klick gelesen, nie gemerkt: Zeilen verschieben sich, sobald darueber getippt wird. */
  private target(): PanelTarget | null {
    const info = this.deps.sectionInfo?.();
    if (!info || this.deps.sourcePath === undefined) return null;
    return { kind: "shapes-block", path: this.deps.sourcePath, lineStart: info.lineStart, lineEnd: info.lineEnd, label: this.label() };
  }

  onload(): void {
    const header: ShapesHeader = this.kind === "shapes" ? parseShapes(this.source).header : {};
    this.parts = buildBox(this.containerEl, {
      height: header.height ?? this.deps.settings().defaultHeight,
      title: header.title,
    });
    this.host = new ViewerHost(this.parts.stage, this.parts.message, {
      ...this.deps,
      managed: true,
      budget: wrapBudgetWithActive(this.deps.budget, this.deps.active, this.controller),
    });
    // Nur mit Ort in der Notiz (nicht in Embed/Popover): ohne Zeilen gibt es nichts, was das Panel aendern koennte.
    if (this.kind === "shapes" && this.deps.openInPanel && this.deps.sectionInfo?.()) {
      const buttons: ActionButton[] = [
        {
          icon: "sparkles",
          label: "Edit in prompt panel",
          run: () => {
            const t = this.target();
            if (t) this.deps.openInPanel?.(t);
          },
        },
      ];
      if (this.deps.moveToFile) {
        buttons.push({ icon: "file-output", label: "Move into a .shapes file", run: () => this.deps.moveToFile?.() });
      }
      buildActionBar(this.parts.viewport, buttons);
    }
    // Kein IntersectionObserver: der Blocktext ist schon da, es gibt keine Datei-I/O
    // zu sparen. Direkt rendern.
    this.rendering = this.loadNow(header.view);
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

  refreshLighting(): void {
    this.host?.refreshLighting();
  }

  /** Ein gltf-Block hat keinen Datei-Bezug — Regenerierung betrifft ihn nicht. */
  onFileModified(): void {}

  /** Oeffentlich fuer Tests. */
  async loadNow(view?: ViewRef): Promise<void> {
    if (this.unloaded || !this.host) return;

    if (this.kind === "gltf") {
      // JSON vor dem Loader pruefen, damit der Nutzer den echten Grund sieht statt eines
      // three.js-internen Parserfehlers.
      try {
        JSON.parse(this.source);
      } catch {
        this.host.showError({ kind: "invalid-gltf-json" });
        return;
      }
    }

    await this.host.render({
      provideBytes: () => Promise.resolve(new TextEncoder().encode(this.source).buffer),
      format: this.kind === "shapes" ? "shapes" : "gltf",
      inspectContainer: false,
      label: this.kind === "shapes" ? "shapes code block" : "glTF code block",
      ...(view ? { view } : {}),
    });
  }
}
