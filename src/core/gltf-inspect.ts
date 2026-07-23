// GLB-Container pruefen und `extensionsRequired` lesen — pure, ohne three.
//
// Zweck: VOR dem Loader-Aufruf erkennen, ob eine Datei Draco/Meshopt verlangt.
// Deren Decoder laufen worker-basiert; Obsidians Renderer verbietet Worker. Ohne
// diese Pruefung saehe der Nutzer einen generischen Parserfehler statt des Grundes.
//
// GLB v2: 12 Byte Header (magic "glTF", version, length), dann Chunks je 8 Byte
// Header (chunkLength, chunkType); erster Chunk ist JSON. Alles little-endian.

const GLB_MAGIC = 0x46546c67;
const CHUNK_TYPE_JSON = 0x4e4f534a;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

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
  if (buffer.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) return INVALID;

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return INVALID;
  if (view.getUint32(HEADER_BYTES + 4, true) !== CHUNK_TYPE_JSON) return INVALID;

  const jsonLength = view.getUint32(HEADER_BYTES, true);
  const jsonStart = HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (jsonLength === 0 || jsonStart + jsonLength > buffer.byteLength) return INVALID;

  try {
    const text = new TextDecoder().decode(new Uint8Array(buffer, jsonStart, jsonLength));
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
