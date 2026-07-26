// `![[datei.gltf]]`-Embeds über Obsidians embedRegistry.
//
// WICHTIG — inoffizielle API: `app.embedRegistry` ist nicht Teil der öffentlichen
// Obsidian-Typen. Sie ist der EINZIGE zuverlässige Weg, echte Datei-Embeds
// (`![[x.gltf]]`) zu rendern — der Markdown-Postprocessor-Weg greift für Datei-Embeds
// nicht (er läuft vor Obsidians Embed-Laden, und Obsidian verwaltet den Span selbst).
// Deshalb: Feature-Detection (nur registrieren, wenn vorhanden) + eigene, minimale
// Typ-Deklaration statt einer Dependency. Verschwindet die API, fehlen nur Embeds.
//
// Kein Codeblock dahinter → nur steuerbar (Fit/Presets), nie speicherbar; siehe
// `readOnlyController`, den sich diese Klasse mit `ModelFileView` teilt.
import { MarkdownRenderChild, Notice, type App, type TFile } from "obsidian";
import type { ActiveViewport } from "../core/active-viewport";
import { embedHeightFromAttrs } from "../core/embed-src";
import { detectFormat } from "../core/format";
import { parseLockedPrefixes } from "../core/settings-types";
import { EditCoordinator, type EditIo } from "./edit-mode";
import { buildBox, type BoxParts } from "./render-box";
import { readModel } from "./file-source";
import { readOnlyController } from "./read-only-controller";
import type { TrackedView } from "./tracked-view";
import {
  ViewerHost,
  needsContainerInspection,
  wrapBudgetWithActive,
  type HostBaseDeps,
} from "./viewer-host";

export type { TrackedView } from "./tracked-view";

export interface EmbedDeps extends HostBaseDeps {
  app: App;
  active: ActiveViewport;
  /** I/O fuer den Edit-Modus (Original lesen, Edit-Datei schreiben) — `vaultEditIo(app)`. */
  editIo: EditIo;
  /** Bestaetigungsdialog vorm Verwerfen ungespeicherter Edits. */
  confirmDiscard: () => Promise<boolean>;
}

// --- minimale Deklaration der inoffiziellen embedRegistry-API --------------------
// Verifiziert gegen obsidian-typings (release/obsidian-catalyst/1.11.7):
//   EmbedCreator = (context, file, subpath?) => EmbedComponent
//   EmbedComponent extends Component { loadFile(): void }   ← OHNE Parameter!
// Die Datei kommt über den Creator (Konstruktor), NICHT über loadFile.
interface EmbedContext {
  app: App;
  containerEl: HTMLElement;
  /** Angezeigter Text des Embeds; bei `![[x|250]]` steht hier die Höhe. */
  linktext?: string;
  sourcePath?: string;
}
interface EmbedComponentLike {
  loadFile(): void;
}
interface EmbedRegistry {
  isExtensionRegistered?(extension: string): boolean;
  registerExtension(
    extension: string,
    creator: (context: EmbedContext, file: TFile, subpath?: string) => EmbedComponentLike,
  ): void;
  unregisterExtension?(extension: string): void;
}

const MODEL_EXTENSIONS = ["gltf", "glb", "stl"] as const;

export class ModelEmbed extends MarkdownRenderChild implements TrackedView {
  private parts: BoxParts | null = null;
  private host: ViewerHost | null = null;
  private loadedMtime: number | null = null;
  private unloaded = false;
  /** Laufendes Render-Promise (für Tests abwartbar). */
  rendering: Promise<void> = Promise.resolve();

  /** Kein Toolbar bei Embeds — nur die Sidebar (Task 12) bedient den Edit-Modus, deshalb
      `onChange` hier nur `active.notify()` statt einer `syncToolbar()`-Variante. */
  private readonly edit: EditCoordinator;

  readonly controller = readOnlyController(
    () => this.host,
    () => this.file.path,
    () => this.edit.uiModel(),
  );

  constructor(
    private readonly hostEl: HTMLElement,
    private readonly file: TFile,
    private readonly deps: EmbedDeps,
  ) {
    super(hostEl);
    this.edit = new EditCoordinator({
      io: this.deps.editIo,
      filePath: () => this.file.path,
      host: () => this.host,
      lockedPrefixes: () => parseLockedPrefixes(this.deps.settings().lockedNodePrefixes),
      notice: (m) => new Notice(m),
      confirmDiscard: this.deps.confirmDiscard,
      onChange: () => {
        this.syncEditFrame();
        this.deps.active.notify();
      },
    });
  }

