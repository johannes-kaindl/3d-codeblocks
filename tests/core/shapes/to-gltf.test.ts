import { describe, expect, it } from "vitest";
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { shapesToGltf } from "../../../src/core/shapes/to-gltf";
import { loadModel } from "../../../src/viewer/loaders";
import type { ShapeDraft } from "../../../src/core/shapes/types";

const TABLE: ShapeDraft[] = [
  { kind: "box", name: "Platte", size: [1.2, 0.05, 0.7], at: [0, 0.725, 0], rot: [0, 0, 0], color: "#8b5a2b" },
  { kind: "cylinder", name: "Bein-1", size: [0.03, 0.7], at: [-0.55, 0.35, -0.3], rot: [0, 0, 0], color: null },
  { kind: "cone", name: "Hut", size: [0.2, 0.3], at: [0, 1, 0], rot: [0, 0, 90], color: null },
];

async function load(parts: ShapeDraft[]) {
  const doc = shapesToGltf(parts, { generatedFrom: "test" });
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).buffer as ArrayBuffer;
  return { doc, scene: (await loadModel(bytes, "gltf", "#888888")).object };
}

describe("shapesToGltf", () => {
  it("loads with three's GLTFLoader, one named mesh per part", async () => {
    const { scene } = await load(TABLE);
    const names: string[] = [];
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) names.push(o.name);
    });
    expect(names).toEqual(["Platte", "Bein-1", "Hut"]);
  });

  it("places parts by their centre", async () => {
    const { scene } = await load([TABLE[0]]);
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(scene);
    expect(box.getCenter(new Vector3()).y).toBeCloseTo(0.725, 4);
    expect(box.getSize(new Vector3()).x).toBeCloseTo(1.2, 4);
  });

  it("converts the sRGB hex colour to linear baseColorFactor", async () => {
    const { scene } = await load([{ ...TABLE[0], color: "#ffffff" }, { ...TABLE[1], color: "#808080" }]);
    const colors: number[] = [];
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) colors.push(((o as Mesh).material as MeshStandardMaterial).color.r);
    });
    expect(colors[0]).toBeCloseTo(1, 4);
    expect(colors[1]).toBeCloseTo(0.2158605, 4);
  });

  it("marks itself as derived and carries no translation/rotation for defaults", () => {
    const doc = shapesToGltf([{ kind: "sphere", name: "K", size: [1], at: [0, 0, 0], rot: [0, 0, 0], color: null }], { generatedFrom: "a.shapes" });
    const asset = doc.asset as { version: string; generator: string; extras: Record<string, unknown> };
    expect(asset.version).toBe("2.0");
    expect(asset.generator).toBe("3D Codeblocks shapes");
    expect(asset.extras).toEqual({ generatedFrom: "a.shapes" });
    const node = (doc.nodes as Record<string, unknown>[])[0];
    expect(node.translation).toBeUndefined();
    expect(node.rotation).toBeUndefined();
  });

  it("declares POSITION min/max over the float32 values", () => {
    const doc = shapesToGltf([{ kind: "sphere", name: "K", size: [0.1], at: [0, 0, 0], rot: [0, 0, 0], color: null }]);
    const acc = (doc.accessors as { min?: number[]; max?: number[] }[])[0];
    expect(acc.max).toEqual([0.1, 0.1, 0.1].map(Math.fround));
    expect(acc.min).toEqual([-0.1, -0.1, -0.1].map(Math.fround));
  });

  it("refuses an empty part list", () => {
    expect(() => shapesToGltf([])).toThrow(/no parts/);
  });
});
