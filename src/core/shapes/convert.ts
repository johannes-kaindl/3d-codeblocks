// shapes-Text → glTF. Die EINE Stelle, durch die jeder Weg geht (Block, Datei, Embed,
// Dateiansicht über den ViewerHost; Export). Pure.
import { parseShapes } from "./parse";
import { shapesToGltf, type GltfDocument } from "./to-gltf";
import type { LineIssue, ParsedShapes } from "./types";

const EMPTY_HINT = "Write one part per line, e.g. `box Cube size 1 at 0 0.5 0`.";

export function formatIssue(issue: LineIssue): string {
  return `Line ${issue.line}: ${issue.message}`;
}

/** Hoechstens `max` Eintraege, der Rest als "… and N more" — eine umbenannte Nicht-shapes-
    Datei erzeugt sonst eine Meldung je Zeile. */
export function capList(items: readonly string[], max: number): string[] {
  if (items.length <= max) return [...items];
  return [...items.slice(0, max), `… and ${items.length - max} more`];
}

export function convertShapesText(
  text: string,
  extras?: Record<string, unknown>,
):
  | { ok: true; gltf: GltfDocument; notes: string[]; parsed: ParsedShapes }
  | { ok: false; messages: string[]; empty: boolean; parsed: ParsedShapes } {
  const parsed = parseShapes(text);
  if (parsed.parts.length === 0) {
    const messages = parsed.errors.length > 0 ? parsed.errors.map(formatIssue) : [EMPTY_HINT];
    // `empty`: weder Teil noch Zeilenfehler (leer, nur Kommentare) — kein Fehler, sondern Leerzustand.
    return { ok: false, messages, empty: parsed.errors.length === 0, parsed };
  }
  // Fehler und Warnungen in Zeilenreihenfolge, damit die Meldung dem Text folgt.
  const notes = [...parsed.errors, ...parsed.warnings].sort((a, b) => a.line - b.line).map(formatIssue);
  return { ok: true, gltf: shapesToGltf(parsed.parts, extras), notes, parsed };
}

export function convertShapesBytes(
  bytes: ArrayBuffer,
): { ok: true; bytes: ArrayBuffer; notes: string[] } | { ok: false; messages: string[]; empty: boolean } {
  const result = convertShapesText(new TextDecoder().decode(bytes));
  if (!result.ok) return { ok: false, messages: result.messages, empty: result.empty };
  const encoded = new TextEncoder().encode(JSON.stringify(result.gltf));
  // Eigener ArrayBuffer statt `encoded.buffer`: dessen Typ ist je nach TS-Version
  // ArrayBufferLike, und ein Ausschnitt davon ist nicht sicher ein ArrayBuffer.
  const out = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(out).set(encoded);
  return { ok: true, bytes: out, notes: result.notes };
}
