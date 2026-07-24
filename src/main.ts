import { Plugin, TFile, type MarkdownPostProcessorContext } from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type PluginSettings } from "./core/settings-types";
import { ModelBlock } from "./obsidian/block-child";
import { ContextManager } from "./obsidian/context-manager";
import { SettingsTab } from "./obsidian/settings";
import { readSceneColors } from "./obsidian/theme";
import { isWebGLAvailable } from "./obsidian/webgl";
import { loadModel } from "./viewer/loaders";
import { Viewport } from "./viewer/viewport";

export default class ThreeDCodeblocksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  private readonly blocks = new Set<ModelBlock>();
  private readonly contexts = new ContextManager(
    () => this.settings.maxContexts,
    () => Date.now(),
  );

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor(
      "3d",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const block = new ModelBlock(el, source, ctx.sourcePath, {
          app: this.app,
          settings: () => this.settings,
          factory: {
            create: (options) => new Viewport(options),
            isWebGLAvailable,
          },
          budget: this.contexts,
          loadModel,
          readColors: readSceneColors,
        });

        this.blocks.add(block);
        block.register(() => this.blocks.delete(block));
        ctx.addChild(block);
      },
    );

    // Regenerierte Dateien (gleicher Pfad, neuer Inhalt) sollen ohne Neustart neu laden.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        for (const block of this.blocks) void block.onFileModified(file);
      }),
    );

    // Theme-Wechsel: Hintergrund und STL-Material folgen sofort.
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const block of this.blocks) block.refreshColors();
      }),
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
