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
import { parseLockedPrefixes, type PluginSettings } from "../core/settings-types";
import type { EditUiModel } from "../core/edit-session";
import type { ViewSpec } from "../core/view-spec";
import { toViewModel } from "../core/view-model";
import type { SceneColors } from "../viewer/scene";
import { BlockChangedError, writeBlockBody, type WritePorts } from "./block-writer";
import { EditCoordinator, type EditIo } from "./edit-mode";
import { readModel, resolveModelPath } from "./file-source";
import { buildBox, renderHint, renderMessage, type BoxParts } from "./render-box";
import {
  ViewerHost,
  describeError,
  needsContainerInspection,
  wrapBudgetWithActive,
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
  /** I/O fuer den Edit-Modus (Original lesen, Edit-Datei schreiben) — `vaultEditIo(app)`. */
  editIo: EditIo;
  /** Bestaetigungsdialog vorm Verwerfen ungespeicherter Edits. */
  confirmDiscard: () => Promise<boolean>;
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
  private edit: EditCoordinator | null = null;

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
      budget: wrapBudgetWithActive(this.deps.budget, this.deps.active, this),
    });

    this.edit = new EditCoordinator({
      io: this.deps.editIo,
      filePath: () => this.file?.path ?? null,
      host: () => this.host,
      lockedPrefixes: () => parseLockedPrefixes(this.deps.settings().lockedNodePrefixes),
      notice: (m) => new Notice(m),
      confirmDiscard: this.deps.confirmDiscard,
      onChange: () => {
        this.syncToolbar(true);
        // Sidebar-Panel (Task 11) haengt nicht an `syncToolbar()` -- es zeichnet ueber
        // `active.subscribe()`. `notify()` feuert diese Listener auch dann, wenn dieser
        // Block der aktive Controller BLEIBT (kein Wechsel, `set()` waere hier ein No-op),
        // damit Move/Scale/Reset/Save/Discard und die Zahlenfelder dort live nachziehen.
        this.deps.active.notify();
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
    // VOR dem Host-Dispose: der Coordinator disposed sein Rig noch auf dem lebenden
    // Viewport (kein Confirm, Edits sind fluechtig — Spec §4).
    this.edit?.exitSilently();
    this.host?.dispose();
    this.host = null;
  }

  // --- ViewportController -----------------------------------------------------

  label(): string {
    return this.config?.title ?? this.config?.file ?? "3D model";
  }

  /** `this.edit` ist `null` vor `onload()` und nach `onunload()` -- ohne Coordinator
   *  gibt es keinen Edit-Zustand, die Sidebar zeigt dann gar keine Edit-Sektion. */
  editPanel = (): EditUiModel | null => this.edit?.uiModel() ?? null;

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
    if (next === body) {
      // Ohne Feedback wirkt der Save-/Clear-Button hier tot — er tut ja etwas,
      // nur ist das Ergebnis mit dem Ist-Zustand identisch.
      new Notice("View already up to date");
      return;
    }

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

    // `buildToolbar()` friert `getView()` beim Bau ein — das Modell laedt aber erst
    // HIER (asynchron ueber `render`) fertig. Ohne dieses Nachziehen bliebe der
    // Save-Button in der Default-Konfiguration (Toolbar statt Sidebar) fuer immer
    // deaktiviert, weil `syncToolbar()` in `onload()` noch vor jedem Modell laeuft.
    // `force`, weil sich nur der Button-Zustand geaendert hat, nicht die Sichtbarkeit —
    // der idempotente Pfad wuerde hier sonst genau das Noetige ueberspringen.
    this.syncToolbar(true);

    // Ueberlebt ein aktiver Edit-Modus die Regenerierung (gleicher Pfad, neuer Host)?
    // `reapplyAfterReload()` legt die Session per Name auf den frisch geladenen Stand.
    if (this.edit?.active) await this.edit.reapplyAfterReload();
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

  refreshAutoRotate(): void {
    this.host?.refreshAutoRotate();
  }

  /** Leiste an- oder abhaengen, je nach Einstellung und Sichtbarkeit der Sidebar.
   *
   *  `force` erzwingt den Neubau, auch wenn die Leiste schon im richtigen Zustand
   *  ist: `buildToolbar()` friert den Aktiv/Inaktiv-Zustand der Buttons beim Bauen
   *  ein, nach dem Laden eines Modells muss sie also neu gezeichnet werden, obwohl
   *  sich ihre Sichtbarkeit nicht geaendert hat.
   *
   *  Ohne `force` ist der Aufruf idempotent — noetig, weil `resize` beim Ziehen
   *  einer Pane-Grenze im Sekundentakt feuert. Ein bedingungsloser Neubau wuerde
   *  dabei jedes Mal DOM wegwerfen und neu aufbauen, und ein Klick auf einen
   *  Toolbar-Button ginge verloren, wenn er den Neubau ausloest, bevor sein
   *  Handler laeuft (dieselbe Fehlerklasse wie der Re-Render-Gotcha aus
   *  epub-exporter in REGISTRY.md). */
  syncToolbar(force = false): void {
    if (!this.parts || this.unloaded) return;

    // Sichtbarer Rahmen um den Viewport, solange der Edit-Modus aktiv ist (styles.css) —
    // UNBEDINGT, vor beiden Returns unten (Spec §2.1: der Rahmen haengt nicht an der
    // Toolbar-Sichtbarkeit). Zwei Fehlerrichtungen, wenn das hier haengen bliebe: (a)
    // bei `panelPlacement: "sidebar"` erscheint der Rahmen nie (die Toolbar wird dort
    // nie gebaut); (b) Klassen-Leiche — Edit betreten waehrend die Toolbar sichtbar ist
    // (Klasse gesetzt), Placement wechselt auf "sidebar", der naechste `syncToolbar()`
    // entfernt die Toolbar und kehrt VOR dem Toggle zurueck → Edit-Modus verlassen liesse
    // den Akzent-Rahmen dauerhaft stehen.
    this.parts.viewport.toggleClass("tdcb-editing", this.edit?.active ?? false);

    const { panelPlacement } = this.deps.settings();
    const wanted = toolbarVisible(panelPlacement, this.deps.panelVisible());
    if (!force && wanted === (this.toolbar !== null)) return;

    this.toolbar?.remove();
    this.toolbar = null;

    if (!wanted) return;

    // In den Viewport-Wrapper haengen (nicht `root`, das auch den `title:`-Caption
    // traegt, und NICHT `stage` selbst): `root` wuerde die Leiste ueber den Titel statt
    // ueber den Viewport setzen; `stage` wird von `ViewerHost` in Poster-Modus,
    // Reaktivierung und Fehler-Reload komplett geleert (`stage.empty()`) — eine dort
    // haengende Leiste wuerde bei jedem dieser Wege verschwinden und nie zurueckkommen,
    // weil `syncToolbar()` nur den initialen Ladeweg abdeckt. `viewport` ist Geschwister
    // der Buehne, nicht Kind, und ueberlebt deshalb alle drei.
    this.toolbar = buildToolbar(this.parts.viewport, this, this.edit?.uiModel() ?? null);
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
