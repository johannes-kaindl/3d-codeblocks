// GLB-Container pruefen und `extensionsRequired` lesen — pure, ohne three.
//
// Zweck: VOR dem Loader-Aufruf erkennen, ob eine Datei Draco/Meshopt verlangt.
// Deren Decoder laufen worker-basiert; Obsidians Renderer verbietet Worker. Ohne
// diese Pruefung saehe der Nutzer einen generischen Parserfehler statt des Grundes.
//
// GLB v2: 12 Byte Header (magic "glTF", version, length), dann Chunks je 8 Byte
// Header (chunkLength, chunkType); erster Chunk ist JSON. Alles little-endian.

export const GLB_MAGIC = 0x46546c67;
export const CHUNK_TYPE_JSON = 0x4e4f534a;
export const GLB_HEADER_BYTES = 12;
export const GLB_CHUNK_HEADER_BYTES = 8;

/** Text des JSON-Chunks — `null` bei jedem Struktur-Defekt. */
export function glbJsonText(buffer: ArrayBuffer): string | null {
  if (buffer.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  if (view.getUint32(GLB_HEADER_BYTES + 4, true) !== CHUNK_TYPE_JSON) return null;
  const jsonLength = view.getUint32(GLB_HEADER_BYTES, true);
  const jsonStart = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
  if (jsonLength === 0 || jsonStart + jsonLength > buffer.byteLength) return null;
  return new TextDecoder().decode(new Uint8Array(buffer, jsonStart, jsonLength));
}

export interface GlbInspection {
  /** Gueltiger GLB-Container mit lesbarem JSON-Chunk. */
  valid: boolean;
  requiredExtensions: string[];
}

export const UNSUPPORTED_EXTENSIONS = [
  "KHR_draco_mesh_compression",
  "EXT_meshopt_compression",
] as const;

const INVALID: GlbInspection = { valid: false, requiredExtensions: [] };

export function inspectGlb(buffer: ArrayBuffer): GlbInspection {
  const text = glbJsonText(buffer);
  if (text === null) return INVALID;

  try {
    const parsed: unknown = JSON.parse(text);
    const required =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { extensionsRequired?: unknown }).extensionsRequired
        : undefined;

    return {
      valid: true,
      requiredExtensions: Array.isArray(required)
        ? required.filter((e): e is string => typeof e === "string")
        : [],
    };
  } catch {
    return INVALID;
  }
}

export function unsupportedRequired(inspection: GlbInspection): string[] {
  return inspection.requiredExtensions.filter((e) =>
    (UNSUPPORTED_EXTENSIONS as readonly string[]).includes(e),
  );
}
