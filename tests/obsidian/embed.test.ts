import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp, makeFakeEl } from "../__mocks__/obsidian";
import { ModelEmbed, registerModelEmbeds } from "../../src/obsidian/embed";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";

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

function makeDeps() {
  const created: any[] = [];
  const app = makeFakeApp();
  app.vault.readBinary = vi.fn().mockResolvedValue(makeGlb());
  const loadModel = vi.fn().mockResolvedValue({});
  return {
    app,
    created,
    loadModel,
    deps: {
      app,
      settings: () => DEFAULT_SETTINGS,
      factory: {
        isWebGLAvailable: () => true,
        create: () => {
          const vp = {
            setModel: vi.fn(),
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
    } as any,
  };
}

function fileAt(path: string, mtime = 1): TFile {
  const f = new TFile();
  f.path = path;
  f.basename = path.split("/").pop() ?? path;
  f.stat = { mtime, ctime: 0, size: 4 };
  return f;
}

describe("ModelEmbed", () => {
  it("renders the resolved file via loadFile", async () => {
    const { deps, loadModel } = makeDeps();
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, deps);
    await embed.loadFile(fileAt("weltmodell/3d/eg.gltf"));

    expect(loadModel).toHaveBeenCalledTimes(1);
  });

  it("uses the alt height for the stage", async () => {
    const { deps } = makeDeps();
    const el = makeFakeEl();
    el.setAttribute("alt", "250");

    const embed = new ModelEmbed(el, deps);
    await embed.loadFile(fileAt("a.gltf"));

    const stage = el.children[0].children.find((c: any) =>
      String(c.className).includes("tdcb-stage"),
    );
    expect(stage.style.height).toBe("250px");
  });

  it("reloads on a modify of the same file", async () => {
    const { deps, app } = makeDeps();
    const el = makeFakeEl();
    const file = fileAt("a.gltf", 1);

    const embed = new ModelEmbed(el, deps);
    await embed.loadFile(file);
    const before = app.vault.readBinary.mock.calls.length;

    file.stat.mtime = 99;
    embed.onFileModified(file);
    await embed.rendering;

    expect(app.vault.readBinary.mock.calls.length).toBe(before + 1);
  });

  it("disposes on unload", async () => {
    const { deps, created } = makeDeps();
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, deps);
    await embed.loadFile(fileAt("a.gltf"));
    embed.onunload();

    expect(created[0].dispose).toHaveBeenCalled();
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
