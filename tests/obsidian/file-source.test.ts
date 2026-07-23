import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp } from "../__mocks__/obsidian";
import { readModel, resolveModelPath } from "../../src/obsidian/file-source";

function fileAt(path: string, mtime = 100): TFile {
  const f = new TFile();
  f.path = path;
  f.extension = path.split(".").pop() ?? "";
  f.stat = { mtime, ctime: 0, size: 10 };
  return f;
}

describe("resolveModelPath", () => {
  it("resolves via the metadata cache, like a wikilink", () => {
    const app = makeFakeApp();
    const target = fileAt("weltmodell/3d/eg.glb");
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(target);

    const found = resolveModelPath(app, "weltmodell/3d/eg.glb", "notes/world.md");

    expect(found).toBe(target);
    expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
      "weltmodell/3d/eg.glb",
      "notes/world.md",
    );
  });

  it("returns null when nothing matches", () => {
    const app = makeFakeApp();
    expect(resolveModelPath(app, "nope.glb", "notes/world.md")).toBeNull();
  });

  it("strips wrapping brackets from a wikilink-style path", () => {
    const app = makeFakeApp();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(fileAt("a.glb"));

    resolveModelPath(app, "[[a.glb]]", "notes/world.md");

    expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("a.glb", "notes/world.md");
  });
});

describe("readModel", () => {
  it("returns the binary data together with the mtime", async () => {
    const app = makeFakeApp();
    const file = fileAt("a.glb", 4242);
    const buffer = new ArrayBuffer(8);
    app.vault.readBinary = vi.fn().mockResolvedValue(buffer);

    const result = await readModel(app, file);

    expect(result).toEqual({ file, data: buffer, mtime: 4242 });
    expect(app.vault.readBinary).toHaveBeenCalledWith(file);
  });
});
