import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  type MarkdownPostProcessorContext,
  type WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, validateSettings, type PluginSettings } from "./core/settings-types";
import { ActiveViewport, type ViewportController } from "./core/active-viewport";
import type { PanelTarget } from "./core/shapes/panel-state";
import { ModelBlock } from "./obsidian/block-child";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { findEndpointManager } from "./vendor/kit-obsidian/endpoint-source";
import { createLlmConnection, type LlmConnection } from "./vendor/kit-obsidian/llm-connection";
import { ControlPanelView, VIEW_TYPE_3D_CONTROLS } from "./obsidian/control-panel";
import { ContextManager } from "./obsidian/context-manager";
import { vaultEditIo } from "./obsidian/edit-mode";
import { registerModelEmbeds, unregisterModelEmbeds } from "./obsidian/embed";
import type { TrackedView } from "./obsidian/tracked-view";
import { ModelFileView, VIEW_TYPE_3D } from "./obsidian/file-view";
import { GltfBlock } from "./obsidian/gltf-block";
import { SettingsTab } from "./obsidian/settings";
import {
  canConvertBlockToFile,
  canConvertFileToBlock,
  convertBlockAt,
  convertBlockToFile,
  convertFileToBlock,
} from "./obsidian/shapes-convert";
import { PromptPanelView, VIEW_TYPE_PROMPT } from "./obsidian/prompt-panel";
import { AcceptAsModal, acceptPanel, readTargetText, type AcceptEnv } from "./obsidian/panel-accept";
import { exportShapesAsGltf } from "./obsidian/shapes-export";
import { ShapesFileView, VIEW_TYPE_SHAPES } from "./obsidian/shapes-file-view";
import { SourceEditor } from "./obsidian/source-editor";
import { readSceneColors } from "./obsidian/theme";
import { isWebGLAvailable } from "./obsidian/webgl";
import { obsidianWritePorts } from "./obsidian/write-ports";
import { loadModel } from "./viewer/loaders";
import { Viewport } from "./viewer/viewport";
import type { HostBaseDeps } from "./obsidian/viewer-host";

