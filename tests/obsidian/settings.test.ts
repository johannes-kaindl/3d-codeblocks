import { describe, expect, it, vi } from "vitest";
import type { SettingDefinitionControl, SettingDefinitionItem } from "obsidian";
import { SettingsTab } from "../../src/obsidian/settings";
import {
  DEFAULT_SETTINGS,
  MAX_CONTEXTS_LIMIT,
  type PluginSettings,
} from "../../src/core/settings-types";

function makeTab(overrides: Partial<PluginSettings> = {}) {
  const plugin: any = {
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    saveSettings: vi.fn(async () => {}),
    syncAllToolbars: vi.fn(),
  };
  return { tab: new SettingsTab({} as any, plugin), plugin };
}

/** Alle Control-Definitionen flach, Gruppen aufgeloest. */
function controls(items: SettingDefinitionItem[]): SettingDefinitionControl[] {
  const out: SettingDefinitionControl[] = [];
  for (const item of items) {
    if ((item as any).type === "group" || (item as any).type === "list") {
      out.push(...controls(((item as any).items ?? []) as SettingDefinitionItem[]));
    } else if ((item as any).control) {
      out.push(item as SettingDefinitionControl);
    }
  }
  return out;
}

describe("SettingsTab.getSettingDefinitions", () => {
  it("beschreibt jedes Setting genau einmal", () => {
    const { tab } = makeTab();
    const keys = controls(tab.getSettingDefinitions()).map((d) => d.control.key);

    expect(keys).toEqual([
      "viewMode",
      "defaultHeight",
      "autoRotate",
      "showGrid",
      "maxContexts",
      "panelPlacement",
      "lockedNodePrefixes",
    ]);
  });

  // Der eigentliche Schutz: ein vertippter Key faellt in der deklarativen API nicht
  // auf (der Host liest ihn nur ueber getControlValue), das Setting waere dann
  // stumm kaputt. Hier bricht es sofort.
  it("nennt nur Keys, die es in den Settings wirklich gibt", () => {
    const { tab } = makeTab();
    for (const def of controls(tab.getSettingDefinitions())) {
      expect(Object.keys(DEFAULT_SETTINGS)).toContain(def.control.key);
    }
  });

  it("gibt jedem Setting einen Namen und eine Beschreibung", () => {
    const { tab } = makeTab();
    for (const def of controls(tab.getSettingDefinitions())) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(String(def.desc ?? "").length).toBeGreaterThan(0);
    }
  });

  it("bindet den Slider an dieselbe Obergrenze, die mergeSettings klemmt", () => {
    const { tab } = makeTab();
    const slider = controls(tab.getSettingDefinitions()).find(
      (d) => d.control.key === "maxContexts",
    );

    expect(slider?.control).toMatchObject({ type: "slider", min: 0, max: MAX_CONTEXTS_LIMIT });
  });
});

