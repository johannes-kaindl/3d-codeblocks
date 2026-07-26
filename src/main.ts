import {
  Notice,
  Plugin,
  TFile,
  type MarkdownPostProcessorContext,
  type WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type PluginSettings } from "./core/settings-types";
import { ActiveViewport, type ViewportController } from "./core/active-viewport";
import { ModelBlock } from "./obsidian/block-child";
import { confirmDiscardEdits } from "./obsidian/confirm";
import { ControlPanelView, VIEW_TYPE_3D_CONTROLS } from "./obsidian/control-panel";
import { ContextManager } from "./obsidian/context-manager";
import { vaultEditIo } from "./obsidian/edit-mode";
import { registerModelEmbeds, unregisterModelEmbeds } from "./obsidian/embed";
import type { TrackedView } from "./obsidian/tracked-view";
import { ModelFileView, VIEW_TYPE_3D } from "./obsidian/file-view";
import { GltfBlock } from "./obsidian/gltf-block";
import { SettingsTab } from "./obsidian/settings";
import { readSceneColors } from "./obsidian/theme";
import { isWebGLAvailable } from "./obsidian/webgl";
import { obsidianWritePorts } from "./obsidian/write-ports";
import { loadModel } from "./viewer/loaders";
import { Viewport } from "./viewer/viewport";
import type { HostBaseDeps } from "./obsidian/viewer-host";

