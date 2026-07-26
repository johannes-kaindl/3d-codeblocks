import { describe, expect, it } from "vitest";
import type { Object3D } from "three";
import { loadModel } from "../../src/viewer/loaders";
import { contractGltfText } from "../helpers/contract-gltf";

describe("loadModel (gltf)", () => {
  it("annotiert jeden Node mit seinem JSON-Index (tdcbNodeIndex)", async () => {
    const bytes = new TextEncoder().encode(contractGltfText()).buffer as ArrayBuffer;
    const scene = (await loadModel(bytes, "gltf", "#888888")) as Object3D;

    const indexOf = (name: string) => {
      let found: number | undefined;
      scene.traverse((child) => {
        if (child.name === name) found = child.userData.tdcbNodeIndex as number;
      });
      return found;
    };

    expect(indexOf("privat-herd")).toBe(0);
    expect(indexOf("privat-herd__dome")).toBe(1);
    expect(indexOf("env__gelaende")).toBe(3);
  });
});
