import { describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { TFile, TFolder } from "obsidian";
import { exportShapesAsGltf } from "../../src/obsidian/shapes-export";

function fakeApp(opts: { existing?: boolean; activeShapes?: boolean; folderAtWanted?: boolean; caseVariant?: boolean; createThrows?: boolean }) {
  const created: [string, string][] = [];
  const modified: string[] = [];
  const existing = Object.assign(new TFile(), { path: "Anhänge/Tisch.gltf" });
  const shapesFile = Object.assign(new TFile(), { path: "Modelle/tisch.shapes", basename: "tisch", extension: "shapes" });
  const variant = Object.assign(new TFile(), { path: "Anhänge/tisch.gltf" });
  const folder = Object.assign(new TFolder(), { path: "Anhänge/Tisch.gltf" });
  const numbered = opts.existing || opts.folderAtWanted || opts.caseVariant;
  const app = {
    workspace: {
      getActiveViewOfType: () => null,
      getActiveFile: () => (opts.activeShapes ? shapesFile : null),
    },
    vault: {
      read: vi.fn(async () => "title: Tisch\nbox A size 1"),
      create: vi.fn(async (path: string, data: string) => {
        if (opts.createThrows) throw new Error("disk full");
        created.push([path, data]);
      }),
      getFiles: () => (opts.caseVariant ? [variant] : []),
      modify: vi.fn(async (file: TFile) => { modified.push(file.path); }),
      getAbstractFileByPath: (path: string) => {
        if (path !== "Anhänge/Tisch.gltf") return null;
        if (opts.existing) return existing;
        return opts.folderAtWanted ? folder : null;
      },
    },
    fileManager: {
      getAvailablePathForAttachment: vi.fn(async (name: string) => (numbered ? "Anhänge/Tisch 1.gltf" : `Anhänge/${name}`)),
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

  function captureNotices() {
    const notices: string[] = [];
    const spy = vi.spyOn(obsidian, "Notice").mockImplementation(((message: string) => {
      notices.push(message);
    }) as any);
    return { notices, spy };
  }

  it("never creates a numbered file when a folder sits at the target name", async () => {
    const { app, created, modified } = fakeApp({ activeShapes: true, folderAtWanted: true });
    const { notices, spy } = captureNotices();
    await exportShapesAsGltf(app as never, async () => true);
    spy.mockRestore();
    expect(created).toEqual([]);
    expect(modified).toEqual([]);
    expect(notices.join(" ")).toMatch(/folder/i);
  });

  it("treats a file differing only in case as existing: asks, then modifies in place", async () => {
    const { app, created, modified } = fakeApp({ activeShapes: true, caseVariant: true });
    const confirm = vi.fn(async () => false);
    await exportShapesAsGltf(app as never, confirm);
    expect(confirm).toHaveBeenCalledWith("Overwrite Anhänge/tisch.gltf?");
    expect(created).toEqual([]);
    expect(modified).toEqual([]);

    const accepted = fakeApp({ activeShapes: true, caseVariant: true });
    await exportShapesAsGltf(accepted.app as never, async () => true);
    expect(accepted.created).toEqual([]);
    expect(accepted.modified).toEqual(["Anhänge/tisch.gltf"]);
  });

  it("stops instead of creating a numbered file when the name is taken but unfindable", async () => {
    const { app, created } = fakeApp({ activeShapes: true, existing: true });
    app.vault.getAbstractFileByPath = () => null;
    const { spy } = captureNotices();
    await exportShapesAsGltf(app as never, async () => true);
    spy.mockRestore();
    expect(created).toEqual([]);
  });

  it("shows a notice instead of an unhandled rejection when writing fails", async () => {
    const { app } = fakeApp({ activeShapes: true, createThrows: true });
    const { notices, spy } = captureNotices();
    await expect(exportShapesAsGltf(app as never, async () => true)).resolves.toBeUndefined();
    spy.mockRestore();
    expect(notices.join(" ")).toContain("disk full");
  });
});
