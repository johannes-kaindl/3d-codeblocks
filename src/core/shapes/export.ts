// glTF-Export einer shapes-Quelle. Pure. Der Export ist eine Ableitung in EINE Richtung:
// `asset.extras.generatedFrom` nennt die Quelle, damit niemand die Datei für sie hält.
import { convertShapesText } from "./convert";

const FORBIDDEN_IN_NAMES = /[\\/:*?"<>|#^[\]]/g;

const CONTROL_CHARS = /\p{Cc}/gu;
const MAX_NAME_LENGTH = 100;

// Ein Name darf nie versteckt (führender Punkt: Obsidian indiziert ihn nicht), leer oder nur
// Ersatzstriche sein; sonst entsteht beim ersten Export eine unsichtbare Datei.
function sanitize(raw: string): string {
  const cleaned = raw
    .replace(CONTROL_CHARS, "")
    .replace(FORBIDDEN_IN_NAMES, "-")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[.\s]+$/g, "");
  return /^[-\s.]*$/.test(cleaned) ? "" : cleaned;
}

export function exportBaseName(header: { title?: string }, fallback: string): string {
  return sanitize(header.title ?? "") || sanitize(fallback) || "model";
}

export function buildGltfExport(
  text: string,
  generatedFrom: string,
): { ok: true; json: string; title?: string } | { ok: false; messages: string[] } {
  const result = convertShapesText(text, { generatedFrom });
  if (!result.ok) return { ok: false, messages: result.messages };
  return { ok: true, json: JSON.stringify(result.gltf), title: result.parsed.header.title };
}
