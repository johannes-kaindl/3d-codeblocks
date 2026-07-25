import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp } from "../__mocks__/obsidian";
import { ModelFileView, VIEW_TYPE_3D } from "../../src/obsidian/file-view";
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

function makeView() {
  const created: any[] = [];
  const loadModel = vi.fn().mockResolvedValue({});
  const app = makeFakeApp();
  app.vault.readBinary = vi.fn().mockResolvedValue(makeGlb());
  const budget = { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() };
  const view = new ModelFileView({ app } as any, {
    settings: () => DEFAULT_SETTINGS,
    factory: {
      isWebGLAvailable: () => true,
      create: () => {
        const vp = {
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
    budget,
    loadModel,
    readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
  } as any);
  return { view, created, budget, loadModel, app };
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
