import { describe, expect, it } from "vitest";
import { toViewModel } from "../../src/core/view-model";

describe("toViewModel", () => {
  it("shows nothing when ready", () => {
    expect(toViewModel({ kind: "ready" })).toEqual({
      message: null,
      tone: null,
      showReloadButton: false,
      showSpinner: false,
    });
  });

  it("shows a spinner while loading", () => {
    const vm = toViewModel({ kind: "loading" });
    expect(vm.showSpinner).toBe(true);
    expect(vm.message).toBeNull();
  });

  it("shows nothing for a poster", () => {
    expect(toViewModel({ kind: "poster" }).message).toBeNull();
  });

  it("joins config errors", () => {
    const vm = toViewModel({ kind: "config-error", messages: ["No `file:` given."] });
    expect(vm.message).toBe("No `file:` given.");
    expect(vm.tone).toBe("error");
  });

  it("names the path it looked for", () => {
    const vm = toViewModel({ kind: "missing-file", path: "weltmodell/3d/eg.glb" });
    expect(vm.message).toBe("File not found: weltmodell/3d/eg.glb");
    expect(vm.tone).toBe("error");
  });

  it("lists the supported extensions on an unsupported format", () => {
    const vm = toViewModel({ kind: "unsupported-format", path: "a/b.obj" });
    expect(vm.message).toBe("Unsupported format: a/b.obj (supported: .glb, .gltf, .stl)");
  });

  it("explains why compressed glTF cannot work", () => {
    const vm = toViewModel({
      kind: "compressed-gltf",
      extensions: ["KHR_draco_mesh_compression"],
    });
    expect(vm.message).toBe(
      "Compressed glTF is not supported (Obsidian does not allow web workers). Please export uncompressed. Required: KHR_draco_mesh_compression",
    );
  });

  it("reports an invalid file", () => {
    expect(toViewModel({ kind: "invalid-file" }).message).toBe(
      "The file is damaged or not a valid GLB.",
    );
  });

  it("reports missing WebGL", () => {
    expect(toViewModel({ kind: "no-webgl" }).message).toBe(
      "WebGL is unavailable, so the 3D view cannot be shown.",
    );
  });

  it("offers a reload button after a lost context", () => {
    const vm = toViewModel({ kind: "context-lost" });
    expect(vm.message).toBe("The 3D context was lost.");
    expect(vm.showReloadButton).toBe(true);
  });

  it("includes the detail of a load failure", () => {
    const vm = toViewModel({ kind: "load-failed", detail: "unexpected token" });
    expect(vm.message).toBe("Could not load the model: unexpected token");
    expect(vm.showReloadButton).toBe(true);
  });
});