  /** Sichtbarer Rahmen um den Viewport, solange der Edit-Modus laeuft (Spec §2.1,
      styles.css). Embeds haben keine Toolbar, an der er wie beim Codeblock mit
      haengen wuerde — ohne dieses Toggle gaebe es hier gar keine optische
      Rueckmeldung, dass der Modus laeuft. `parts` fehlt vor dem ersten Render. */
  private syncEditFrame(): void {
    this.parts?.viewport.toggleClass("tdcb-editing", this.edit.active);
  }

  /** Obsidian ruft dies OHNE Argument nach dem Erstellen — die Datei kam über den
      Konstruktor (den Creator-Callback). */
  loadFile(): void {
    this.rendering = this.render();
  }

  onunload(): void {
    this.unloaded = true;
    // Reihenfolge wie in ModelBlock: erst clearIf (raeumt nur auf, wenn dieser Embed
    // auch der aktive war), dann Edit still beenden (VOR dem Host-Dispose — der
    // Coordinator disposed sein Rig noch auf dem lebenden Viewport), dann erst den
    // Host disposen.
    this.deps.active.clearIf(this.controller);
    this.edit.exitSilently();
    this.host?.dispose();
    this.host = null;
  }

  onFileModified(file: TFile): void {
    if (this.unloaded) return;
    if (file.path !== this.file.path || file.stat.mtime === this.loadedMtime) return;
    this.rendering = this.reloadAndReapply();
  }

  /** Regenerierung ueberlebt einen aktiven Edit — Session per Name auf den frisch
      geladenen Stand legen (wie ModelBlock.loadNow(), Task 10). */
  private async reloadAndReapply(): Promise<void> {
    await this.render();
    if (this.edit.active) await this.edit.reapplyAfterReload();
  }

  refreshColors(): void {
    this.host?.refreshColors();
  }

  private async render(): Promise<void> {
    if (this.unloaded) return;

    if (!this.parts) {
      this.hostEl.empty();
      this.parts = buildBox(this.hostEl, { height: this.embedHeight() });
      this.host = new ViewerHost(this.parts.stage, this.parts.message, {
        ...this.deps,
        managed: true,
        budget: wrapBudgetWithActive(this.deps.budget, this.deps.active, this.controller),
      });
    }
    if (!this.host) return;

    const file = this.file;
    const format = detectFormat(file.path);
    if (format === null) {
      this.host.showError({ kind: "unsupported-format", path: file.path });
      return;
    }

    await this.host.render({
      provideBytes: async () => {
        const model = await readModel(this.deps.app, file);
        this.loadedMtime = model.mtime;
        return model.data;
      },
      format,
      inspectContainer: needsContainerInspection(file.path),
      label: file.basename,
    });
  }

  private embedHeight(): number {
    return (
      embedHeightFromAttrs(
        this.hostEl.getAttribute("width"),
        this.hostEl.getAttribute("height"),
      ) ?? this.deps.settings().defaultHeight
    );
  }
}

/** Registriert die 3d-Endungen bei der (inoffiziellen) embedRegistry. `track` meldet
    jeden Embed für modify/Theme-Wechsel an. Gibt `false` zurück, wenn die API fehlt. */
export function registerModelEmbeds(
  app: App,
  deps: EmbedDeps,
  track: (view: TrackedView) => void,
): boolean {
  const registry = (app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
  if (!registry || typeof registry.registerExtension !== "function") return false;

  for (const ext of MODEL_EXTENSIONS) {
    if (registry.isExtensionRegistered?.(ext)) continue;
    registry.registerExtension(ext, (context, file) => {
      const embed = new ModelEmbed(context.containerEl, file, deps);
      track(embed);
      return embed;
    });
  }
  return true;
}

/** Beim Plugin-Entladen die Endungen wieder freigeben (sonst hält die Registry
    tote Creators). */
export function unregisterModelEmbeds(app: App): void {
  const registry = (app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
  if (!registry?.unregisterExtension) return;
  for (const ext of MODEL_EXTENSIONS) registry.unregisterExtension(ext);
}
