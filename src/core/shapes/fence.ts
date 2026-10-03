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

export function findFenceAt(text: string, line: number): Fence | null {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const open = OPEN.exec(lines[i]);
    if (!open) {
      i += 1;
      continue;
    }
    const marker = open[1];
    const lang = open[2].toLowerCase();
    const closeRe = new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j])) j += 1;
    const closed = j < lines.length;
    const closeLine = closed ? j : lines.length - 1;
    if (line >= i && line <= closeLine) {
      const body = lines.slice(i + 1, closed ? j : lines.length).join("\n");
      return { lang, openLine: i, closeLine, body };
    }
    i = closeLine + 1;
  }
  return null;
}
