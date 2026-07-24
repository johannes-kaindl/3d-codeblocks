import { PluginSettingTab, Setting, type App } from "obsidian";
import { MAX_CONTEXTS_LIMIT, mergeSettings } from "../core/settings-types";
import type ThreeDCodeblocksPlugin from "../main";

export class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ThreeDCodeblocksPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("View mode")
      .setDesc("How 3D blocks behave when a note opens.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("immediate", "Interactive right away")
          .addOption("on-click", "Still image, activate on click")
          .setValue(this.plugin.settings.viewMode)
          .onChange(async (value) => {
            await this.persist({ viewMode: value });
          }),
      );

    new Setting(containerEl)
      .setName("Default height")
      .setDesc("Height in pixels for blocks without a `height:` key.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.defaultHeight))
          .onChange(async (value) => {
            await this.persist({ defaultHeight: Number(value) });
          }),
      );

    new Setting(containerEl)
      .setName("Auto-rotate")
      .setDesc("Slowly spin the model until you interact with it.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoRotate).onChange(async (value) => {
          await this.persist({ autoRotate: value });
        }),
      );

    new Setting(containerEl)
      .setName("Show ground grid")
      .setDesc("Draw a reference grid under the model.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showGrid).onChange(async (value) => {
          await this.persist({ showGrid: value });
        }),
      );

    new Setting(containerEl)
      .setName("Maximum live 3D views")
      .setDesc(
        "How many inline models stay interactive at once. Older ones become still images. " +
          "0 turns the limit off (the browser then caps it itself).",
      )
      .addSlider((slider) =>
        // Der Wert wird seit neuerem Obsidian automatisch inline neben dem Slider gezeigt.
        slider
          .setLimits(0, MAX_CONTEXTS_LIMIT, 1)
          .setValue(this.plugin.settings.maxContexts)
          .onChange(async (value) => {
            await this.persist({ maxContexts: value });
          }),
      );
  }

  private async persist(patch: Record<string, unknown>): Promise<void> {
    this.plugin.settings = mergeSettings({ ...this.plugin.settings, ...patch });
    await this.plugin.saveSettings();
  }
}
