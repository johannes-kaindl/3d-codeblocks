import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp } from "../__mocks__/obsidian";
import { ModelFileView, VIEW_TYPE_3D } from "../../src/obsidian/file-view";
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

function makeView(overrides: Record<string, unknown> = {}) {
  const created: any[] = [];
  const loadModel = vi.fn().mockResolvedValue({});
  const app = makeFakeApp();
  app.vault.readBinary = vi.fn().mockResolvedValue(makeGlb());
  const budget = { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() };
  const active = (overrides.active as ActiveViewport | undefined) ?? new ActiveViewport();
  const factory = {
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
  };
  const deps = {
    settings: () => DEFAULT_SETTINGS,
    factory,
    budget,
    loadModel,
    readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
    active,
    editIo: makeEditIo(),
    confirmDiscard: () => Promise.resolve(true),
    ...overrides,
  } as any;
  const view = new ModelFileView({ app } as any, deps);
  return { view, created, budget, loadModel, app, active, deps };
}

/** Eine geladene FileView mit aktiver Registry — analog `loadedBlock` (Task 9). */
async function makeLoadedFileView(overrides: Record<string, unknown> = {}) {
  const { view, created, active } = makeView(overrides);
  const file = fileAt("weltmodell/3d/haus.glb");
  await view.onLoadFile(file);
  // Echtes Obsidian setzt `this.file`, bevor es `onLoadFile` ruft — der Mock tut das
  // nicht, deshalb hier von Hand, sonst waere das Label immer der Fallback.
  (view as unknown as { file: TFile }).file = file;
  return { view, created, active };
}

/** Token-genau pruefen (der Mock fuehrt `className` als Token-Liste). */
function hasClass(el: any, cls: string): boolean {
  return String(el.className).split(/\s+/).includes(cls);
}

function fileAt(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.basename = path.split("/").pop() ?? path;
  f.stat = { mtime: 1, ctime: 0, size: 4 };
  return f;
}

describe("ModelFileView", () => {
  it("declares its view type and icon", () => {
    const { view } = makeView();
    expect(view.getViewType()).toBe(VIEW_TYPE_3D);
    expect(view.getIcon()).toBe("box");
  });

  it("renders the file on load without touching the budget (unmanaged)", async () => {
    const { view, loadModel, budget, created } = makeView();
    await view.onLoadFile(fileAt("weltmodell/3d/haus.glb"));

    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(budget.register).not.toHaveBeenCalled();
  });

  it("disposes the previous viewport when another file loads", async () => {
    const { view, created } = makeView();
    await view.onLoadFile(fileAt("a.glb"));
    await view.onLoadFile(fileAt("b.glb"));

    expect(created).toHaveLength(2);
    expect(created[0].dispose).toHaveBeenCalled();
  });

  it("disposes on unload", async () => {
    const { view, created } = makeView();
    await view.onLoadFile(fileAt("a.glb"));
    await view.onUnloadFile(fileAt("a.glb"));

    expect(created[0].dispose).toHaveBeenCalled();
  });
});

