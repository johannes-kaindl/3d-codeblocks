// Blockquelltext → Blockquelltext mit gesetztem/entferntem `view:`. Pure.
//
// Alles ausser der `view:`-Zeile bleibt buchstabengetreu erhalten: Kommentare,
// Leerzeilen, Reihenfolge, unbekannte Keys, abschliessender Zeilenumbruch.
import { formatView, type ViewSpec } from "./view-spec";

const VIEW_LINE = /^\s*view\s*:/i;
const FILE_LINE = /^\s*file\s*:/i;
const KEY_LINE = /^\s*[A-Za-z][A-Za-z0-9_-]*\s*:/;

export function applyViewKey(source: string, spec: ViewSpec | null): string {
  const hadTrailingNewline = source.endsWith("\n");
  const body = hadTrailingNewline ? source.slice(0, -1) : source;
  const lines = body.split("\n");

  const kept = lines.filter((line) => !VIEW_LINE.test(line));
  const result = spec === null ? kept : insert(kept, `view: ${formatView(spec)}`);

  return hadTrailingNewline ? `${result.join("\n")}\n` : result.join("\n");
}

/** Hinter `file:`, sonst hinter der Pfad-Kurzform, sonst ans Ende. */
function insert(lines: string[], viewLine: string): string[] {
  let anchor = lines.findIndex((line) => FILE_LINE.test(line));

  if (anchor === -1) {
    anchor = lines.findIndex(
      (line) => line.trim() !== "" && !line.trim().startsWith("#") && !KEY_LINE.test(line),
    );
  }

  if (anchor === -1) return [...lines, viewLine];
  return [...lines.slice(0, anchor + 1), viewLine, ...lines.slice(anchor + 1)];
}
