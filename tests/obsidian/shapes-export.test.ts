import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { exportShapesAsGltf } from "../../src/obsidian/shapes-export";

function fakeApp(opts: { existing?: boolean; activeShapes?: boolean }) {
  const created: [string, string][] = [];
  const modified: string[] = [];
  const existing = Object.assign(new TFile(), { path: "Anhänge/Tisch.gltf" });
  const shapesFile = Object.assign(new TFile(), { path: "Modelle/tisch.shapes", basename: "tisch", extension: "shapes" });
  const app = {
    workspace: {
      getActiveViewOfType: () => null,
      getActiveFile: () => (opts.activeShapes ? shapesFile : null),
    },
    vault: {
      read: vi.fn(async () => "title: Tisch\nbox A size 1"),
      create: vi.fn(async (path: string, data: string) => { created.push([path, data]); }),
      modify: vi.fn(async (file: TFile) => { modified.push(file.path); }),
      getAbstractFileByPath: (path: string) => (opts.existing && path === "Anhänge/Tisch.gltf" ? existing : null),
    },
    fileManager: {
      getAvailablePathForAttachment: vi.fn(async (name: string) => (opts.existing ? "Anhänge/Tisch 1.gltf" : `Anhänge/${name}`)),
    },
  };
  return { app, created, modified };
}

describe("exportShapesAsGltf", () => {
  it("exports the active .shapes file next to the attachments", async () => {
    const { app, created } = fakeApp({ activeShapes: true });
    await exportShapesAsGltf(app as never, async () => true);
    expect(created).toHaveLength(1);
    expect(created[0][0]).toBe("Anhänge/Tisch.gltf");
    expect(JSON.parse(created[0][1]).asset.extras.generatedFrom).toBe("Modelle/tisch.shapes");
  });

  it("asks before overwriting and overwrites in place on yes", async () => {
    const { app, created, modified } = fakeApp({ activeShapes: true, existing: true });
    const confirm = vi.fn(async () => true);
    await exportShapesAsGltf(app as never, confirm);
    expect(confirm).toHaveBeenCalledWith("Overwrite Anhänge/Tisch.gltf?");
    expect(modified).toEqual(["Anhänge/Tisch.gltf"]);
    expect(created).toEqual([]);
  });

  it("writes nothing when the overwrite is declined", async () => {
    const { app, created, modified } = fakeApp({ activeShapes: true, existing: true });
    await exportShapesAsGltf(app as never, async () => false);
    expect(created).toEqual([]);
    expect(modified).toEqual([]);
  });

  it("writes nothing without a shapes source", async () => {
    const { app, created } = fakeApp({});
    await exportShapesAsGltf(app as never, async () => true);
    expect(created).toEqual([]);
  });
});