// Task 12: FileView-Verdrahtung des EditCoordinator -- keine Toolbar hier, die
// Sidebar ist der EINZIGE Bedienort (`controller.editPanel()`).
describe("ModelFileView edit mode wiring", () => {
  it("offers editPanel for a .gltf file, enabled once the host has loaded", async () => {
    const { view } = makeView();
    const file = fileAt("model.gltf");
    await view.onLoadFile(file);
    (view as unknown as { file: TFile }).file = file;

    const panel = view.controller.editPanel?.();
    expect(panel).toBeTruthy();
    expect(panel!.disabledReason).toBeNull();
  });

  it("disables editing for an .stl file with the format reason", async () => {
    const { view } = makeView();
    const file = fileAt("model.stl");
    await view.onLoadFile(file);
    (view as unknown as { file: TFile }).file = file;

    const panel = view.controller.editPanel?.();
    expect(panel!.disabledReason).toContain("glTF");
  });

  // Spec 2.1: der sichtbare Rahmen gehoert zu JEDEM Weg -- die FileView hat wie der
  // Embed keine Toolbar, an der er sonst mit haengen wuerde.
  it("toggles tdcb-editing on the viewport wrapper on enter and exit", async () => {
    const editFiles: Record<string, string> = { "model.gltf": contractGltfText() };
    const { view, deps } = makeView({ editIo: makeEditIo(editFiles) });
    withEditRig(deps.factory);

    const file = fileAt("model.gltf");
    await view.onLoadFile(file);
    (view as unknown as { file: TFile }).file = file;

    const viewport = (view as any).parts.viewport;
    expect(hasClass(viewport, "tdcb-editing")).toBe(false);

    await (view as any).edit.enter();
    expect(hasClass(viewport, "tdcb-editing")).toBe(true);

    (view as any).edit.exitSilently();
    expect(hasClass(viewport, "tdcb-editing")).toBe(false);
  });

  it("onUnloadFile() during an active edit ends it silently (no confirm, unpins)", async () => {
    const editFiles: Record<string, string> = { "model.gltf": contractGltfText() };
    const { view, deps } = makeView({ editIo: makeEditIo(editFiles) });
    withEditRig(deps.factory);

    const file = fileAt("model.gltf");
    await view.onLoadFile(file);
    (view as unknown as { file: TFile }).file = file;

    const edit = (view as any).edit;
    await edit.enter();
    expect(edit.active).toBe(true);

    const exitSilently = vi.spyOn(edit, "exitSilently");

    await view.onUnloadFile(file);

    expect(exitSilently).toHaveBeenCalledTimes(1);
    expect(edit.active).toBe(false);
  });

  // Finding 2 (Whole-Branch-Review): die FileView haengt jetzt im `modify`-Abo. Ohne
  // das ging der Vorzeige-Loop (Erzeuger regeneriert waehrend der Nutzer editiert) auf
  // diesem Weg dauerhaft schief -- die Session zeigte auf ein laengst ersetztes Modell.
  it("reaches reapplyAfterReload() on onFileModified() during an active edit", async () => {
    const editFiles: Record<string, string> = { "model.gltf": contractGltfText() };
    const { view, deps, app } = makeView({ editIo: makeEditIo(editFiles) });
    withEditRig(deps.factory);

    const file = fileAt("model.gltf");
    await view.onLoadFile(file);
    (view as unknown as { file: TFile }).file = file;

    const edit = (view as any).edit;
    await edit.enter();
    expect(edit.active).toBe(true);

    const reapplyAfterReload = vi.spyOn(edit, "reapplyAfterReload");
    const before = app.vault.readBinary.mock.calls.length;

    file.stat.mtime = 99;
    view.onFileModified(file);
    await view.rendering;

    expect(app.vault.readBinary.mock.calls.length).toBe(before + 1);
    expect(reapplyAfterReload).toHaveBeenCalledTimes(1);
    // Der Edit ueberlebt die Regenerierung -- nicht nur "die Methode wurde gerufen".
    expect(edit.active).toBe(true);
  });

  it("ignores a modify of another file and of the same mtime", async () => {
    const { view, app } = makeView();
    const file = fileAt("model.gltf");
    await view.onLoadFile(file);
    (view as unknown as { file: TFile }).file = file;
    const before = app.vault.readBinary.mock.calls.length;

    view.onFileModified(fileAt("andere.gltf"));
    await view.rendering;
    view.onFileModified(file); // gleiche mtime wie beim Laden
    await view.rendering;

    expect(app.vault.readBinary.mock.calls.length).toBe(before);
  });

  it("onLoadFile() for a new file ends a still-active edit from the previous file first", async () => {
    const editFiles: Record<string, string> = { "a.gltf": contractGltfText() };
    const { view, deps } = makeView({ editIo: makeEditIo(editFiles) });
    withEditRig(deps.factory);

    const fileA = fileAt("a.gltf");
    await view.onLoadFile(fileA);
    (view as unknown as { file: TFile }).file = fileA;

    const edit = (view as any).edit;
    await edit.enter();
    expect(edit.active).toBe(true);

    // Datei-Wechsel im selben Pane ist kein Reload desselben Modells -- der Edit auf
    // der ALTEN Datei darf nicht ueber den neuen Host hinweg "aktiv" bleiben.
    await view.onLoadFile(fileAt("b.gltf"));

    expect(edit.active).toBe(false);
  });
});

describe("ModelFileView as a ViewportController", () => {
  it("registers itself as the active viewport when the user interacts", async () => {
    const { view, created, active } = await makeLoadedFileView();
    created[0].opts.onInteract();
    expect(active.get()).toBe(view.controller);
    expect(active.get()?.canSave()).toBe(false);
  });

  it("clears itself from the registry on unload", async () => {
    const { view, created, active } = await makeLoadedFileView();
    created[0].opts.onInteract();
    view.onunload();
    expect(active.get()).toBeNull();
  });

  it("reports the file path as its label", async () => {
    const { view } = await makeLoadedFileView();
    expect(view.controller.label()).toBe("weltmodell/3d/haus.glb");
  });
});
