// Teile → glTF-2.0-Dokument mit eingebettetem Puffer (`data:`-URI). Pure, ohne Node-APIs.
// Ein Knoten je Teil, Knotenname = Teilname — darüber greifen später Änderungsliste und
// Anfasser zu (Spec § 4.1, § 6.5).
import { buildMesh, eulerXyzToQuaternion } from "./geometry";
import { DEFAULT_COLOR, type ShapeDraft } from "./types";

export type GltfDocument = Record<string, unknown>;

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function baseColor(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255)).concat(1);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function shapesToGltf(parts: readonly ShapeDraft[], extras?: Record<string, unknown>): GltfDocument {
  if (parts.length === 0) throw new Error("shapes: no parts to convert");

  const chunks: Uint8Array[] = [];
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const meshes: unknown[] = [];
  const materials: unknown[] = [];
  const nodes: Record<string, unknown>[] = [];
  let offset = 0;

  const push = (typed: Float32Array | Uint16Array, target: number): number => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = new Uint8Array(bytes.length + ((4 - (bytes.length % 4)) % 4));
    padded.set(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(padded);
    offset += padded.length;
    return bufferViews.length - 1;
  };

  parts.forEach((part, i) => {
    const mesh = buildMesh(part.kind, part.size);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < mesh.positions.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], Math.fround(mesh.positions[k + a]));
        max[a] = Math.max(max[a], Math.fround(mesh.positions[k + a]));
      }
    }
    const base = accessors.length;
    accessors.push({ bufferView: push(new Float32Array(mesh.positions), ARRAY_BUFFER), componentType: FLOAT, count: mesh.positions.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: push(new Float32Array(mesh.normals), ARRAY_BUFFER), componentType: FLOAT, count: mesh.normals.length / 3, type: "VEC3" });
    accessors.push({ bufferView: push(new Uint16Array(mesh.indices), ELEMENT_ARRAY_BUFFER), componentType: UNSIGNED_SHORT, count: mesh.indices.length, type: "SCALAR" });
    materials.push({
      name: part.name,
      pbrMetallicRoughness: { baseColorFactor: baseColor(part.color ?? DEFAULT_COLOR), metallicFactor: 0, roughnessFactor: 0.8 },
    });
    meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, material: i }] });

    const node: Record<string, unknown> = { name: part.name, mesh: i };
    if (part.at.some((v) => v !== 0)) node.translation = [...part.at];
    if (part.rot.some((v) => v !== 0)) node.rotation = eulerXyzToQuaternion(part.rot);
    nodes.push(node);
  });

  const all = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }

  return {
    asset: { version: "2.0", generator: "3D Codeblocks shapes", ...(extras ? { extras } : {}) },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset, uri: `data:application/octet-stream;base64,${toBase64(all)}` }],
  };
}
