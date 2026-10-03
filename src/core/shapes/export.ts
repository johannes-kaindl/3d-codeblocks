// glTF-Export einer shapes-Quelle. Pure. Der Export ist eine Ableitung in EINE Richtung:
// `asset.extras.generatedFrom` nennt die Quelle, damit niemand die Datei für sie hält.
import { convertShapesText } from "./convert";

const FORBIDDEN_IN_NAMES = /[\\/:*?"<>|#^[\]]/g;

export function exportBaseName(header: { title?: string }, fallback: string): string {
  const title = header.title?.trim() ?? "";
  return (title !== "" ? title : fallback).replace(FORBIDDEN_IN_NAMES, "-");
}

export function buildGltfExport(
  text: string,
  generatedFrom: string,
): { ok: true; json: string; title?: string } | { ok: false; messages: string[] } {
  const result = convertShapesText(text, { generatedFrom });
  if (!result.ok) return { ok: false, messages: result.messages };
  return { ok: true, json: JSON.stringify(result.gltf), title: result.parsed.header.title };
}
