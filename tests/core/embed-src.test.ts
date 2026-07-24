import { describe, expect, it } from "vitest";
import { matchModelEmbed, parseEmbedSrc } from "../../src/core/embed-src";

describe("parseEmbedSrc", () => {
  it("returns the plain path when there is no pipe", () => {
    expect(parseEmbedSrc("weltmodell/3d/eg.gltf")).toEqual({ path: "weltmodell/3d/eg.gltf" });
  });

  it("reads a height after the pipe", () => {
    expect(parseEmbedSrc("a.gltf|400")).toEqual({ path: "a.gltf", height: 400 });
  });

  it("ignores a non-numeric value after the pipe", () => {
    expect(parseEmbedSrc("a.gltf|wide")).toEqual({ path: "a.gltf" });
  });

  it("ignores a non-positive height", () => {
    expect(parseEmbedSrc("a.gltf|0")).toEqual({ path: "a.gltf" });
  });

  it("trims whitespace around path and height", () => {
    expect(parseEmbedSrc("  a.gltf | 300 ")).toEqual({ path: "a.gltf", height: 300 });
  });

  it("keeps a path that itself contains no extension issue", () => {
    expect(parseEmbedSrc("dir/sub/model.glb")).toEqual({ path: "dir/sub/model.glb" });
  });
});

describe("matchModelEmbed", () => {
  it("claims a 3d file embed with its height", () => {
    expect(matchModelEmbed("weltmodell/3d/eg.gltf|300")).toEqual({
      path: "weltmodell/3d/eg.gltf",
      height: 300,
    });
  });

  it("claims .glb and .stl", () => {
    expect(matchModelEmbed("a.glb")).toEqual({ path: "a.glb" });
    expect(matchModelEmbed("a.stl")).toEqual({ path: "a.stl" });
  });

  it("is case-insensitive on the extension", () => {
    expect(matchModelEmbed("A.GLTF")).toEqual({ path: "A.GLTF" });
  });

  it("ignores non-3d embeds so Obsidian handles them", () => {
    expect(matchModelEmbed("picture.png")).toBeNull();
    expect(matchModelEmbed("note.md")).toBeNull();
    expect(matchModelEmbed("doc.pdf")).toBeNull();
  });
});