export default class ThreeDCodeblocksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  // Alle Views (Block, gltf-Block, Embed, FileView) — bekommen `modify` und Theme-Wechsel.
  private readonly views = new Set<TrackedView>();
  private readonly contexts = new ContextManager(
    () => this.settings.maxContexts,
    () => Date.now(),
  );
  // Welcher Viewport zuletzt vom Nutzer bedient wurde — Sidebar/Toolbar (Task 10/11)
  // lesen und schreiben darueber, ohne den Block selbst zu kennen.
  readonly active = new ActiveViewport();
  /** Die LLM-Verbindung (Endpunkt-Quelle, Modelle, Anfragen, Einstellungs-Abschnitt). */
  llm!: LlmConnection;

  async onload(): Promise<void> {
    this.settings = validateSettings(await this.loadData());
    this.llm = createLlmConnection({
      app: this.app,
      pluginId: this.manifest.id,
      caller: "3d-codeblocks",
      capability: "chat",
      mode: "structured",
      getSettings: () => ({
        endpoints: this.settings.endpoints,
        choice: this.settings.endpointChoice,
        model: this.settings.llmModel,
        request: this.settings.request,
      }),
      // Patch ZUERST uebernehmen, dann speichern — die Verbindung prueft das (MIGRATION 0.49.0).
      persist: (patch) => {
        if (patch.endpoints !== undefined) this.settings.endpoints = patch.endpoints;
        if (patch.choice !== undefined) this.settings.endpointChoice = patch.choice;
        if (patch.model !== undefined) this.settings.llmModel = patch.model;
        if (patch.request !== undefined) this.settings.request = patch.request;
        // Unverpackt zurueckgeben: das Kit macht aus einem abgelehnten Speichern eine Notice
        // (MIGRATION 0.49.0 Schritt 2); ein Catch hier liesse einen Schreibfehler wie Erfolg aussehen.
        return this.saveSettings();
      },
    });
    this.addSettingTab(new SettingsTab(this.app, this));

    // `active` gehoert seit Task 12 mit dazu — Embed und FileView brauchen es, um sich
    // bei Interaktion als aktiven Viewport zu melden; ModelBlock/GltfBlock nehmen
    // einfach nur weniger von diesem Objekt.
    // `editIo`/`confirmDiscard` ebenfalls seit Task 12 hier drin, statt nur beim
    // Codeblock: Embed und FileView bekommen (ueber die Sidebar) denselben
    // EditCoordinator wie der Codeblock — dieselben Instanzen, kein Doppelbau.
    const editIo = vaultEditIo(this.app);
    // Kit-Dialog statt eigener Fassung: die lokale hatte den destruktiven Knopf LINKS
    // (UI-STANDARD §2 verlangt Abbrechen links, Bestaetigen rechts). `warning` ist Default
    // true und markiert "Discard" versionsunabhaengig als destruktiv — setDestructive() gibt
    // es erst ab Obsidian 1.13, unser minAppVersion ist 1.5.0.
    const confirmDiscard = () =>
      confirmAction(this.app, {
        message: "Discard unsaved edits?",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
    const hostDeps: HostBaseDeps & {
      active: ActiveViewport;
      editIo: ReturnType<typeof vaultEditIo>;
      confirmDiscard: () => Promise<boolean>;
    } = {
      settings: () => this.settings,
      factory: {
        create: (options) => new Viewport(options),
        isWebGLAvailable,
      },
      budget: this.contexts,
      loadModel,
      readColors: readSceneColors,
      active: this.active,
      editIo,
      confirmDiscard,
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

    // ```shapes — die DSL direkt im Block (Spec Modell per Prompt § 3). Eigenes try:
    // belegt ein fremdes Plugin die Sprache, faellt nur dieser Weg aus, nicht das Plugin.
    try {
      this.registerMarkdownCodeBlockProcessor(
        "shapes",
        (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
          // Beim Klick gelesen (nicht beim Rendern): ein Block, der durch Tippen darueber wandert, meldet neue Zeilen.
          const sectionInfo = () => {
            const info = ctx.getSectionInfo(el);
            return info ? { lineStart: info.lineStart, lineEnd: info.lineEnd } : null;
          };
          const block = new GltfBlock(
            el,
            source,
            {
              ...hostDeps,
              sourcePath: ctx.sourcePath,
              sectionInfo,
              openInPanel: (target) => void this.openPromptPanel(target),
              moveToFile: () => {
                const info = sectionInfo();
                if (!info) return;
                void convertBlockAt(this.convertEnv(), ctx.sourcePath, info.lineStart, info.lineEnd, source);
              },
            },
            "shapes",
          );
          this.track(block);
          ctx.addChild(block);
        },
      );
    } catch (error) {
      console.warn("[three-d-codeblocks] ```shapes code blocks unavailable:", error);
      new Notice("3D Codeblocks: ```shapes code blocks unavailable — another plugin already uses that language.");
    }

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

    // Datei anklicken → 3D-View im ganzen Pane. `track` wie bei Block/Embed: die
    // FileView ist ein vollwertiger Edit-Ort und braucht dasselbe `modify`-Abo, sonst
    // wird eine dort laufende Edit-Session bei der ersten Regenerierung stale
    // (Whole-Branch-Review, Finding 2). `track()` meldet sie ueber `view.register()`
    // beim Entladen des Leafs auch wieder ab.
    this.registerView(VIEW_TYPE_3D, (leaf: WorkspaceLeaf) => {
      const view = new ModelFileView(leaf, hostDeps);
      this.track(view);
      return view;
    });
    this.registerExtensions(["gltf", "glb", "stl"], VIEW_TYPE_3D);
    // `.shapes` bekommt die eigene Dateiansicht (Text + Modell), nicht die ModelFileView.
    this.registerView(VIEW_TYPE_SHAPES, (leaf: WorkspaceLeaf) => {
      const view = new ShapesFileView(leaf, {
        ...hostDeps,
        createEditor: (parent, opts) => new SourceEditor(parent, opts),
      });
      this.track(view);
      return view;
    });
    // `.shapes` getrennt: haelt ein anderes Plugin die Endung, wirft Obsidian — dann
    // sollen wenigstens glTF/GLB/STL weiter in der 3D-Ansicht aufgehen.
    try {
      this.registerExtensions(["shapes"], VIEW_TYPE_SHAPES);
    } catch (error) {
      console.warn("[three-d-codeblocks] .shapes files unavailable:", error);
      new Notice("3D Codeblocks: .shapes files unavailable — another plugin already handles that extension.");
    }

    // Rechte Leiste: Presets/Save/Clear/Fit fuer den zuletzt bedienten Viewport.
    this.registerView(
      VIEW_TYPE_3D_CONTROLS,
      (leaf: WorkspaceLeaf) => new ControlPanelView(leaf, this.active),
    );

    // Prompt-Panel (Spec Modell per Prompt § 6): ein Frontend fuer Erzeugen und Aendern.
    this.registerView(
      VIEW_TYPE_PROMPT,
      (leaf: WorkspaceLeaf) =>
        new PromptPanelView(leaf, {
          ...hostDeps,
          llm: this.llm,
          readTargetText: (t) => readTargetText(this.acceptEnv(), t),
          accept: (state) => acceptPanel(this.acceptEnv(), state),
          openSettings: () => {
            // Interne API: fehlt sie, sagt eine Notice, wo die Einstellungen stehen, statt zu werfen.
            const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
            if (!setting) {
              new Notice("Open Settings → Community plugins → 3D Codeblocks.");
              return;
            }
            setting.open();
            setting.openTabById(this.manifest.id);
          },
          confirm: (message) => confirmAction(this.app, { message, confirmLabel: "Discard", cancelLabel: "Keep" }),
          managerPresent: () => findEndpointManager(this.app) !== null,
          persistModel: async (model) => {
            if (findEndpointManager(this.app)) this.settings.endpointChoice = { ...this.settings.endpointChoice, model };
            else this.settings.llmModel = model;
            await this.saveSettings();
          },
        }),
    );
    this.addCommand({ id: "open-prompt-panel", name: "Open prompt panel", callback: () => void this.openPromptPanel({ kind: "new" }) });
    this.addCommand({
      id: "edit-in-prompt-panel",
      name: "Edit shapes model in prompt panel",
      checkCallback: (checking) => {
        const t = this.active.get()?.shapesTarget?.() ?? null;
        if (!t) return false;
        if (!checking) void this.openPromptPanel(t);
        return true;
      },
    });
    // Das Panel folgt dem zuletzt bedienten Modell (Spec § 2 Nr. 5).
    this.register(
      this.active.subscribe((controller) => {
        // Ohne Controller (nichts bedient) bleibt das Ziel, wie es ist: ein frisches Panel hat ohnehin „neu“.
        if (!controller) return;
        const t: PanelTarget = controller.shapesTarget?.() ?? { kind: "other", label: controller.label() };
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PROMPT)) {
          if (leaf.view instanceof PromptPanelView) leaf.view.setTarget(t);
        }
      }),
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

    this.addCommand({
      id: "export-shapes-gltf",
      name: "Export shapes model as glTF",
      callback: () =>
        void exportShapesAsGltf(this.app, (message) =>
          confirmAction(this.app, { message, confirmLabel: "Overwrite", cancelLabel: "Cancel" }),
        ),
    });

    // Umwandeln ```shapes-Block <-> .shapes-Datei. checkCallback/Menue fragen nur billig und ohne
    // Nebenwirkung; die Ablehnungsgruende meldet der Befehl selbst als Notice.
    const convertEnv = () => this.convertEnv();
    this.addCommand({
      id: "convert-shapes-block-to-file",
      name: "Move shapes block into a .shapes file",
      checkCallback: (checking) => {
        if (!canConvertBlockToFile(this.app)) return false;
        if (!checking) void convertBlockToFile(convertEnv());
        return true;
      },
    });
    this.addCommand({
      id: "convert-shapes-file-to-block",
      name: "Move .shapes file into a code block",
      checkCallback: (checking) => {
        if (!canConvertFileToBlock(this.app)) return false;
        if (!checking) void convertFileToBlock(convertEnv());
        return true;
      },
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu) => {
        if (canConvertBlockToFile(this.app)) {
          menu.addItem((item) => item.setTitle("Move shapes block into a file").setIcon("file-output").onClick(() => void convertBlockToFile(convertEnv())));
        }
        if (canConvertFileToBlock(this.app)) {
          menu.addItem((item) => item.setTitle("Move .shapes file into a code block").setIcon("file-input").onClick(() => void convertFileToBlock(convertEnv())));
        }
      }),
    );

    // Regenerierte Dateien (gleicher Pfad, neuer Inhalt) sollen ohne Neustart neu laden.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        for (const view of this.views) void view.onFileModified(file);
      }),
    );

    // Entsteht/verschwindet eine `.edit.`-Datei, muss der "Unapplied edits"-Badge
    // sofort nachziehen — `modify` allein reicht nicht: der erste Save ERZEUGT die
    // Datei (`create`), Verwerfen im Datei-Explorer LOESCHT sie (`delete`). Ohne
    // diese drei Abos erschiene der Hinweis erst, wenn der Block aus einem anderen
    // Grund neu zeichnet. Bewusst ohne Pfadfilter: der Badge-Zustand ist pro View
    // billig (ein `getAbstractFileByPath`), und ein `rename` kann jede der beiden
    // Seiten (Original wie Edit-Datei) betreffen.
    //
    // Drei einzelne Abos statt einer Schleife ueber die Event-Namen: `vault.on` ist
    // pro Event getypt (`rename` hat einen zweiten Parameter), eine Union als
    // Event-Name trifft keine der Ueberladungen.
    const syncBadges = () => {
      for (const view of this.views) view.syncBadge?.();
    };
    this.registerEvent(this.app.vault.on("create", syncBadges));
    this.registerEvent(this.app.vault.on("delete", syncBadges));
    this.registerEvent(this.app.vault.on("rename", syncBadges));

    // Theme-Wechsel: Hintergrund und STL-Material folgen sofort.
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const view of this.views) view.refreshColors();
      }),
    );

    // Sidebar auf/zu (oder sonst ein Layout-Wechsel) aendert `panelVisible()` — ohne
    // dieses Nachziehen bliebe die Hover-Leiste stehen, nachdem die Sidebar geoeffnet
    // wurde, bis der Block aus einem anderen Grund neu zeichnet.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) this.lastMarkdownView = leaf.view;
      }),
    );
    // Nach dem Start gibt es noch kein active-leaf-change: die schon offene Notiz einmal vormerken.
    this.app.workspace.onLayoutReady(() => {
      this.lastMarkdownView ??= this.app.workspace.getActiveViewOfType(MarkdownView);
    });
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
    // Verwirft die Modell-Listen eines evtl. noch offenen Settings-Tabs.
    this.llm?.hideSettings();
    // three setzt beim Laden einen globalen Marker (window.__THREE__). Obsidian räumt
    // Globals beim Plugin-Reload (disable/enable) nicht auf → beim Wiedereinschalten
    // warnt three „Multiple instances of Three.js". Marker hier entfernen, damit ein
    // Reload sauber ist. (Bei normalem Laden beim Start tritt die Warnung nicht auf.)
    const w = window as unknown as { __THREE__?: unknown };
    if (w.__THREE__ !== undefined) delete w.__THREE__;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // "Auto-rotate" wirkt sofort auf offene Viewports — im Smoke #5 schien das
    // Toggle wirkungslos, weil nur NEUE Viewports den Wert lasen.
    for (const view of this.views) {
      view.refreshAutoRotate?.();
      view.refreshLighting?.();
    }
  }

  // Die zuletzt bediente Markdown-Ansicht: das Panel hat den Fokus, wenn der Nutzer uebernimmt, `getActiveViewOfType`
  // waere dann null.
  private lastMarkdownView: MarkdownView | null = null;

  /** Die zuletzt bediente Notiz. Primaer das zuletzt benutzte Blatt der Hauptflaeche (das Panel liegt in der
   *  Seitenleiste): `setViewState` tauscht die View-Instanz im selben Blatt aus, ohne dass `active-leaf-change`
   *  feuert, ein gemerkter Verweis haengt dann ab. Zweitens der gemerkte, solange er noch in einem Blatt haengt. */
  private lastEditor(): MarkdownView | null {
    const workspace = this.app.workspace;
    const recent = workspace.getMostRecentLeaf(workspace.rootSplit)?.view;
    if (recent instanceof MarkdownView && recent.file) return recent;
    const view = this.lastMarkdownView;
    if (!view?.file) return null;
    return this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === view) ? view : null;
  }

  private acceptEnv(): AcceptEnv {
    return {
      app: this.app,
      ports: obsidianWritePorts(this.app),
      settings: () => this.settings,
      lastEditor: () => this.lastEditor(),
      choose: () => new Promise((resolve) => { new AcceptAsModal(this.app, resolve).open(); }),
    };
  }

  private convertEnv() {
    return { app: this.app, ports: obsidianWritePorts(this.app), notice: (m: string) => { new Notice(m); } };
  }

  /** Das Prompt-Panel in der rechten Leiste oeffnen (oder zeigen) und ihm das Ziel geben. Solange die View
   *  nicht registriert ist (Task 6), meldet das eine Notice statt ein leeres Blatt anzulegen. */
  async openPromptPanel(target: PanelTarget): Promise<void> {
    const workspace = this.app.workspace;
    const unavailable = () => new Notice("The prompt panel is not available");
    // Intern, aber lesbar: ohne registrierten Typ legt setViewState ein leeres Blatt an, statt zu werfen.
    const registry = (this.app as unknown as { viewRegistry?: { viewByType?: Record<string, unknown> } }).viewRegistry?.viewByType;
    // registerView laeuft unbedingt in onload; nur verweigern, wenn die Registry lesbar ist und den Typ NICHT kennt
    // (setViewState legte sonst ein leeres Blatt an). Eine fehlende interne Registry ist kein Grund zu verweigern.
    if (registry && !(VIEW_TYPE_PROMPT in registry)) {
      unavailable();
      return;
    }
    try {
      let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_PROMPT)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getRightLeaf(false);
        if (!leaf) {
          unavailable();
          return;
        }
        await leaf.setViewState({ type: VIEW_TYPE_PROMPT, active: true });
      }
      await workspace.revealLeaf(leaf);
      if (leaf.view instanceof PromptPanelView) leaf.view.setTarget(target);
    } catch (error) {
      console.warn("[three-d-codeblocks] could not open the prompt panel:", error);
      unavailable();
    }
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
