import { describe, expect, it, vi } from "vitest";
import ThreeDCodeblocksPlugin, { isPanelVisible } from "../../src/main";
import { TFile, makeFakeApp } from "../__mocks__/obsidian";
import { VIEW_TYPE_3D } from "../../src/obsidian/file-view";

// Regressionstest fuer Finding 2 (Whole-Branch-Review 2026-07-25): ein Leaf allein
// (getLeavesOfType(...).length > 0) reicht nicht -- Sidebar-Leaves ueberleben in
// Obsidians Layout auch ueber Neustarts hinweg, selbst wenn die rechte Leiste
// eingeklappt ist. Ohne die Collapsed-Pruefung gilt die Sidebar nach dem ERSTEN
// Oeffnen fuer immer als "offen": die Toolbar (Ausweichloesung bei geschlossener
// Sidebar) erscheint dann nie wieder, waehrend das Panel selbst unsichtbar bleibt.
function fakeWorkspace(leafCount: number, collapsed: boolean) {
  return {
    getLeavesOfType: vi.fn().mockReturnValue(new Array(leafCount).fill({})),
    rightSplit: { collapsed },
  };
}

describe("isPanelVisible", () => {
  it("is false when there is no panel leaf at all", () => {
    expect(isPanelVisible(fakeWorkspace(0, false))).toBe(false);
  });

  it("is true when a panel leaf exists and the right split is expanded", () => {
    expect(isPanelVisible(fakeWorkspace(1, false))).toBe(true);
  });

  it("is false when a panel leaf exists but the right split is collapsed", () => {
    // Der eigentliche Regressionsfall: ein Leaf, das seit einer frueheren Sitzung im
    // Layout haengt, aber gerade eingeklappt ist.
    expect(isPanelVisible(fakeWorkspace(1, true))).toBe(false);
  });

  it("is false when the right split is collapsed even with several leaves", () => {
    expect(isPanelVisible(fakeWorkspace(3, true))).toBe(false);
  });
});

// Finding 2 (Whole-Branch-Review): der `modify`-Watcher kannte nur Bloecke und Embeds.
// Eine offene ModelFileView bekam Regenerierungen deshalb nie mit -- eine dort laufende
// Edit-Session war ab der ersten Regenerierung dauerhaft stale.
describe("modify watcher wiring", () => {
  /** Plugin hochfahren und die beiden Haken einsammeln, die dieser Test braucht:
   *  die ModelFileView-Fabrik und den `vault.on("modify")`-Handler. */
  async function loadedPlugin() {
    const app = makeFakeApp();
    const plugin = new ThreeDCodeblocksPlugin(app, {} as any);
    const views = new Map<string, (leaf: any) => unknown>();
    plugin.registerView = vi.fn((type: string, creator: any) => views.set(type, creator));
    plugin.registerExtensions = vi.fn();
    plugin.addCommand = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await plugin.onload();

    const modify = app.vault.on.mock.calls.find((call: unknown[]) => call[0] === "modify")?.[1];
    return { app, plugin, views, modify };
  }

  it("registers the ModelFileView with the modify watcher and forwards events to it", async () => {
    const { app, views, modify } = await loadedPlugin();

    const factory = views.get(VIEW_TYPE_3D);
    expect(factory).toBeDefined();
    const view = factory!({ app }) as any;
    const onFileModified = vi.spyOn(view, "onFileModified");

    const file = new TFile();
    file.path = "weltmodell/3d/haus.glb";
    expect(modify).toBeTypeOf("function");
    modify!(file);

    expect(onFileModified).toHaveBeenCalledWith(file);
  });

  it("unregisters the view again when its leaf unloads", async () => {
    const { app, views, modify } = await loadedPlugin();

    const view = views.get(VIEW_TYPE_3D)!({ app }) as any;
    // `track()` haengt die Abmeldung an `view.register(cb)` -- Obsidian ruft die
    // registrierten Callbacks beim Entladen der Komponente. Der Mock speichert sie
    // nicht, deshalb hier von Hand nachstellen, was Obsidian dann tut.
    const unregister = view.register.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(unregister).toBeTypeOf("function");
    unregister!();

    const onFileModified = vi.spyOn(view, "onFileModified");
    const file = new TFile();
    file.path = "weltmodell/3d/haus.glb";
    modify!(file);

    expect(onFileModified).not.toHaveBeenCalled();
  });

  // Smoke #5-Befund: Settings-Aenderungen muessen offene Viewports erreichen.
  it("saveSettings stoesst refreshAutoRotate aller getrackten Views an", async () => {
    const { app, plugin, views } = await loadedPlugin();
    const view = views.get(VIEW_TYPE_3D)!({ app }) as any;
    view.refreshAutoRotate = vi.fn();
    await plugin.saveSettings();
    expect(view.refreshAutoRotate).toHaveBeenCalled();
  });
});
