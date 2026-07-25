import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp, makeFakeEl } from "../__mocks__/obsidian";
import { ModelEmbed, registerModelEmbeds } from "../../src/obsidian/embed";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import { ActiveViewport } from "../../src/core/active-viewport";

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

    const stage = el.children[0].children.find((c: any) =>
      String(c.className).includes("tdcb-stage"),
    );
    expect(stage.style.height).toBe("250px");
  });

  it("uses the default height when no dimension is given", async () => {
    const { deps } = makeDeps();
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, fileAt("a.gltf"), deps);
    embed.loadFile();
    await embed.rendering;

    const stage = el.children[0].children.find((c: any) =>
      String(c.className).includes("tdcb-stage"),
    );
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
