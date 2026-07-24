import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp, makeFakeEl } from "../__mocks__/obsidian";
import { ModelEmbed } from "../../src/obsidian/embed";
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

function fileAt(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = { mtime: 1, ctime: 0, size: 4 };
  return f;
}

describe("ModelEmbed", () => {
  it("renders the embedded file", async () => {
    const { deps, app, loadModel } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(fileAt("a.gltf"));
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, { path: "a.gltf" }, "note.md", deps);
    embed.onload();
    await embed.rendering;

    expect(loadModel).toHaveBeenCalledTimes(1);
  });

  it("reports a missing embedded file", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(null);
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, { path: "gone.gltf" }, "note.md", deps);
    embed.onload();
    await embed.rendering;

    expect(JSON.stringify(el.children)).toContain("File not found: gone.gltf");
  });

  it("uses the embed height for the stage", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(fileAt("a.gltf"));
    const el = makeFakeEl();

    const embed = new ModelEmbed(el, { path: "a.gltf", height: 250 }, "note.md", deps);
    embed.onload();
    await embed.rendering;

    const stage = el.children[0].children.find((c: any) =>
      String(c.className).includes("tdcb-stage"),
    );
    expect(stage.style.height).toBe("250px");
  });
});
