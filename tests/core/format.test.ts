import { describe, expect, it } from "vitest";
import { SUPPORTED_EXTENSIONS, detectFormat } from "../../src/core/format";

describe("detectFormat", () => {
  it("maps .glb and .gltf to gltf", () => {
    expect(detectFormat("a/b.glb")).toBe("gltf");
    expect(detectFormat("a/b.gltf")).toBe("gltf");
  });

  it("maps .stl to stl", () => {
    expect(detectFormat("a/b.stl")).toBe("stl");
  });

  it("maps the print and exchange formats", () => {
    expect(detectFormat("druck/teil.3mf")).toBe("3mf");
    expect(detectFormat("druck/teil.OBJ")).toBe("obj");
    expect(detectFormat("scan/raum.ply")).toBe("ply");
    expect(detectFormat("druck/teil.gcode")).toBe("gcode");
    expect(detectFormat("scan/wolke.xyz")).toBe("xyz");
    expect(detectFormat("scan/wolke.pcd")).toBe("pcd");
  });

  it("ignores case", () => {
    expect(detectFormat("A/B.GLB")).toBe("gltf");
  });

  it("uses the last dot, not the first", () => {
    expect(detectFormat("weltmodell/3d/eg.v2.glb")).toBe("gltf");
  });

  it("returns null for unknown or missing extensions", () => {
    expect(detectFormat("a/b.fbx")).toBeNull();
    expect(detectFormat("a/b")).toBeNull();
    expect(detectFormat("")).toBeNull();
  });

  it("does not treat a dot in a folder name as an extension", () => {
    expect(detectFormat("v1.0/model")).toBeNull();
  });

  it("knows .shapes", () => {
    expect(detectFormat("Möbel/tisch.shapes")).toBe("shapes");
    expect(detectFormat("TISCH.SHAPES")).toBe("shapes");
  });

  it("lists every supported extension", () => {
    expect(SUPPORTED_EXTENSIONS).toEqual([".glb", ".gltf", ".stl", ".3mf", ".obj", ".ply", ".gcode", ".xyz", ".pcd", ".shapes"]);
  });
});
