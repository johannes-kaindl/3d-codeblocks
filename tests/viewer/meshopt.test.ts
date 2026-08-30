/**
 * Meshopt-komprimiertes glTF. Der Decoder laeuft OHNE Worker — `decodeGltfBufferAsync`
 * faellt auf synchrones WASM im Main-Thread zurueck, solange `useWorkers()` nie gerufen
 * wird (und three ruft es nie von selbst). Das WASM liegt base64-inline im Modul, es gibt
 * also auch keinen Netzwerkzugriff.
 *
 * Draco kann das nicht: dort ist `new Worker(...)` fest verdrahtet.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Object3D } from "three";
import { loadModel } from "../../src/viewer/loaders";
import { inspectGlb, unsupportedRequired } from "../../src/core/gltf-inspect";

function meshoptGlb(): ArrayBuffer {
  const file = readFileSync("tests/fixtures/ground-floor-meshopt.glb");
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

describe("meshopt", () => {
  it("the fixture really is compressed — otherwise this file proves nothing", () => {
    const inspection = inspectGlb(meshoptGlb());

    expect(inspection.valid).toBe(true);
    expect(inspection.requiredExtensions).toContain("EXT_meshopt_compression");
  });

  it("is no longer refused as unsupported", () => {
    expect(unsupportedRequired(inspectGlb(meshoptGlb()))).toEqual([]);
  });

  it("draco is still refused, because its decoder needs a worker", () => {
    expect(
      unsupportedRequired({ valid: true, requiredExtensions: ["KHR_draco_mesh_compression"] }),
    ).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("loads and produces geometry", async () => {
    const scene = (await loadModel(meshoptGlb(), "gltf", "#888888")).object as Object3D;

    let meshes = 0;
    scene.traverse((child) => {
      if ((child as { isMesh?: boolean }).isMesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(0);
  });
});
