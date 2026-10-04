import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "../__mocks__/obsidian";
import { GltfBlock } from "../../src/obsidian/gltf-block";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import { ActiveViewport } from "../../src/core/active-viewport";

function findAll(el: any, pred: (e: any) => boolean, out: any[] = []): any[] {
  if (pred(el)) out.push(el);
  for (const c of el.children ?? []) findAll(c, pred, out);
  return out;
}
const bars = (el: any) => findAll(el, (e) => e.className === "tdcb-toolbar");
const barLabels = (el: any) => bars(el).flatMap((b) => b.children.map((x: any) => x.getAttribute("aria-label")));

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

describe("GltfBlock in shapes mode", () => {
  it("renders shapes text through the glTF path", async () => {
    const { deps, loadModel } = makeDeps();
    const el = makeFakeEl();
    const block = new GltfBlock(el, "box A size 1", deps, "shapes");
    block.onload();
    await block.rendering;
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(loadModel.mock.calls[0][1]).toBe("gltf");
  });

  it("does not run the JSON check on shapes text", async () => {
    const { deps } = makeDeps();
    const el = makeFakeEl();
    const block = new GltfBlock(el, "sphere K size 1", deps, "shapes");
    block.onload();
    await block.rendering;
    expect(JSON.stringify(el.children)).not.toContain("not valid JSON");
  });

  it("applies title and height from the header", async () => {
    const { deps } = makeDeps();
    const el = makeFakeEl();
    const block = new GltfBlock(el, "title: Tisch\nheight: 321\nbox A size 1", deps, "shapes");
    block.onload();
    await block.rendering;
    const dump = JSON.stringify(el.children);
    expect(dump).toContain("Tisch");
    expect(dump).toContain("321");
  });

  it("renders an EMPTY shapes block as the empty-state, never blank and never the error box", async () => {
    const { deps, created } = makeDeps();
    const el = makeFakeEl();
    const block = new GltfBlock(el, "", deps, "shapes");
    block.onload();
    await block.rendering;
    const dump = JSON.stringify(el.children);
    expect(created).toHaveLength(0);
    expect(dump).toContain("tdcb-empty");
    expect(dump).toContain("Write one part per line");
    expect(dump).not.toContain("tdcb-message-error");
  });

  it("labels itself as a shapes block", () => {
    const { deps } = makeDeps();
    const block = new GltfBlock(makeFakeEl(), "box A size 1", deps, "shapes");
    expect(block.controller.label()).toBe("shapes code block");
  });

  describe("shapes target and action bar", () => {
    const SRC = "title: Tisch\nbox A size 1";

    it("reports the block as target with the CURRENT section info, read at click time", () => {
      const { deps } = makeDeps();
      let info: { lineStart: number; lineEnd: number } | null = { lineStart: 2, lineEnd: 5 };
      const block = new GltfBlock(makeFakeEl(), SRC, { ...deps, sourcePath: "n.md", sectionInfo: () => info }, "shapes");
      expect(block.controller.shapesTarget?.()).toEqual({ kind: "shapes-block", path: "n.md", lineStart: 2, lineEnd: 5, label: "Tisch", body: SRC });
      info = { lineStart: 7, lineEnd: 10 };
      expect(block.controller.shapesTarget?.()).toEqual({ kind: "shapes-block", path: "n.md", lineStart: 7, lineEnd: 10, label: "Tisch", body: SRC });
    });

    it("labels an untitled shapes block 'shapes code block'", () => {
      const { deps } = makeDeps();
      const block = new GltfBlock(makeFakeEl(), "box A size 1", { ...deps, sourcePath: "n.md", sectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) }, "shapes");
      expect(block.controller.shapesTarget?.()).toMatchObject({ label: "shapes code block" });
    });

    it("gltf blocks have no shapesTarget", () => {
      const { deps } = makeDeps();
      const block = new GltfBlock(makeFakeEl(), VALID_GLTF, { ...deps, sourcePath: "n.md", sectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) });
      expect(block.controller.shapesTarget).toBeUndefined();
      expect(Object.keys(block.controller)).not.toContain("shapesTarget");
    });

    it("target is null without section info or without a source path", () => {
      const { deps } = makeDeps();
      const noInfo = new GltfBlock(makeFakeEl(), SRC, { ...deps, sourcePath: "n.md", sectionInfo: () => null }, "shapes");
      expect(noInfo.controller.shapesTarget?.()).toBeNull();
      const noPath = new GltfBlock(makeFakeEl(), SRC, { ...deps, sectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) }, "shapes");
      expect(noPath.controller.shapesTarget?.()).toBeNull();
    });

    it("builds the action bar with both buttons and opens the panel with the current target", () => {
      const { deps } = makeDeps();
      const el = makeFakeEl();
      const openInPanel = vi.fn();
      const moveToFile = vi.fn();
      let info = { lineStart: 2, lineEnd: 5 };
      const block = new GltfBlock(el, SRC, { ...deps, sourcePath: "n.md", sectionInfo: () => info, openInPanel, moveToFile }, "shapes");
      block.onload();
      expect(barLabels(el)).toEqual(["Edit in prompt panel", "Move into a .shapes file"]);
      const [edit, move] = bars(el)[0].children;
      expect(edit.dataset.icon).toBe("sparkles");
      expect(move.dataset.icon).toBe("file-output");
      info = { lineStart: 9, lineEnd: 12 };
      edit.click();
      expect(openInPanel).toHaveBeenCalledWith({ kind: "shapes-block", path: "n.md", lineStart: 9, lineEnd: 12, label: "Tisch", body: SRC });
      move.click();
      expect(moveToFile).toHaveBeenCalledTimes(1);
    });

    it("shows no action bar when there is no section info (embed, popover)", () => {
      const { deps } = makeDeps();
      const el = makeFakeEl();
      const block = new GltfBlock(el, SRC, { ...deps, sourcePath: "n.md", sectionInfo: () => null, openInPanel: vi.fn(), moveToFile: vi.fn() }, "shapes");
      block.onload();
      expect(bars(el)).toHaveLength(0);
    });

    it("shows no bar without openInPanel, and no bar at all for gltf blocks", () => {
      const { deps } = makeDeps();
      const a = makeFakeEl();
      new GltfBlock(a, SRC, { ...deps, sourcePath: "n.md", sectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) }, "shapes").onload();
      expect(bars(a)).toHaveLength(0);
      const b = makeFakeEl();
      new GltfBlock(b, VALID_GLTF, { ...deps, sourcePath: "n.md", sectionInfo: () => ({ lineStart: 0, lineEnd: 2 }), openInPanel: vi.fn() }).onload();
      expect(bars(b)).toHaveLength(0);
    });

    it("omits the move button when moveToFile is not provided", () => {
      const { deps } = makeDeps();
      const el = makeFakeEl();
      new GltfBlock(el, SRC, { ...deps, sourcePath: "n.md", sectionInfo: () => ({ lineStart: 0, lineEnd: 2 }), openInPanel: vi.fn() }, "shapes").onload();
      expect(barLabels(el)).toEqual(["Edit in prompt panel"]);
    });
  });
});
