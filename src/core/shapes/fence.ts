// Welcher Codezaun umschließt eine Zeile? Pure. Gebraucht für den Export aus dem Editor
// und (Inkrement 2) fürs Umwandeln Block ↔ Datei.
export interface Fence {
  lang: string;
  /** 0-basiert: Zeile des öffnenden Zauns. */
  openLine: number;
  /** 0-basiert: Zeile des schließenden Zauns, bei offenem Zaun die letzte Zeile. */
  closeLine: number;
  body: string;
}

const OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;

/** Alle Zäune einer Notiz in Reihenfolge; ein offener Zaun läuft bis zum Ende. */
export function listFences(text: string): Fence[] {
  const lines = text.split(/\r?\n/);
  const out: Fence[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = OPEN.exec(lines[i]);
    if (!open) {
      i += 1;
      continue;
    }
    const marker = open[1];
    const closeRe = new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j])) j += 1;
    const closed = j < lines.length;
    const closeLine = closed ? j : lines.length - 1;
    out.push({ lang: open[2].toLowerCase(), openLine: i, closeLine, body: lines.slice(i + 1, closed ? j : lines.length).join("\n") });
    i = closeLine + 1;
  }
  return out;
}

export function findFenceAt(text: string, line: number): Fence | null {
  return listFences(text).find((f) => line >= f.openLine && line <= f.closeLine) ?? null;
}

/** Backtick-Zaun, der länger ist als jeder Backtick-Lauf im Inhalt (mindestens drei). */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}
