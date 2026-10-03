// Wer verwendet eine Modell-Datei? Pure. Gebraucht vor dem Umwandeln Datei → Block: nur
// bei genau EINEM Verweis ist es ein Umzug; bei mehr entstünde eine zweite Wahrheit oder
// ein toter Verweis (Spec § 5.2). Obsidian indiziert Codeblock-Inhalte nicht als Links —
// deshalb ein eigener Textlauf über ```3d-Blöcke UND Embeds, mit EINER Auflösungsfunktion
// von außen, damit beide Wege dieselbe Wikilink-Semantik haben.
import { parseBlockConfig } from "../block-config";
import { fenceFor, listFences } from "./fence";

export interface NoteText {
  path: string;
  text: string;
}

export type ModelReference =
  | { notePath: string; kind: "block"; from: number; to: number; text: string }
  | { notePath: string; kind: "embed"; from: number; to: number; text: string; alone: boolean };

const EMBED = /!\[\[([^\]|#^]+)(?:[#^|][^\]]*)?\]\]/g;

/**
 * "alone" (konservativ): die Zeile besteht nur aus dem Embed, davor höchstens drei Leerzeichen
 * (kein Tab, keine Listen-/Zitat-/Einrückungs-Struktur), danach nur Leerraum. Listenpunkt und
 * Zitat sind bewusst NICHT alone: ein Zaun an ihrer Stelle risse die Struktur auf.
 */
function standsAlone(line: string, embed: string): boolean {
  return /^ {0,3}$/.test(line.slice(0, line.indexOf(embed))) && line.slice(line.indexOf(embed) + embed.length).trim() === "" && line.trim() === embed;
}

export function findModelReferences(
  notes: readonly NoteText[],
  targetPath: string,
  resolve: (link: string, sourcePath: string) => string | null,
): ModelReference[] {
  const refs: ModelReference[] = [];
  for (const note of notes) {
    const lines = note.text.split(/\r?\n/);
    const fences = listFences(note.text);
    const inFence = new Set<number>();
    for (const fence of fences) {
      for (let l = fence.openLine; l <= fence.closeLine; l++) inFence.add(l);
      if (fence.lang !== "3d") continue;
      const file = parseBlockConfig(fence.body).config?.file;
      if (file && resolve(file, note.path) === targetPath) {
        refs.push({
          notePath: note.path,
          kind: "block",
          from: fence.openLine,
          to: fence.closeLine,
          text: lines.slice(fence.openLine, fence.closeLine + 1).join("\n"),
        });
      }
    }
    lines.forEach((line, index) => {
      if (inFence.has(index)) return;
      for (const match of line.matchAll(EMBED)) {
        if (resolve(match[1].trim(), note.path) !== targetPath) continue;
        refs.push({ notePath: note.path, kind: "embed", from: index, to: index, text: line, alone: standsAlone(line, match[0]) });
      }
    });
  }
  // Reihenfolge: je Notiz nach Zeile — die Meldung an den Nutzer liest sich dann wie der Vault.
  return refs.sort((a, b) => (a.notePath === b.notePath ? a.from - b.from : a.notePath < b.notePath ? -1 : 1));
}

export function referenceBlock(linktext: string): string {
  return ["```3d", `file: ${linktext}`, "```"].join("\n");
}

/** Regel: CRLF → LF, alle abschließenden Zeilenumbrüche entfallen; sonst bleibt der Text unberührt. */
export function shapesBlock(text: string): string {
  const body = text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const fence = fenceFor(body);
  return [`${fence}shapes`, body, fence].join("\n");
}
