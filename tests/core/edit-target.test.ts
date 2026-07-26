import { describe, expect, it } from "vitest";
import { editFormatFor, editTargetPath } from "../../src/core/edit-target";

describe("editTargetPath", () => {
  it("leitet die Nachbar-Datei ab: eg.gltf → eg.edit.gltf", () => {
    expect(editTargetPath("weltmodell/3d/eg.gltf")).toEqual({
      path: "weltmodell/3d/eg.edit.gltf",
      inPlace: false,
    });
  });

  it("behaelt die Endung: haus.glb → haus.edit.glb", () => {
    expect(editTargetPath("haus.glb")).toEqual({ path: "haus.edit.glb", inPlace: false });
  });

  it("Edit-Datei selbst → in-place (kein eg.edit.edit.gltf)", () => {
    expect(editTargetPath("weltmodell/3d/eg.edit.gltf")).toEqual({
      path: "weltmodell/3d/eg.edit.gltf",
      inPlace: true,
    });
  });

  it("STL und Unbekanntes sind nicht editierbar", () => {
    expect(editTargetPath("teil.stl")).toBeNull();
    expect(editTargetPath("bild.png")).toBeNull();
  });
});

describe("editFormatFor", () => {
  it("unterscheidet JSON-glTF und GLB, case-insensitiv", () => {
    expect(editFormatFor("eg.gltf")).toBe("gltf-json");
    expect(editFormatFor("HAUS.GLB")).toBe("glb");
    expect(editFormatFor("teil.stl")).toBeNull();
  });
});
