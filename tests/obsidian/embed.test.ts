import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp, makeFakeEl } from "../__mocks__/obsidian";
import { ModelEmbed, registerModelEmbeds } from "../../src/obsidian/embed";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import { ActiveViewport } from "../../src/core/active-viewport";
import type { EditIo } from "../../src/obsidian/edit-mode";
import { contractGltfText } from "../helpers/contract-gltf";

/** In-Memory-`EditIo`-Fake wie im Task-10-Test (`tests/obsidian/block-child.test.ts`) --
 *  reicht fuer die Verdrahtungstests hier, die nie wirklich patchen. */
function makeEditIo(files: Record<string, string> = {}): EditIo {
  return {
    exists: (path) => path in files,
    readText: (path) => Promise.resolve(files[path] ?? "{}"),
    readBinary: () => Promise.reject(new Error("binary unused in these tests")),
    writeText: (path, text) => {
      files[path] = text;
      return Promise.resolve();
    },
    writeBinary: () => Promise.reject(new Error("binary unused in these tests")),
  };
}

/** Fabrik-Override, die zusaetzlich ein `createEditRig`-Double liefert -- ohne Rig
 *  bleibt `enter()` bewusst inaktiv (Fix #4, edit-mode.ts). */
function withEditRig(factory: any) {
  const originalCreate = factory.create;
  factory.create = (opts: any) => {
    const viewport = originalCreate(opts);
    viewport.createEditRig = vi.fn(() => ({
      setMode: vi.fn(),
      select: vi.fn(),
      applyTrs: vi.fn(),
      dispose: vi.fn(),
    }));
    return viewport;
  };
  return factory;
}

function makeGlb(): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }));
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.fill(0x20);
  padded.set(bytes);
  const total = 20 + padded.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf).set(padded, 20);
  return buf;
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const created: any[] = [];
  const app = makeFakeApp();
  app.vault.readBinary = vi.fn().mockResolvedValue(makeGlb());
  const loadModel = vi.fn().mockResolvedValue({});
  const active = (overrides.active as ActiveViewport | undefined) ?? new ActiveViewport();
  return {
    app,
    created,
    loadModel,
    active,
    deps: {
      app,
      settings: () => DEFAULT_SETTINGS,
      factory: {
        isWebGLAvailable: () => true,
        create: (opts: any) => {
          const vp = {
            opts,
            setModel: vi.fn(),
            setView: vi.fn(),
            getView: vi.fn(() => null),
            setColors: vi.fn(),
            resize: vi.fn(),
            resetCamera: vi.fn(),
            capturePoster: () => "data:image/png;base64,AAA",
            dispose: vi.fn(),
          };
          created.push(vp);
          return vp;
        },
      },
      budget: { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() },
      loadModel,
      readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
      active,
      editIo: makeEditIo(),
      confirmDiscard: () => Promise.resolve(true),
      ...overrides,
    } as any,
  };
}

/** Ein geladener Embed mit aktiver Registry — analog `loadedBlock` (Task 9). */
async function makeLoadedEmbed(overrides: Record<string, unknown> = {}) {
  const { deps, created, active } = makeDeps(overrides);
  const el = makeFakeEl();
  const embed = new ModelEmbed(el, fileAt("a.gltf"), deps);
  embed.loadFile();
  await embed.rendering;
  return { embed, created, active };
}

/** Rekursiv nach `.tdcb-stage` suchen -- sie haengt seit dem Viewport-Wrapper-Fix
    (Toolbar-Ueberleben in Poster-/Reaktivierungs-/Fehler-Reload-Pfaden) unter
    `.tdcb-viewport`, nicht mehr direkt unter `.tdcb-block`. */
function findStage(el: any): any {
  if (String(el.className).includes("tdcb-stage")) return el;
  for (const child of el.children ?? []) {
    const found = findStage(child);
    if (found) return found;
  }
  return undefined;
}

function fileAt(path: string, mtime = 1): TFile {
  const f = new TFile();
  f.path = path;
  f.basename = path.split("/").pop() ?? path;
  f.stat = { mtime, ctime: 0, size: 4 };
  return f;
}

describe("ModelEmbed", () => {
  it("renders the file when Obsidian calls loadFile() with NO argument", async () => {
    // Obsidian übergibt die Datei über den Creator (Konstruktor) und ruft loadFile()
    // ohne Argument. Ein loadFile(file)-Bug würde hier nichts rendern.
    const { deps, loadModel } = makeDeps();
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, fileAt("weltmodell/3d/eg.gltf"), deps);
    embed.loadFile();
    await embed.rendering;

    expect(loadModel).toHaveBeenCalledTimes(1);
  });

  it("uses the width attribute (|N) as the height", async () => {
    const { deps } = makeDeps();
    const el = makeFakeEl();
    el.setAttribute("width", "250");

    const embed = new ModelEmbed(el, fileAt("a.gltf"), deps);
    embed.loadFile();
    await embed.rendering;

    const stage = findStage(el);
    expect(stage.style.height).toBe("250px");
  });

  it("uses the default height when no dimension is given", async () => {
    const { deps } = makeDeps();
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, fileAt("a.gltf"), deps);
    embed.loadFile();
    await embed.rendering;

    const stage = findStage(el);
    expect(stage.style.height).toBe("400px");
  });

  it("reloads on a modify of the same file", async () => {
    const { deps, app } = makeDeps();
    const el = makeFakeEl();
    const file = fileAt("a.gltf", 1);

    const embed = new ModelEmbed(el, file, deps);
    embed.loadFile();
    await embed.rendering;
    const before = app.vault.readBinary.mock.calls.length;

    file.stat.mtime = 99;
    embed.onFileModified(file);
    await embed.rendering;

    expect(app.vault.readBinary.mock.calls.length).toBe(before + 1);
  });

  it("disposes on unload", async () => {
    const { deps, created } = makeDeps();
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, fileAt("a.gltf"), deps);
    embed.loadFile();
    await embed.rendering;
    embed.onunload();

    expect(created[0].dispose).toHaveBeenCalled();
  });
});

