import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "../__mocks__/obsidian";
import { GltfBlock } from "../../src/obsidian/gltf-block";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import { ActiveViewport } from "../../src/core/active-viewport";

function makeDeps() {
  const created: any[] = [];
  const loadModel = vi.fn().mockResolvedValue({});
  const budget = { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() };
  const active = new ActiveViewport();
  return {
    created,
    loadModel,
    budget,
    active,
    deps: {
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
      budget,
      loadModel,
      readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
      active,
    } as any,
  };
}

const VALID_GLTF = JSON.stringify({ asset: { version: "2.0" }, scenes: [], nodes: [] });

describe("GltfBlock", () => {
  it("renders valid glTF JSON", async () => {
    const { deps, loadModel } = makeDeps();
    const el = makeFakeEl();
    const block = new GltfBlock(el, VALID_GLTF, deps);

    block.onload();
    await block.rendering;

    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(loadModel.mock.calls[0][1]).toBe("gltf");
  });

  it("shows a clear error for broken JSON and builds no viewport", async () => {
    const { deps, created, loadModel } = makeDeps();
    const el = makeFakeEl();
    const block = new GltfBlock(el, "{ not json }", deps);

    block.onload();
    await block.rendering;

    expect(loadModel).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("The glTF code is not valid JSON.");
  });

  it("disposes on unload", async () => {
    const { deps, created } = makeDeps();
    const el = makeFakeEl();
    const block = new GltfBlock(el, VALID_GLTF, deps);

    block.onload();
    await block.rendering;
    block.onunload();

    expect(created[0].dispose).toHaveBeenCalled();
  });

  // Regressionstest fuer Finding 5 (Whole-Branch-Review 2026-07-25): ein `gltf`-Block
  // stand komplett ausserhalb der Aktiv-Verdrahtung -- Interaktion hier liess Sidebar/
  // Toolbar/Befehle weiter auf das zuletzt aktive ANDERE Modell zeigen.
  describe("active-viewport wiring", () => {
    it("becomes the active viewport when the user interacts", async () => {
      const { deps, created, active } = makeDeps();
      const block = new GltfBlock(makeFakeEl(), VALID_GLTF, deps);

      block.onload();
      await block.rendering;
      created[0].opts.onInteract();

      expect(active.get()).toBe(block.controller);
    });

    it("is honestly read-only -- cannot save, even after interaction", async () => {
      const { deps } = makeDeps();
      const block = new GltfBlock(makeFakeEl(), VALID_GLTF, deps);

      block.onload();
      await block.rendering;

      expect(block.controller.canSave()).toBe(false);
    });

    it("clears itself from the registry on unload", async () => {
      const { deps, created, active } = makeDeps();
      const block = new GltfBlock(makeFakeEl(), VALID_GLTF, deps);

      block.onload();
      await block.rendering;
      created[0].opts.onInteract();
      block.onunload();

      expect(active.get()).toBeNull();
    });
  });
});
