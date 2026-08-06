// Zweigleisige Settings — EINE Wahrheit fuer beide Renderpfade.
//
// Ab Obsidian 1.13 fragt der Host `getSettingDefinitions()` ab und ruft `display()`
// nie; nur so erscheinen die Settings in der Settings-Suche. Unser `minAppVersion`
// ist 1.5.0, dort gibt es die deklarative API nicht — der Host ruft `display()`.
//
// Deshalb ist `getSettingDefinitions()` die einzige Definition, und `display()`
// zeichnet DIESELBE Struktur mit der klassischen `Setting`-API nach. Kein zweiter
// Definitionsbaum, der auseinanderlaufen kann.
//
// Muster uebernommen aus `vault-rag/src/settings.ts` + `vim-dojo/src/SettingsTab.ts`
// (REGISTRY: „Zweigleisige deklarative Settings — eine-Wahrheit-Walker"). Hier in der
// minimalen Form: alle Zeilen sind reine Controls, keine `render`-Hatches noetig.

import {
  PluginSettingTab,
  type App,
  type SettingDefinitionItem,
} from "obsidian";
import { MAX_CONTEXTS_LIMIT, mergeSettings, type PluginSettings } from "../core/settings-types";
import type ThreeDCodeblocksPlugin from "../main";
import { renderSettingDefinitions } from "../vendor/kit-obsidian/settings_walker";

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
        name: "Maximum live 3D views",
        desc:
          "How many inline models stay interactive at once. Older ones become still images. " +
          "0 turns the limit off (the browser then caps it itself).",
        // Obergrenze aus derselben Konstante, gegen die `mergeSettings` klemmt.
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
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    // Immer durch mergeSettings: das ist die einzige Stelle, die Muellwerte
    // abfaengt. Der deklarative Host validiert nur den Typ, nicht unsere Grenzen.
    this.plugin.settings = mergeSettings({ ...this.plugin.settings, [key]: value });
    await this.plugin.saveSettings();

    if (key === "panelPlacement") {
      // Sonst wirkt die neue Wahl erst nach einem Reload -- bereits offene
      // Bloecke behalten sonst ihre alte Leiste (oder keine), bis irgendein
      // anderer Grund sie neu zeichnet.
      this.plugin.syncAllToolbars();
    }
  }

  // ── Imperativer Fallback (Obsidian < 1.13) ───────────────────────────────
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
