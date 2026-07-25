// Blockquelltext → Blockquelltext mit gesetztem/entferntem `view:`. Pure.
//
// Alles ausser der `view:`-Zeile bleibt buchstabengetreu erhalten: Kommentare,
// Leerzeilen, Reihenfolge, unbekannte Keys, abschliessender Zeilenumbruch.
import { formatView, type ViewSpec } from "./view-spec";

const VIEW_LINE = /^\s*view\s*:/i;
const FILE_LINE = /^\s*file\s*:/i;
const KEY_LINE = /^\s*[A-Za-z][A-Za-z0-9_-]*\s*:/;

export function applyViewKey(source: string, spec: ViewSpec | null): string {
  // Zeilenumbruch-Stil erkennen: CRLF wenn vorhanden, sonst LF.
  const hasCRLF = source.includes("\r\n");
  const lineSeparator = hasCRLF ? "\r\n" : "\n";

  // Abschliessenden Zeilenumbruch merken.
  const hadTrailingNewline = source.endsWith(lineSeparator);

  // Abschliessenden Zeilenumbruch entfernen.
  const body = hadTrailingNewline ? source.slice(0, -lineSeparator.length) : source;

  // Leerer Body: wenn spec=null, leer zurückgeben; sonst nur die view:-Zeile.
  if (body === "") {
    if (spec === null) return "";
    return `view: ${formatView(spec)}`;
  }

  // Auf beiden CRLF und LF teilen, um saubere Zeilen zu bekommen.
  const lines = body.split(/\r\n|\n/);

  const kept = lines.filter((line) => !VIEW_LINE.test(line));
  const result = spec === null ? kept : insert(kept, `view: ${formatView(spec)}`);

  const joined = result.join(lineSeparator);
  return hadTrailingNewline ? `${joined}${lineSeparator}` : joined;
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
