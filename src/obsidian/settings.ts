// Zweigleisige Settings — EINE Wahrheit fuer beide Renderpfade.
//
// Ab Obsidian 1.13 fragt der Host `getSettingDefinitions()` ab und ruft `display()`
// nie; nur so erscheinen die Settings in der Settings-Suche. Unser `minAppVersion`
// ist 1.11.4; unter 1.13 gibt es die deklarative API nicht — der Host ruft `display()`.
//
// Deshalb ist `getSettingDefinitions()` die einzige Definition, und `display()`
// zeichnet DIESELBE Struktur mit der klassischen `Setting`-API nach. Kein zweiter
// Definitionsbaum, der auseinanderlaufen kann.
//
// Muster uebernommen aus `vault-rag/src/settings.ts` + `vim-dojo/src/SettingsTab.ts`
// (REGISTRY: „Zweigleisige deklarative Settings — eine-Wahrheit-Walker"). Fast alle Zeilen
// sind reine Controls; die Hilfe-Zeile und der LLM-Abschnitt sind `render`-Hatches.

import {
  PluginSettingTab,
  type App,
  type Setting,
  type SettingDefinitionItem,
} from "obsidian";
import { MAX_CONTEXTS_LIMIT, validateSettings, type PluginSettings } from "../core/settings-types";
import type ThreeDCodeblocksPlugin from "../main";
import { helpTexts } from "../i18n/strings";
import { getLang, t } from "../i18n/t";
import { githubHelpUrls, helpSettingDefinition } from "../vendor/kit-obsidian/help-setting";
import { renderSettingDefinitions, settingBodyHost } from "../vendor/kit-obsidian/settings_walker";

export class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ThreeDCodeblocksPlugin,
  ) {
    super(app, plugin);
  }

  // ── Die eine Wahrheit ────────────────────────────────────────────────────
  // Der Generic-Parameter bindet jeden `key` an ein echtes Settings-Feld: ein
  // Tippfehler bricht den Build, statt zur Laufzeit stumm ins Leere zu greifen
  // (der Host liest den Wert nur ueber getControlValue).
  getSettingDefinitions(): SettingDefinitionItem<keyof PluginSettings>[] {
    return [
      // Hilfe-Zeile (UI-STANDARD §8): immer das ERSTE Element, vor allem anderen. Der
      // Fallback-Walker zeichnet sie ueber denselben Render-Hatch.
      helpSettingDefinition({ ...githubHelpUrls("3d-codeblocks"), texts: helpTexts() }),
      {
        name: t("settings.viewMode"),
        desc: t("settings.viewMode.desc"),
        control: {
          type: "dropdown",
          key: "viewMode",
          options: {
            immediate: t("settings.viewMode.immediate"),
            "on-click": t("settings.viewMode.on-click"),
          },
        },
      },
      {
        name: t("settings.defaultHeight"),
        desc: t("settings.defaultHeight.desc"),
        control: { type: "number", key: "defaultHeight", min: 1, step: 1 },
      },
      {
        name: t("settings.autoRotate"),
        desc: t("settings.autoRotate.desc"),
        control: { type: "toggle", key: "autoRotate" },
      },
      {
        name: t("settings.showGrid"),
        desc: t("settings.showGrid.desc"),
        control: { type: "toggle", key: "showGrid" },
      },
      {
        name: t("settings.lighting"),
        desc: t("settings.lighting.desc"),
        control: {
          type: "dropdown",
          key: "lighting",
          options: {
            off: t("settings.lighting.off"),
            faithful: t("settings.lighting.faithful"),
            contrast: t("settings.lighting.contrast"),
          },
        },
      },
      {
        name: t("settings.modelLights"),
        desc: t("settings.modelLights.desc"),
        control: {
          type: "dropdown",
          key: "modelLights",
          options: {
            prefer: t("settings.modelLights.prefer"),
            ignore: t("settings.modelLights.ignore"),
          },
        },
      },
      {
        name: t("settings.external"),
        desc: t("settings.external.desc"),
        control: { type: "toggle", key: "allowExternalResources" },
      },
      {
        name: t("settings.maxContexts"),
        desc: t("settings.maxContexts.desc"),
        // Obergrenze aus derselben Konstante, gegen die `validateSettings` klemmt.
        control: { type: "slider", key: "maxContexts", min: 0, max: MAX_CONTEXTS_LIMIT, step: 1 },
      },
      {
        name: t("settings.placement"),
        desc: t("settings.placement.desc"),
        control: {
          type: "dropdown",
          key: "panelPlacement",
          options: {
            auto: t("settings.placement.auto"),
            sidebar: t("settings.placement.sidebar"),
            toolbar: t("settings.placement.toolbar"),
          },
        },
      },
      {
        name: t("settings.locked"),
        desc: t("settings.locked.desc"),
        control: { type: "text", key: "lockedNodePrefixes" },
      },
      {
        type: "group",
        heading: t("settings.promptGroup"),
        items: [
          {
            name: t("settings.acceptAs"),
            desc: t("settings.acceptAs.desc"),
            control: {
              type: "dropdown",
              key: "acceptAs",
              options: { block: t("settings.acceptAs.block"), file: t("settings.acceptAs.file"), ask: t("settings.acceptAs.ask") },
            },
          },
          // Texte kommen aus dem Kit (englische Default-Texte) — kein eigenes Buendel.
          { name: t("settings.llm"), desc: "", render: (setting: Setting) => this.plugin.llm.renderSettings(settingBodyHost(setting), { lang: getLang() }) },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    // Immer durch validateSettings: das ist die einzige Stelle, die Muellwerte
    // abfaengt. Der deklarative Host validiert nur den Typ, nicht unsere Grenzen.
    this.plugin.settings = validateSettings({ ...this.plugin.settings, [key]: value });
    await this.plugin.saveSettings();

    if (key === "panelPlacement") {
      // Sonst wirkt die neue Wahl erst nach einem Reload -- bereits offene
      // Bloecke behalten sonst ihre alte Leiste (oder keine), bis irgendein
      // anderer Grund sie neu zeichnet.
      this.plugin.syncAllToolbars();
    }
  }

  // ── Imperativer Fallback (Obsidian < 1.13) ───────────────────────────────
  override hide(): void {
    super.hide?.();
    this.plugin.llm.hideSettings();
  }

  private cleanupPrevious: () => void = () => {};

  display(): void {
    this.cleanupPrevious();
    this.containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(
      this.containerEl,
      this.getSettingDefinitions(),
      this,
      this.app,
    );
  }
}
