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
import { HELP_TEXTS } from "../i18n/strings";
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
      helpSettingDefinition({ ...githubHelpUrls("3d-codeblocks"), texts: HELP_TEXTS }),
      {
        name: "View mode",
        desc: "How 3D blocks behave when a note opens.",
        control: {
          type: "dropdown",
          key: "viewMode",
          options: {
            immediate: "Interactive right away",
            "on-click": "Still image, activate on click",
          },
        },
      },
      {
        name: "Default height",
        desc: "Height in pixels for blocks without a `height:` key.",
        control: { type: "number", key: "defaultHeight", min: 1, step: 1 },
      },
      {
        name: "Auto-rotate",
        desc: "Slowly spin the model until you interact with it.",
        control: { type: "toggle", key: "autoRotate" },
      },
      {
        name: "Show ground grid",
        desc: "Draw a reference grid under the model.",
        control: { type: "toggle", key: "showGrid" },
      },
      {
        name: "Lighting",
        desc:
          "How models are lit. Metallic surfaces need an environment to reflect — " +
          "without one they appear black.",
        control: {
          type: "dropdown",
          key: "lighting",
          options: {
            off: "Off — metallic models appear black",
            faithful: "Faithful colors",
            contrast: "High contrast",
          },
        },
      },
      {
        name: "Model's own lights",
        desc: "Some 3D files bring their own lights.",
        control: {
          type: "dropdown",
          key: "modelLights",
          options: {
            prefer: "Use them — the plugin stops adding its own",
            ignore: "Ignore them — always use the plugin's lighting",
          },
        },
      },
      {
        name: "Allow external resources",
        desc:
          "A .gltf file can point at files it needs (geometry, textures). Normally only " +
          "files inside your vault are loaded. Turn this on to also allow http(s) " +
          "addresses \u2014 opening such a note then contacts those servers.",
        control: { type: "toggle", key: "allowExternalResources" },
      },
      {
        name: "Maximum live 3D views",
        desc:
          "How many inline models stay interactive at once. Older ones become still images. " +
          "0 turns the limit off (the browser then caps it itself).",
        // Obergrenze aus derselben Konstante, gegen die `validateSettings` klemmt.
        control: { type: "slider", key: "maxContexts", min: 0, max: MAX_CONTEXTS_LIMIT, step: 1 },
      },
      {
        name: "Controls placement",
        desc: "Where the buttons for saving a view appear.",
        control: {
          type: "dropdown",
          key: "panelPlacement",
          options: {
            auto: "Sidebar when open, toolbar otherwise",
            sidebar: "Sidebar only",
            toolbar: "Toolbar only",
          },
        },
      },
      {
        name: "Locked node prefixes",
        desc: "Comma-separated name prefixes protected from editing (e.g. env__).",
        control: { type: "text", key: "lockedNodePrefixes" },
      },
      {
        type: "group",
        heading: "Model by prompt",
        items: [
          {
            name: "Apply new models as",
            desc: "Where the prompt panel puts a new model when you click Apply.",
            control: {
              type: "dropdown",
              key: "acceptAs",
              options: { block: "Code block at the cursor", file: "File in the attachment folder", ask: "Ask each time" },
            },
          },
          // Texte kommen aus dem Kit (englische Default-Texte) — kein eigenes Buendel.
          { name: "Language model", desc: "", render: (setting: Setting) => this.plugin.llm.renderSettings(settingBodyHost(setting)) },
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