describe("SettingsTab.getControlValue / setControlValue", () => {
  it("liest den aktuellen Wert, nicht den Default", () => {
    const { tab } = makeTab({ viewMode: "on-click", maxContexts: 3 });

    expect(tab.getControlValue("viewMode")).toBe("on-click");
    expect(tab.getControlValue("maxContexts")).toBe(3);
  });

  it("speichert eine Aenderung ueber mergeSettings", async () => {
    const { tab, plugin } = makeTab();
    await tab.setControlValue("autoRotate", true);

    expect(plugin.settings.autoRotate).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  // mergeSettings ist die einzige Stelle, die Muellwerte abfaengt — der deklarative
  // Pfad darf sie nicht umgehen, sonst landet NaN in data.json.
  it("laesst mergeSettings ungueltige Eingaben abfangen", async () => {
    const { tab, plugin } = makeTab();
    await tab.setControlValue("defaultHeight", Number.NaN);

    expect(plugin.settings.defaultHeight).toBe(DEFAULT_SETTINGS.defaultHeight);
  });

  it("zeichnet offene Bloecke neu, wenn die Platzierung wechselt", async () => {
    const { tab, plugin } = makeTab();
    await tab.setControlValue("panelPlacement", "toolbar");

    expect(plugin.settings.panelPlacement).toBe("toolbar");
    expect(plugin.syncAllToolbars).toHaveBeenCalledTimes(1);
  });

  it("zeichnet nicht neu, wenn ein anderes Setting wechselt", async () => {
    const { tab, plugin } = makeTab();
    await tab.setControlValue("showGrid", true);

    expect(plugin.syncAllToolbars).not.toHaveBeenCalled();
  });
});

// Fallback-Pfad: Auf Obsidian < 1.13 ruft der Host display(). Bricht der, sehen
// Nutzer unterhalb 1.13 GAR KEINE Settings — minAppVersion ist 1.5.0.
describe("SettingsTab.display (Fallback unter Obsidian 1.13)", () => {
  it("zeichnet jede Definition als Setting-Zeile", () => {
    const { tab } = makeTab();
    tab.display();

    const rows = (tab.containerEl as any).settings ?? [];
    expect(rows).toHaveLength(controls(tab.getSettingDefinitions()).length);
    expect(rows.map((r: any) => r.name)).toContain("View mode");
  });

  it("waehlt pro Control-Typ das passende Widget", () => {
    const { tab } = makeTab();
    tab.display();

    const byName = new Map(
      ((tab.containerEl as any).settings ?? []).map((r: any) => [r.name, r.widgets[0]]),
    );
    expect((byName.get("View mode") as any).type).toBe("dropdown");
    expect((byName.get("Auto-rotate") as any).type).toBe("toggle");
    expect((byName.get("Maximum live 3D views") as any).type).toBe("slider");
    expect((byName.get("Default height") as any).type).toBe("text");
    expect((byName.get("Locked node prefixes") as any).type).toBe("text");
  });

  it("setzt den gespeicherten Wert ins Widget", () => {
    const { tab } = makeTab({ viewMode: "on-click", maxContexts: 9 });
    tab.display();

    const rows = (tab.containerEl as any).settings ?? [];
    const dropdown = rows.find((r: any) => r.name === "View mode").widgets[0];
    const slider = rows.find((r: any) => r.name === "Maximum live 3D views").widgets[0];

    expect(dropdown.value).toBe("on-click");
    expect(dropdown.options).toMatchObject({ immediate: expect.any(String) });
    expect(slider.value).toBe(9);
    expect(slider.max).toBe(MAX_CONTEXTS_LIMIT);
  });

  it("persistiert eine Aenderung aus dem Fallback-Widget", async () => {
    const { tab, plugin } = makeTab();
    tab.display();

    const toggle = ((tab.containerEl as any).settings ?? []).find(
      (r: any) => r.name === "Show ground grid",
    ).widgets[0];
    await toggle.onChangeHandler(true);

    expect(plugin.settings.showGrid).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  // Der Zahlen-Fallback ist ein Textfeld: ohne Coercion landet der String "500"
  // in den Settings, mergeSettings verwirft ihn stumm auf den Default.
  it("wandelt die Texteingabe eines Zahlen-Controls in eine Zahl", async () => {
    const { tab, plugin } = makeTab();
    tab.display();

    const text = ((tab.containerEl as any).settings ?? []).find(
      (r: any) => r.name === "Default height",
    ).widgets[0];
    await text.onChangeHandler("500");

    expect(plugin.settings.defaultHeight).toBe(500);
  });

  it("zeichnet die Zeile fuer gesperrte Praefixe und speichert eine Aenderung", async () => {
    const { tab, plugin } = makeTab();
    tab.display();

    const rows = (tab.containerEl as any).settings ?? [];
    const row = rows.find((r: any) => r.name === "Locked node prefixes");
    expect(row).toBeDefined();
    expect(String(row.desc ?? "")).toContain("env__");

    await row.widgets[0].onChangeHandler("sky__, env__");

    expect(plugin.settings.lockedNodePrefixes).toBe("sky__, env__");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("raeumt vor jedem Neuzeichnen auf, statt zu verdoppeln", () => {
    const { tab } = makeTab();
    tab.display();
    const first = ((tab.containerEl as any).settings ?? []).length;
    tab.display();

    expect(((tab.containerEl as any).settings ?? []).length).toBe(first);
  });
});
