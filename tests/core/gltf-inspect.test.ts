import { describe, expect, it } from "vitest";
import { inspectGlb, unsupportedRequired } from "../../src/core/gltf-inspect";

function makeGlb(json: unknown, opts: { magic?: number; truncate?: boolean } = {}): ArrayBuffer {
  const jsonText = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const padded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4);
  padded.fill(0x20);
  padded.set(jsonBytes);

  const total = 12 + 8 + padded.length;
  const buf = new ArrayBuffer(opts.truncate ? 10 : total);
  const view = new DataView(buf);
  if (opts.truncate) return buf;

  view.setUint32(0, opts.magic ?? 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf).set(padded, 20);
  return buf;
}

describe("inspectGlb", () => {
  it("accepts a plain GLB with no required extensions", () => {
    const r = inspectGlb(makeGlb({ asset: { version: "2.0" } }));
    expect(r.valid).toBe(true);
    expect(r.requiredExtensions).toEqual([]);
  });

  it("reads extensionsRequired", () => {
    const r = inspectGlb(makeGlb({ extensionsRequired: ["KHR_draco_mesh_compression"] }));
    expect(r.requiredExtensions).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("rejects a wrong magic number", () => {
    expect(inspectGlb(makeGlb({}, { magic: 0x12345678 })).valid).toBe(false);
  });

  it("rejects a truncated file", () => {
    expect(inspectGlb(makeGlb({}, { truncate: true })).valid).toBe(false);
  });

  it("rejects an empty buffer", () => {
    expect(inspectGlb(new ArrayBuffer(0)).valid).toBe(false);
  });

  it("survives a broken JSON chunk", () => {
    const good = makeGlb({ asset: { version: "2.0" } });
    const bytes = new Uint8Array(good);
    bytes[20] = 0x7b;
    bytes[21] = 0x7b; // "{{" — kaputt
    const r = inspectGlb(good);
    expect(r.valid).toBe(false);
    expect(r.requiredExtensions).toEqual([]);
  });
});

describe("unsupportedRequired", () => {
  it("flags draco", () => {
    expect(
      unsupportedRequired({ valid: true, requiredExtensions: ["KHR_draco_mesh_compression"] }),
    ).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("flags meshopt", () => {
    expect(
      unsupportedRequired({ valid: true, requiredExtensions: ["EXT_meshopt_compression"] }),
    ).toEqual(["EXT_meshopt_compression"]);
  });

  it("passes extensions that are merely used, not required", () => {
    expect(unsupportedRequired({ valid: true, requiredExtensions: ["KHR_materials_unlit"] })).toEqual(
      [],
    );
  });
});
