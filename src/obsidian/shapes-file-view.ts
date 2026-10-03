// `.shapes`-Datei als Text UND Modell (Spec Modell per Prompt § 5.1). TextFileView statt
// FileView: Obsidian übernimmt Laden, verzögertes Speichern (`requestSave`) und externe
// Änderungen (`setViewData(…, false)`) — dieselbe Grundlage wie json-editors JsonFileView.
// Die ModelFileView bleibt für glTF/GLB/STL zuständig; sie ist eine Lese-Ansicht mit
// Edit-Modus für Generator-Dateien, diese hier ist ein Editor für eine Quelle.
import { TextFileView, type WorkspaceLeaf } from "obsidian";
import type { ActiveViewport } from "../core/active-viewport";
import { initialMode, layoutFor, RERENDER_DELAY_MS, type ShapesMode } from "../core/shapes/layout";
import { parseShapes } from "../core/shapes/parse";
import { buildBox, type BoxParts } from "./render-box";
import { readOnlyController } from "./read-only-controller";
import type { IssueLine, SourceEditorLike } from "./source-editor";
import type { TrackedView } from "./tracked-view";
import { ViewerHost, wrapBudgetWithActive, type HostBaseDeps } from "./viewer-host";

export const VIEW_TYPE_SHAPES = "tdcb-shapes-file";

export interface ShapesFileViewDeps extends HostBaseDeps {
  active: ActiveViewport;
  createEditor: (parent: HTMLElement, opts: { onChange: (text: string) => void }) => SourceEditorLike;
}

const PILL_LABELS: Record<ShapesMode, string> = { model: "Model", text: "Text", split: "Split" };

export class ShapesFileView extends TextFileView implements TrackedView {
  /** Der GESPEICHERTE Modus: nur der Nutzer (setMode) oder die erste echte Breitenmessung
      schreibt ihn. Was gezeigt wird, leitet `applyLayout` per `layoutFor(stored, width)` ab
      und schreibt `layout.active` nie zurück — sonst ginge „Split" beim Verschmälern verloren. */
  private stored: ShapesMode | null = null;
  private width = 0;
  private bodyEl: HTMLElement | null = null;
  private modelEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private pills = new Map<ShapesMode, HTMLElement>();
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private editor: SourceEditorLike | null = null;
  private timer: number | null = null;
  private observer: ResizeObserver | null = null;
  /** Laufendes Render-Promise (für Tests abwartbar). */
  rendering: Promise<void> = Promise.resolve();

