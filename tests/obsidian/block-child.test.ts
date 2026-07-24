import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp, makeFakeEl } from "../__mocks__/obsidian";
import { ModelBlock } from "../../src/obsidian/block-child";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";

function makeFactory() {
  const created: any[] = [];
  const factory = {
    isWebGLAvailable: () => true,
    create: (opts: any) => {
      const vp = {
        opts,
        disposed: 0,
        setModel: vi.fn(),
        setColors: vi.fn(),
        resize: vi.fn(),
        resetCamera: vi.fn(),
        capturePoster: () => "data:image/png;base64,AAA",
        dispose() {
          vp.disposed += 1;
        },
      };
      created.push(vp);
      return vp;
    },
  };
  return { factory, created };
}

function makeBudget() {
  return { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() };
}

function glbFile(path = "a.glb", mtime = 1): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = { mtime, ctime: 0, size: 4 };
  return f;
}

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const { factory, created } = makeFactory();
  const app = makeFakeApp();
  const budget = makeBudget();
  // Standardinhalt ist ein gueltiger, unkomprimierter GLB — sonst bricht jeder Test
  // schon an der Container-Pruefung ab, statt den Lebenszyklus zu erreichen.
  app.vault.readBinary = vi.fn().mockResolvedValue(makeGlb({ asset: { version: "2.0" } }));
  return {
    created,
    budget,
    app,
    deps: {
      app,
      settings: () => DEFAULT_SETTINGS,
      factory,
      budget,
      loadModel: vi.fn().mockResolvedValue({}),
      readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
      ...overrides,
    } as any,
  };
}

describe("ModelBlock", () => {
  it("shows a config error and never builds a viewport", () => {
    const { deps, created } = makeDeps();
    const el = makeFakeEl();

    const block = new ModelBlock(el, "height: 300", "note.md", deps);
    block.onload();

    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("No `file:` given.");
  });

  it("reports a missing file with the path it looked for", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(null);
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: missing.glb", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("File not found: missing.glb");
  });

  it("rejects an unsupported extension before touching the vault", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile("model.obj"));
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: model.obj", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("Unsupported format: model.obj");
    expect(app.vault.readBinary).not.toHaveBeenCalled();
  });

  it("disposes the viewport when Obsidian unloads the block", async () => {
    const { deps, app, created } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());

    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();
    block.onunload();

    expect(created).toHaveLength(1);
    expect(created[0].disposed).toBe(1);
  });

  it("unregisters from the context budget on unload", async () => {
    const { deps, app, budget } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());

    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();
    block.onunload();

    expect(budget.unregister).toHaveBeenCalled();
  });

  it("reloads when its own file is modified", async () => {
    const { deps, app } = makeDeps();
    const file = glbFile();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(file);

    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();
    const before = app.vault.readBinary.mock.calls.length;
    file.stat.mtime = 999;
    await block.onFileModified(file);

    expect(app.vault.readBinary.mock.calls.length).toBe(before + 1);
  });

  it("ignores a modification of a different file", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());

    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();
    const before = app.vault.readBinary.mock.calls.length;
    await block.onFileModified(glbFile("other.glb"));

    expect(app.vault.readBinary.mock.calls.length).toBe(before);
  });

  it("reports missing WebGL instead of building a viewport", async () => {
    const { deps, app, created } = makeDeps();
    deps.factory.isWebGLAvailable = () => false;
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("WebGL is unavailable");
  });

  it("refuses a compressed glTF with the real reason", async () => {
    const { deps, app, created } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    app.vault.readBinary = vi.fn().mockResolvedValue(makeDracoGlb());
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("Compressed glTF is not supported");
  });

  it("shows the warnings from the config below the viewport", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: a.glb\nheigth: 400", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("Unknown key: `heigth`");
  });
});

function makeDracoGlb(): ArrayBuffer {
  return makeGlb({ extensionsRequired: ["KHR_draco_mesh_compression"] });
}

function makeGlb(json: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
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
