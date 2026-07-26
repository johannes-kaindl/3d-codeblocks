// glTF byte-schonend analysieren und patchen — pure, ohne three.
//
// Der Editor exportiert NIE die Szene: gespeichert wird durch gezieltes Ersetzen
// von translation/scale im Original-JSON. Dadurch koennen die Kontrakt-Regeln
// (keine Mesh-Edits, keine Node-CRUD, keine matrix, Namen unangetastet) gar nicht
// verletzt werden — sie sind Struktureigenschaft, kein Versprechen.

import {
  CHUNK_TYPE_JSON,
  GLB_CHUNK_HEADER_BYTES,
  GLB_HEADER_BYTES,
  GLB_MAGIC,
  glbJsonText,
} from "./gltf-inspect";

export type Vec3 = [number, number, number];

export interface NodeTrs {
  translation: Vec3;
  scale: Vec3;
}

export type LockReason = "prefix" | "matrix" | "duplicate-name" | "unnamed";

export interface EditableNode {
  index: number;
  name: string;
  base: NodeTrs;
  lock: LockReason | null;
}

interface GltfNode {
  name?: unknown;
  translation?: unknown;
  scale?: unknown;
  matrix?: unknown;
}

interface GltfDoc {
  scene?: unknown;
  scenes?: unknown;
  nodes?: unknown;
}

const DEFAULT_TRANSLATION: Vec3 = [0, 0, 0];
const DEFAULT_SCALE: Vec3 = [1, 1, 1];

function vec3(value: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number")
    ? [value[0], value[1], value[2]]
    : [...fallback];
}

/** Indizes der Root-Nodes der aktiven Szene — [] bei jedem Struktur-Defekt. */
function sceneNodeIndices(doc: GltfDoc): number[] {
  if (typeof doc !== "object" || doc === null || !Array.isArray(doc.scenes)) return [];
  const sceneIndex = typeof doc.scene === "number" ? doc.scene : 0;
  const scene = doc.scenes[sceneIndex] as { nodes?: unknown } | undefined;
  if (!scene || !Array.isArray(scene.nodes)) return [];
  return scene.nodes.filter((n): n is number => typeof n === "number");
}

export function analyzeTopLevelNodes(json: unknown, lockedPrefixes: string[]): EditableNode[] {
  const doc = json as GltfDoc;
  const indices = sceneNodeIndices(doc);
  if (indices.length === 0 || !Array.isArray(doc.nodes)) return [];

  const nodes = doc.nodes as GltfNode[];
  const named = indices
    .map((index) => ({ index, node: nodes[index] }))
    .filter((entry): entry is { index: number; node: GltfNode } => entry.node !== undefined);

  const nameCounts = new Map<string, number>();
  for (const { node } of named) {
    if (typeof node.name === "string" && node.name !== "") {
      nameCounts.set(node.name, (nameCounts.get(node.name) ?? 0) + 1);
    }
  }

  return named.map(({ index, node }) => {
    const name = typeof node.name === "string" && node.name !== "" ? node.name : `#${index}`;
    const unnamed = typeof node.name !== "string" || node.name === "";
    const lock: LockReason | null = unnamed
      ? "unnamed"
      : node.matrix !== undefined
        ? "matrix"
        : lockedPrefixes.some((p) => name.startsWith(p))
          ? "prefix"
          : (nameCounts.get(name) ?? 0) > 1
            ? "duplicate-name"
            : null;

    return {
      index,
      name,
      base: {
        translation: vec3(node.translation, DEFAULT_TRANSLATION),
        scale: vec3(node.scale, DEFAULT_SCALE),
      },
      lock,
    };
  });
}

/** TRS pro benanntem Top-Level-Node — der Overlay-Leseweg (Edit-Datei → Original). */
export function extractTrsByName(json: unknown): Map<string, NodeTrs> {
  const map = new Map<string, NodeTrs>();
  for (const node of analyzeTopLevelNodes(json, [])) {
    if (node.lock === "unnamed" || node.lock === "duplicate-name") continue;
    map.set(node.name, node.base);
  }
  return map;
}

export interface TrsEdit {
  index: number;
  translation: Vec3;
  scale: Vec3;
}

export function patchGltfJson(text: string, edits: TrsEdit[]): string {
  const doc = JSON.parse(text) as GltfDoc;
  if (!Array.isArray(doc.nodes)) throw new Error("glTF has no nodes array");
  const nodes = doc.nodes as GltfNode[];

  for (const edit of edits) {
    const node = nodes[edit.index];
    if (node === undefined) throw new Error(`glTF node index ${edit.index} does not exist`);
    // Gesperrt ab Analyse — landet trotzdem ein Edit hier, ist das ein Programmierfehler,
    // und stilles Ueberschreiben wuerde den Kontrakt (TRS statt matrix) brechen.
    if (node.matrix !== undefined) throw new Error(`node ${edit.index} uses a matrix transform`);
    node.translation = [...edit.translation];
    node.scale = [...edit.scale];
  }

  return JSON.stringify(doc);
}

export function patchGlbContainer(buffer: ArrayBuffer, edits: TrsEdit[]): ArrayBuffer {
  const jsonText = glbJsonText(buffer);
  if (jsonText === null) throw new Error("not a valid GLB container");

  const patchedJson = new TextEncoder().encode(patchGltfJson(jsonText, edits));
  // GLB-Spec: JSON-Chunk mit 0x20 (Space) auf ein Vielfaches von 4 auffuellen.
  const paddedLength = (patchedJson.length + 3) & ~3;

  const view = new DataView(buffer);
  const oldJsonLength = view.getUint32(GLB_HEADER_BYTES, true);
  const restStart = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + oldJsonLength;
  const rest = new Uint8Array(buffer, restStart); // BIN-Chunk inkl. Header, verbatim

  const total = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + paddedLength + rest.byteLength;
  const out = new ArrayBuffer(total);
  const outView = new DataView(out);
  const outBytes = new Uint8Array(out);

  outView.setUint32(0, GLB_MAGIC, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, total, true);
  outView.setUint32(GLB_HEADER_BYTES, paddedLength, true);
  outView.setUint32(GLB_HEADER_BYTES + 4, CHUNK_TYPE_JSON, true);
  outBytes.fill(0x20, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + paddedLength);
  outBytes.set(patchedJson, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES);
  outBytes.set(rest, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + paddedLength);
  return out;
}