export default class ThreeDCodeblocksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  // Alle Inline-Views (Block, gltf-Block, Embed) — bekommen `modify` und Theme-Wechsel.
  private readonly views = new Set<TrackedView>();
  private readonly contexts = new ContextManager(
    () => this.settings.maxContexts,
    () => Date.now(),
  );
  // Welcher Viewport zuletzt vom Nutzer bedient wurde — Sidebar/Toolbar (Task 10/11)
  // lesen und schreiben darueber, ohne den Block selbst zu kennen.
  readonly active = new ActiveViewport();

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.addSettingTab(new SettingsTab(this.app, this));

    // `active` gehoert seit Task 12 mit dazu — Embed und FileView brauchen es, um sich
    // bei Interaktion als aktiven Viewport zu melden; ModelBlock/GltfBlock nehmen
    // einfach nur weniger von diesem Objekt.
    const hostDeps: HostBaseDeps & { active: ActiveViewport } = {
      settings: () => this.settings,
      factory: {
        create: (options) => new Viewport(options),
        isWebGLAvailable,
      },
      budget: this.contexts,
      loadModel,
      readColors: readSceneColors,
      active: this.active,
    };

    // ```3d file: — Datei-Verweis mit Titel/Höhe (mehrere pro Notiz).
    this.registerMarkdownCodeBlockProcessor(
      "3d",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const block = new ModelBlock(el, source, ctx.sourcePath, {
          ...hostDeps,
          app: this.app,
          writePorts: obsidianWritePorts(this.app),
          sectionInfo: () => {
            const info = ctx.getSectionInfo(el);
            return info ? { lineStart: info.lineStart, lineEnd: info.lineEnd } : null;
          },
          panelVisible: () => this.panelVisible(),
          editIo: vaultEditIo(this.app),
          confirmDiscard: () => confirmDiscardEdits(this.app),
        });
        this.track(block);
        ctx.addChild(block);
      },
    );

    // ```gltf — glTF-JSON direkt im Block.
    this.registerMarkdownCodeBlockProcessor(
      "gltf",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const block = new GltfBlock(el, source, hostDeps);
        this.track(block);
        ctx.addChild(block);
      },
    );

    // ![[datei.gltf]] — Embed in einer Notiz über die (inoffizielle) embedRegistry.
    // Fehlt die API in einer künftigen Obsidian-Version, laufen die anderen drei Wege
    // weiter; nur Embeds entfallen dann.
    const embedsOk = registerModelEmbeds(this.app, { ...hostDeps, app: this.app }, (view) =>
      this.track(view),
    );
    if (embedsOk) {
      this.register(() => unregisterModelEmbeds(this.app));
    } else {
      // Sichtbar machen (statt still): dann ist im Smoke sofort klar, ob Embeds fehlen,
      // weil die API weg ist — oder aus einem anderen Grund.
      console.warn("[three-d-codeblocks] embedRegistry unavailable — ![[…]] embeds disabled.");
      new Notice("3D Codeblocks: ![[…]] embeds unavailable (Obsidian embedRegistry missing).");
    }

    // Datei anklicken → 3D-View im ganzen Pane.
    this.registerView(VIEW_TYPE_3D, (leaf: WorkspaceLeaf) => new ModelFileView(leaf, hostDeps));
    this.registerExtensions(["gltf", "glb", "stl"], VIEW_TYPE_3D);

    // Rechte Leiste: Presets/Save/Clear/Fit fuer den zuletzt bedienten Viewport.
    this.registerView(
      VIEW_TYPE_3D_CONTROLS,
      (leaf: WorkspaceLeaf) => new ControlPanelView(leaf, this.active),
    );

    this.addCommand({
      id: "open-controls",
      name: "Open 3D view controls",
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_CONTROLS);
        if (existing.length > 0) {
          // `revealLeaf` braucht Obsidian 1.7.2 (minAppVersion hier ist 1.5.0);
          // `setActiveLeaf` deckt denselben Zweck ab und ist seit 0.16.3 verfuegbar.
          // `revealLeaf` klappt zusaetzlich eine eingeklappte Seitenleiste auf — das
          // holen wir uns explizit zurueck, sonst wirkt der Befehl bei kollabierter
          // rechter Leiste (Normalzustand) wie ein Nichts-Tun. WICHTIG: `.expand()`
          // aufrufen, nicht `.collapsed = false` zuweisen — `collapsed` ist nur ein
          // Statusfeld, die eigentliche DOM-Arbeit (und der Abgleich mit Obsidians
          // eigenem Zustand) steckt in `.expand()`. Eine blosse Feldzuweisung liess
          // die Leiste optisch eingeklappt UND kippte beim naechsten Toggle die Logik.
          this.app.workspace.rightSplit.expand();
          this.app.workspace.setActiveLeaf(existing[0], { focus: true });
          return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: VIEW_TYPE_3D_CONTROLS, active: true });
        this.app.workspace.rightSplit.expand();
      },
    });

    // Dieselben drei Aktionen wie Sidebar/Toolbar, aber per Befehlspalette — ohne
    // aktives Modell gibt es nichts zu tun, dann nur die Meldung statt eines Fehlers.
    const withActive = (run: (controller: ViewportController) => void) => () => {
      const controller = this.active.get();
      if (!controller) {
        new Notice("No active 3D model");
        return;
      }
      run(controller);
    };

    this.addCommand({
      id: "save-view",
      name: "Save current view to block",
      callback: withActive((controller) => {
        const spec = controller.getView();
        if (spec !== null) void controller.save(spec);
      }),
    });

    this.addCommand({
      id: "clear-view",
      name: "Clear saved view",
      callback: withActive((controller) => void controller.save(null)),
    });

    this.addCommand({
      id: "fit-view",
      name: "Fit camera to model",
      callback: withActive((controller) => controller.applyView(null)),
    });

    // Regenerierte Dateien (gleicher Pfad, neuer Inhalt) sollen ohne Neustart neu laden.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        for (const view of this.views) void view.onFileModified(file);
      }),
    );

    // Theme-Wechsel: Hintergrund und STL-Material folgen sofort.
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const view of this.views) view.refreshColors();
      }),
    );

    // Sidebar auf/zu (oder sonst ein Layout-Wechsel) aendert `panelVisible()` — ohne
    // dieses Nachziehen bliebe die Hover-Leiste stehen, nachdem die Sidebar geoeffnet
    // wurde, bis der Block aus einem anderen Grund neu zeichnet.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncAllToolbars()));

    // `layout-change` allein reicht NICHT: es feuert, wenn Blaetter entstehen oder
    // verschwinden — nicht, wenn der Nutzer eine Seitenleiste bloss ein- oder
    // ausklappt. Genau das ist aber der Auslöser, auf den die Ausweich-Leiste
    // reagieren muss. `resize` deckt es ab ("a WorkspaceItem is resized OR the
    // workspace layout has changed", seit 0.9.7). Im GUI-Smoke war die Leiste
    // deshalb nach dem ersten Aufklappen dauerhaft verschwunden.
    //
    // `resize` feuert beim Ziehen einer Pane-Grenze sehr haeufig — deshalb ist
    // `syncToolbar()` ohne `force` idempotent und macht hier nichts, solange sich
    // die Sichtbarkeit nicht wirklich aendert.
    this.registerEvent(this.app.workspace.on("resize", () => this.syncAllToolbars()));
  }

  onunload(): void {
    // three setzt beim Laden einen globalen Marker (window.__THREE__). Obsidian räumt
    // Globals beim Plugin-Reload (disable/enable) nicht auf → beim Wiedereinschalten
    // warnt three „Multiple instances of Three.js". Marker hier entfernen, damit ein
    // Reload sauber ist. (Bei normalem Laden beim Start tritt die Warnung nicht auf.)
    const w = window as unknown as { __THREE__?: unknown };
    if (w.__THREE__ !== undefined) delete w.__THREE__;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** View für `modify`/Theme registrieren und beim Entladen wieder abmelden. */
  private track(view: TrackedView): void {
    this.views.add(view);
    view.register(() => this.views.delete(view));
  }

  /** Alle Hover-Toolbars neu aufbauen — bei Layout-Wechseln (s. o.) UND wenn sich
      "Controls placement" in den Einstellungen aendert, damit die neue Wahl sofort
      auf bereits offene Bloecke wirkt statt erst nach einem Reload. */
  syncAllToolbars(): void {
    for (const view of this.views) view.syncToolbar?.();
  }

  /** Ob die Sidebar (Task 10) gerade offen ist — entscheidet mit, ob ein Block
      seine Hover-Toolbar zeigt. Das Nachziehen bei Layout-Wechseln kommt in Task 13. */
  private panelVisible(): boolean {
    return isPanelVisible(this.app.workspace);
  }
}

/** Adapter-Praedikat, herausgeloest fuer einen direkten Test: ein Leaf allein reicht
    nicht. Sidebar-Leaves ueberleben in Obsidians Layout auch ueber Neustarts hinweg —
    auch wenn die rechte Leiste eingeklappt ist. Ohne die Collapsed-Pruefung galt die
    Sidebar nach dem ERSTEN Oeffnen fuer immer als "offen": `resolvePanelTarget("auto", true)`
    liefert dann dauerhaft `"panel"`, die Toolbar (die Ausweichloesung bei geschlossener
    Sidebar) erscheint nie wieder — waehrend das Panel selbst unsichtbar bleibt. Ergebnis:
    keine Bedienung mehr, in keiner der beiden Flaechen. */
export function isPanelVisible(workspace: {
  getLeavesOfType(viewType: string): unknown[];
  rightSplit: { collapsed: boolean };
}): boolean {
  return (
    workspace.getLeavesOfType(VIEW_TYPE_3D_CONTROLS).length > 0 && !workspace.rightSplit.collapsed
  );
}
