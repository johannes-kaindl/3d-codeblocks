import { describe, expect, it, vi } from "vitest";
import ThreeDCodeblocksPlugin, { isPanelVisible } from "../../src/main";
import { TFile, makeFakeApp } from "../__mocks__/obsidian";
import { VIEW_TYPE_3D } from "../../src/obsidian/file-view";
import { VIEW_TYPE_SHAPES } from "../../src/obsidian/shapes-file-view";

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

describe("shapes registration", () => {
  function freshPlugin() {
    const app = makeFakeApp();
    const plugin = new ThreeDCodeblocksPlugin(app, {} as any) as any;
    plugin.registerView = vi.fn();
    plugin.registerExtensions = vi.fn();
    plugin.registerMarkdownCodeBlockProcessor = vi.fn();
    plugin.addCommand = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    return plugin;
  }

  it("registers the shapes language and extension", async () => {
    const plugin = freshPlugin();
    await plugin.onload();
    const languages = plugin.registerMarkdownCodeBlockProcessor.mock.calls.map((c: unknown[]) => c[0]);
    expect(languages).toEqual(expect.arrayContaining(["3d", "gltf", "shapes"]));
    const extensions = plugin.registerExtensions.mock.calls.flatMap((c: unknown[]) => c[0] as string[]);
    expect(extensions).toEqual(expect.arrayContaining(["gltf", "glb", "stl", "shapes"]));
  });

  it("(f) maps .shapes to the shapes file view and keeps it off the model file view", async () => {
    const plugin = freshPlugin();
    await plugin.onload();
    const calls = plugin.registerExtensions.mock.calls as [string[], string][];
    expect(calls).toContainEqual([["shapes"], VIEW_TYPE_SHAPES]);
    expect(calls).toContainEqual([["gltf", "glb", "stl"], VIEW_TYPE_3D]);
    expect(calls.filter(([exts, type]) => exts.includes("shapes") && type === VIEW_TYPE_3D)).toEqual([]);
    const types = plugin.registerView.mock.calls.map((c: unknown[]) => c[0]);
    expect(types).toContain("tdcb-shapes-file");
  });

  it("keeps loading when another plugin already owns the shapes language", async () => {
    const plugin = freshPlugin();
    plugin.registerMarkdownCodeBlockProcessor = vi.fn((lang: string) => {
      if (lang === "shapes") throw new Error("taken");
    });
    await expect(plugin.onload()).resolves.toBeUndefined();
  });

  it("keeps loading when another plugin already owns the shapes extension", async () => {
    const plugin = freshPlugin();
    plugin.registerExtensions = vi.fn((exts: string[]) => {
      if (exts.includes("shapes") && exts.length === 1) throw new Error("taken");
    });
    await expect(plugin.onload()).resolves.toBeUndefined();
  });
});