  readonly controller = readOnlyController(
    () => this.host,
    () => this.file?.path ?? "shapes model",
  );

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: ShapesFileViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SHAPES;
  }

  getIcon(): string {
    return "box";
  }

  getDisplayText(): string {
    return this.file?.basename ?? "shapes model";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("tdcb-shapes-view");

    const bar = root.createDiv({ cls: "tdcb-shapes-pills", attr: { role: "group", "aria-label": "View" } });
    for (const mode of ["model", "text", "split"] as ShapesMode[]) {
      const pill = bar.createEl("button", { cls: "tdcb-shapes-pill", text: PILL_LABELS[mode] });
      pill.dataset.mode = mode;
      pill.addEventListener("click", () => this.setMode(mode));
      this.pills.set(mode, pill);
    }
    // Text statt nur Farbe/Tooltip: nennt die erste fehlerhafte Zeile, auch für Tastatur und Touch.
    this.summaryEl = bar.createDiv({ cls: "tdcb-shapes-summary", attr: { "aria-live": "polite" } });

    this.bodyEl = root.createDiv({ cls: "tdcb-shapes-body" });
    this.textEl = this.bodyEl.createDiv({ cls: "tdcb-shapes-text" });
    this.modelEl = this.bodyEl.createDiv({ cls: "tdcb-shapes-model" });

    this.parts = buildBox(this.modelEl, { fill: true });
    this.host = new ViewerHost(this.parts.stage, this.parts.message, {
      ...this.deps,
      managed: false,
      budget: wrapBudgetWithActive(this.deps.budget, this.deps.active, this.controller),
    });
    this.editor = this.deps.createEditor(this.textEl, { onChange: (text) => this.onEdit(text) });

    if (typeof ResizeObserver !== "undefined") {
      // Der erste Callback mit Breite > 0 ist die erste echte Messung; ein noch nicht
      // gelayouteter Pane meldet 0 und entscheidet nichts (siehe `measure`).
      this.observer = new ResizeObserver((entries) => {
        this.measure(entries[0]?.contentRect.width ?? 0);
      });
      this.observer.observe(root);
    }
    this.applyLayout();
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.observer?.disconnect();
    this.observer = null;
    this.editor?.destroy();
    this.editor = null;
    this.deps.active.clearIf(this.controller);
    this.host?.dispose();
    this.host = null;
  }

  getViewData(): string {
    return this.data;
  }

  // Gemessen 2026-10-03 (Obsidian 1.14.4, Zweitinstanz, Probe über CDP an einer offenen .shapes-Datei):
  // - Eine externe Änderung der Datei (Sync) kommt als `setViewData(data, false)` an; der Cursor
  //   blieb in Zeile 1, der geänderte Text in Zeile 4 war übernommen. `clear === true` ist also
  //   der Dateiwechsel, nicht der externe Reload — anders als der Kommentar in json-editors JsonFileView.
  // - Das eigene Speichern löst kein `setViewData` aus (kein Echo).
  // - Tippt man und ändert die Datei von außen vor dem Speichern, führt Obsidian beide Stände
  //   selbst zusammen: Editor und Platte trugen danach beide Änderungen, nichts ging verloren.
  setViewData(data: string, clear: boolean): void {
    this.data = data;
    if (this.editor) {
      if (clear) this.editor.setValue(data);
      else if (this.editor.getValue() !== data) this.editor.applyExternalEdit(data);
    }
    this.renderNow();
  }

  clear(): void {
    this.data = "";
    this.editor?.setValue("");
  }

  setMode(mode: ShapesMode): void {
    // Fokus vor dem Umschalten messen: ein ausgeblendetes Element verliert ihn sofort.
    const editorHadFocus = this.editor?.hasFocus() ?? false;
    this.stored = mode;
    const layout = this.applyLayout();
    // Text/Split: wer die Pille drueckt, will tippen. Modell, waehrend der Editor den Fokus hatte: der Fokus
    // wandert auf die gedrueckte Pille, nie auf ein verstecktes Element.
    if (mode !== "model" && layout.showText) this.editor?.focus();
    else if (editorHadFocus && !layout.showText) this.pills.get(layout.active)?.focus();
  }

  /** Nur für Tests: die Breite setzen, die sonst der ResizeObserver meldet. */
  setWidthForTest(width: number): void {
    this.measure(width);
  }

  /** Nur für Tests. */
  pillStateForTest(): { mode: string; hidden: boolean; pressed: string | null }[] {
    return [...this.pills.entries()].map(([mode, el]) => ({
      mode,
      hidden: el.hidden,
      pressed: el.getAttribute("aria-pressed"),
    }));
  }

  /** Nur für Tests: der gespeicherte Modus (`null` = noch nicht entschieden). */
  modeForTest(): ShapesMode | null {
    return this.stored;
  }

  modelVisibleForTest(): boolean {
    return !this.modelEl?.className.split(/\s+/).includes("is-hidden");
  }

  textVisibleForTest(): boolean {
    return !this.textEl?.className.split(/\s+/).includes("is-hidden");
  }

  issueSummaryForTest(): string {
    return this.summaryEl?.textContent ?? "";
  }

  // TrackedView — Datei-Änderungen meldet Obsidian einer TextFileView selbst über
  // setViewData; das zentrale `modify`-Abo braucht hier nichts zu tun.
  onFileModified(): void {}

  refreshColors(): void {
    this.host?.refreshColors();
  }

  refreshLighting(): void {
    this.host?.refreshLighting();
  }

  refreshAutoRotate(): void {
    this.host?.refreshAutoRotate();
  }

  /** Nimmt eine Breite entgegen. Erst die erste Breite > 0 legt — falls der Nutzer noch
      nichts gewählt hat — den Startmodus fest; `initialMode(0)` wäre fälschlich „Model". */
  private measure(width: number): void {
    if (width === this.width) return;
    this.width = width;
    if (width > 0 && this.stored === null) this.stored = initialMode(width);
    this.applyLayout();
  }

  private onEdit(text: string): void {
    this.data = text;
    this.requestSave();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.renderNow();
    }, RERENDER_DELAY_MS);
  }

  private renderNow(): void {
    // Ein anstehender Tipp-Timer wäre danach ein zweites, überflüssiges Rendern.
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const parsed = parseShapes(this.data);
    const issues: IssueLine[] = [
      ...parsed.errors.map((i) => ({ ...i, severity: "error" as const })),
      ...parsed.warnings.map((i) => ({ ...i, severity: "warning" as const })),
    ].sort((a, b) => a.line - b.line);
    this.editor?.setIssues(issues);
    this.summaryEl?.setText(summarize(issues));
    const text = this.data;
    const host = this.host;
    if (!host) return;
    this.rendering = host.render({
      provideBytes: () => Promise.resolve(new TextEncoder().encode(text).buffer),
      format: "shapes",
      inspectContainer: false,
      label: this.file?.basename ?? "shapes model",
    });
  }

  private applyLayout(): ReturnType<typeof layoutFor> {
    // Vor der ersten Messung ist `stored` evtl. null: nur Modell zeigen, nichts festlegen.
    const layout = layoutFor(this.stored ?? "model", this.width);
    for (const [mode, pill] of this.pills) {
      pill.hidden = !layout.pills.includes(mode);
      const pressed = mode === layout.active;
      pill.setAttribute("aria-pressed", String(pressed));
      pill.toggleClass("is-active", pressed);
    }
    this.modelEl?.toggleClass("is-hidden", !layout.showModel);
    this.textEl?.toggleClass("is-hidden", !layout.showText);
    this.bodyEl?.toggleClass("is-split", layout.showModel && layout.showText);
    return layout;
  }
}

function summarize(issues: IssueLine[]): string {
  const first = issues.find((i) => i.severity === "error") ?? issues[0];
  if (!first) return "";
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const counts = [
    errors > 0 ? `${errors} ${errors === 1 ? "error" : "errors"}` : "",
    warnings > 0 ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : "",
  ].filter(Boolean);
  return `${counts.join(", ")} — Line ${first.line}: ${first.message}`;
}
