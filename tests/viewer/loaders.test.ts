import { describe, expect, it, vi } from "vitest";
import type { Mesh, MeshStandardMaterial, Object3D } from "three";
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

/** Binaeres STL im "Magics"-Farbformat: Header `COLOR=rgba`, ein Dreieck. */
function colouredStl(withColour: boolean): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  if (withColour) {
    bytes.set([0x43, 0x4f, 0x4c, 0x4f, 0x52, 0x3d, 255, 0, 0, 255], 0); // "COLOR=" + rgba
  } else {
    bytes.set([0x78], 0); // irgendein Header, nur nicht "solid" (sonst gilt es als ASCII)
  }

  view.setUint32(80, 1, true); // ein Facet
  const start = 84;
  view.setFloat32(start + 8, 1, true); // Normale (0,0,1)
  view.setFloat32(start + 12 + 0, 0, true);
  view.setFloat32(start + 12 + 12, 1, true);
  view.setFloat32(start + 12 + 24, 0, true);
  view.setFloat32(start + 12 + 28, 1, true);
  view.setUint16(start + 48, 0x001f, true); // eigene Facet-Farbe, Bit 15 aus

  return buffer;
}

describe("loadModel (stl)", () => {
  it("shows the colours a Magics-coloured STL carries", async () => {
    const mesh = (await loadModel(colouredStl(true), "stl", "#888888")) as Mesh;
    const material = mesh.material as MeshStandardMaterial;

    expect(material.vertexColors).toBe(true);
  });

  it("keeps the theme colour for an STL without colours", async () => {
    const mesh = (await loadModel(colouredStl(false), "stl", "#123456")) as Mesh;
    const material = mesh.material as MeshStandardMaterial;

    expect(material.vertexColors).toBe(false);
    expect(material.color.getHexString()).toBe("123456");
  });
});

describe("loadModel (gltf, external resources)", () => {
  it("asks the resolver for a buffer the file does not carry itself", async () => {
    // Der Buffer wird LAZY geladen: nur ein Accessor, den die Szene wirklich benutzt,
    // loest die Anfrage aus. Eine leere Szene fragt nie nach und prueft damit nichts.
    const gltf = JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "scene.bin", byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    });
    const bytes = new TextEncoder().encode(gltf).buffer as ArrayBuffer;
    const resolve = vi.fn((uri: string) => `resolved://${uri}`);

    await loadModel(bytes, "gltf", "#888888", resolve).catch(() => undefined);

    expect(resolve).toHaveBeenCalledWith("scene.bin");
  });
});
