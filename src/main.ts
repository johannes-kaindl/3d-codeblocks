import {
  Notice,
  Plugin,
  TFile,
  type MarkdownPostProcessorContext,
  type WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type PluginSettings } from "./core/settings-types";
import { ActiveViewport } from "./core/active-viewport";
import { ModelBlock } from "./obsidian/block-child";
import { ControlPanelView, VIEW_TYPE_3D_CONTROLS } from "./obsidian/control-panel";
import { ContextManager } from "./obsidian/context-manager";
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

    const hostDeps: HostBaseDeps = {
      settings: () => this.settings,
      factory: {
        create: (options) => new Viewport(options),
        isWebGLAvailable,
      },
      budget: this.contexts,
      loadModel,
      readColors: readSceneColors,
    };

    // ```3d file: — Datei-Verweis mit Titel/Höhe (mehrere pro Notiz).
    this.registerMarkdownCodeBlockProcessor(
      "3d",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const block = new ModelBlock(el, source, ctx.sourcePath, {
          ...hostDeps,
          app: this.app,
          active: this.active,
          writePorts: obsidianWritePorts(this.app),
          sectionInfo: () => {
            const info = ctx.getSectionInfo(el);
            return info ? { lineStart: info.lineStart, lineEnd: info.lineEnd } : null;
          },
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
          // rechter Leiste (Normalzustand) wie ein Nichts-Tun.
          this.app.workspace.rightSplit.collapsed = false;
          this.app.workspace.setActiveLeaf(existing[0], { focus: true });
          return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        this.app.workspace.rightSplit.collapsed = false;
        await leaf?.setViewState({ type: VIEW_TYPE_3D_CONTROLS, active: true });
      },
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
}
