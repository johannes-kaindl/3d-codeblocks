import { describe, expect, it, vi } from "vitest";
import ThreeDCodeblocksPlugin, { isPanelVisible } from "../../src/main";
import { TFile, makeFakeApp } from "../__mocks__/obsidian";
import { VIEW_TYPE_3D } from "../../src/obsidian/file-view";
import { VIEW_TYPE_SHAPES } from "../../src/obsidian/shapes-file-view";
import { VIEW_TYPE_PROMPT } from "../../src/obsidian/prompt-panel-id";
import { PromptPanelView } from "../../src/obsidian/prompt-panel";

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

describe("LLM connection wiring", () => {
  async function load(loadData: unknown = {}) {
    const app = makeFakeApp();
    const plugin = new ThreeDCodeblocksPlugin(app, { id: "three-d-codeblocks" } as any) as any;
    plugin.registerView = vi.fn();
    plugin.registerExtensions = vi.fn();
    plugin.registerMarkdownCodeBlockProcessor = vi.fn();
    plugin.addCommand = vi.fn();
    plugin.loadData = vi.fn(async () => loadData);
    plugin.saveData = vi.fn(async () => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await plugin.onload();
    return plugin;
  }

  it("creates plugin.llm with complete, models and renderSettings", async () => {
    const plugin = await load();
    expect(plugin.llm.complete).toBeTypeOf("function");
    expect(plugin.llm.models).toBeTypeOf("function");
    expect(plugin.llm.renderSettings).toBeTypeOf("function");
    expect(plugin.llm.hideSettings).toBeTypeOf("function");
  });

  it("calls createLlmConnection once with the documented option shape", async () => {
    const mod = await import("../../src/vendor/kit-obsidian/llm-connection");
    const spy = vi.spyOn(mod, "createLlmConnection");
    const plugin = await load();
    expect(spy).toHaveBeenCalledTimes(1);
    const o = spy.mock.calls[0]![0];
    expect(o.caller).toBe("3d-codeblocks");
    expect(o.capability).toBe("chat");
    expect(o.mode).toBe("structured");
    expect(o.pluginId).toBe("three-d-codeblocks");
    expect(o.getSettings()).toEqual({
      endpoints: plugin.settings.endpoints,
      choice: plugin.settings.endpointChoice,
      model: plugin.settings.llmModel,
      request: plugin.settings.request,
    });
    spy.mockRestore();
  });

  it("persist applies the patch synchronously, before saving", async () => {
    const mod = await import("../../src/vendor/kit-obsidian/llm-connection");
    const spy = vi.spyOn(mod, "createLlmConnection");
    const plugin = await load();
    const persist = spy.mock.calls[0]![0].persist;
    let seenAtSave: unknown;
    plugin.saveData = vi.fn(async (s: any) => { seenAtSave = s.llmModel; });
    const p = persist({ model: "m1", choice: { endpointId: "e" }, endpoints: [{ url: "http://a/v1", id: "e" }] });
    expect(plugin.settings.llmModel).toBe("m1");
    expect(plugin.settings.endpointChoice).toEqual({ endpointId: "e" });
    expect(plugin.settings.endpoints).toEqual([{ url: "http://a/v1", id: "e" }]);
    await p;
    expect(seenAtSave).toBe("m1");
    spy.mockRestore();
  });

  it("a failing save keeps the in-memory update and the rejection reaches the caller of persist", async () => {
    const mod = await import("../../src/vendor/kit-obsidian/llm-connection");
    const spy = vi.spyOn(mod, "createLlmConnection");
    const plugin = await load();
    const persist = spy.mock.calls[0]![0].persist;
    plugin.saveData = vi.fn(async () => { throw new Error("disk full"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let result: Promise<void> | undefined;
    expect(() => { result = persist({ model: "m2" }); }).not.toThrow();
    await expect(result).rejects.toThrow("disk full");
    expect(plugin.settings.llmModel).toBe("m2");
    // persist selbst schreibt nichts in die Konsole (die Meldung ist Sache des Kit).
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("onunload lets the connection release its model lists", async () => {
    const plugin = await load();
    const hide = vi.spyOn(plugin.llm, "hideSettings");
    plugin.onunload();
    expect(hide).toHaveBeenCalledTimes(1);
  });
});

describe("openPromptPanel", () => {
  /** Echte View (der Opener prueft per instanceof), setTarget als Spion. */
  const spiedView = () => {
    const v = new PromptPanelView({ app: undefined } as never, {} as never);
    vi.spyOn(v, "setTarget").mockImplementation(() => {});
    return v;
  };
  const target = { kind: "shapes-file", path: "a.shapes", label: "a" } as const;
  function setup(opts: { registered?: boolean; existing?: any } = {}) {
    const app = makeFakeApp();
    const view = spiedView();
    const leaf = { view, setViewState: vi.fn(async () => {}), detach: vi.fn() };
    app.viewRegistry = { viewByType: opts.registered === false ? {} : { [VIEW_TYPE_PROMPT]: () => ({}) } };
    app.workspace.getLeavesOfType = vi.fn(() => (opts.existing ? [opts.existing] : []));
    app.workspace.getRightLeaf = vi.fn(() => leaf);
    app.workspace.revealLeaf = vi.fn(async () => {});
    const plugin = new ThreeDCodeblocksPlugin(app, {} as any);
    return { plugin, app, leaf, view };
  }

  it("opens a leaf of the prompt view in the right sidebar, reveals it and hands over the target", async () => {
    const { plugin, app, leaf, view } = setup();
    await plugin.openPromptPanel(target);
    expect(app.workspace.getRightLeaf).toHaveBeenCalledWith(false);
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_PROMPT, active: true });
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    expect(view.setTarget).toHaveBeenCalledWith(target);
  });

  it("reuses an open panel instead of creating a second leaf", async () => {
    const existing = { view: spiedView(), setViewState: vi.fn() };
    const { plugin, app } = setup({ existing });
    await plugin.openPromptPanel(target);
    expect(app.workspace.getRightLeaf).not.toHaveBeenCalled();
    expect(existing.setViewState).not.toHaveBeenCalled();
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existing);
    expect(existing.view.setTarget).toHaveBeenCalledWith(target);
  });

  it("is harmless when the opened view has no setTarget", async () => {
    const { plugin, leaf } = setup();
    (leaf as any).view = {};
    await expect(plugin.openPromptPanel(target)).resolves.toBeUndefined();
  });

  it("says so and creates no leaf while the view type is not registered", async () => {
    const { plugin, app, leaf } = setup({ registered: false });
    const notices: unknown[] = [];
    const mod = await import("obsidian");
    const spy = vi.spyOn(mod, "Notice").mockImplementation(((m: string) => { notices.push(m); }) as never);
    await plugin.openPromptPanel(target);
    expect(leaf.setViewState).not.toHaveBeenCalled();
    expect(app.workspace.getRightLeaf).not.toHaveBeenCalled();
    expect(notices).toEqual(["The prompt panel is not available"]);
    spy.mockRestore();
  });

  it("does not create a leaf when the registry is absent (registration not provable)", async () => {
    const { plugin, app, leaf } = setup();
    delete app.viewRegistry;
    await plugin.openPromptPanel(target);
    expect(leaf.setViewState).not.toHaveBeenCalled();
    expect(app.workspace.getRightLeaf).not.toHaveBeenCalled();
  });

  it("reports a failing setViewState as 'not available' instead of throwing", async () => {
    const { plugin, leaf } = setup();
    leaf.setViewState = vi.fn(async () => { throw new Error("boom"); });
    await expect(plugin.openPromptPanel(target)).resolves.toBeUndefined();
  });
});