describe("ModelEmbed as a ViewportController", () => {
  it("registers itself as the active viewport when the user interacts", async () => {
    const { embed, created, active } = await makeLoadedEmbed();
    created[0].opts.onInteract();
    expect(active.get()).toBe(embed.controller);
    expect(active.get()?.canSave()).toBe(false);
  });

  it("clears itself from the registry on unload", async () => {
    const { embed, created, active } = await makeLoadedEmbed();
    created[0].opts.onInteract();
    embed.onunload();
    expect(active.get()).toBeNull();
  });
});

// Task 12: Embed-Verdrahtung des EditCoordinator -- Embeds haben keine Toolbar,
// die Sidebar ist der EINZIGE Bedienort (`controller.editPanel()`).
describe("ModelEmbed edit mode wiring", () => {
  it("offers editPanel for a .gltf file, enabled once the host has loaded", async () => {
    const { deps } = makeDeps();
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, fileAt("model.gltf"), deps);
    embed.loadFile();
    await embed.rendering;

    const panel = embed.controller.editPanel?.();
    expect(panel).toBeTruthy();
    expect(panel!.disabledReason).toBeNull();
  });

  it("disables editing for an .stl file with the format reason", async () => {
    const { deps } = makeDeps();
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, fileAt("model.stl"), deps);
    embed.loadFile();
    await embed.rendering;

    const panel = embed.controller.editPanel?.();
    expect(panel!.disabledReason).toContain("glTF");
  });

  it("reaches reapplyAfterReload() on onFileModified() during an active edit", async () => {
    const editFiles: Record<string, string> = { "model.gltf": contractGltfText() };
    const { deps } = makeDeps({ editIo: makeEditIo(editFiles) });
    withEditRig(deps.factory);

    const el = makeFakeEl();
    const file = fileAt("model.gltf", 1);
    const embed = new ModelEmbed(el, file, deps);
    embed.loadFile();
    await embed.rendering;

    const edit = (embed as any).edit;
    await edit.enter();
    expect(edit.active).toBe(true);

    const reapplyAfterReload = vi.spyOn(edit, "reapplyAfterReload");

    file.stat.mtime = 99;
    embed.onFileModified(file);
    await embed.rendering;

    expect(reapplyAfterReload).toHaveBeenCalledTimes(1);
    // Reload ueberlebt den aktiven Edit -- die Session bleibt aktiv, nicht nur
    // "die Methode wurde aufgerufen".
    expect(edit.active).toBe(true);
  });

  it("onunload() during an active edit does not throw and unpins (Coordinator spy)", async () => {
    const editFiles: Record<string, string> = { "model.gltf": contractGltfText() };
    const { deps } = makeDeps({ editIo: makeEditIo(editFiles) });
    withEditRig(deps.factory);

    const el = makeFakeEl();
    const embed = new ModelEmbed(el, fileAt("model.gltf"), deps);
    embed.loadFile();
    await embed.rendering;

    const edit = (embed as any).edit;
    await edit.enter();
    expect(edit.active).toBe(true);

    const exitSilently = vi.spyOn(edit, "exitSilently");

    expect(() => embed.onunload()).not.toThrow();

    expect(exitSilently).toHaveBeenCalledTimes(1);
    expect(edit.active).toBe(false);
  });
});

describe("registerModelEmbeds", () => {
  it("registers the 3d extensions when embedRegistry exists", () => {
    const { deps, app } = makeDeps();
    const registered: string[] = [];
    (app as any).embedRegistry = {
      isExtensionRegistered: () => false,
      registerExtension: (ext: string) => registered.push(ext),
    };

    const ok = registerModelEmbeds(app, deps, () => {});

    expect(ok).toBe(true);
    expect(registered.sort()).toEqual(["glb", "gltf", "stl"]);
  });

  it("returns false and does nothing when the API is missing", () => {
    const { deps, app } = makeDeps();
    delete (app as any).embedRegistry;

    expect(registerModelEmbeds(app, deps, () => {})).toBe(false);
  });

  it("tracks each created embed", () => {
    const { deps, app } = makeDeps();
    let creator: any;
    (app as any).embedRegistry = {
      isExtensionRegistered: () => false,
      registerExtension: (_ext: string, c: any) => {
        creator = c;
      },
    };
    const tracked: unknown[] = [];

    registerModelEmbeds(app, deps, (v) => tracked.push(v));
    const embed = creator({ app, containerEl: makeFakeEl() }, fileAt("a.gltf"), "");

    expect(tracked).toContain(embed);
  });
});
