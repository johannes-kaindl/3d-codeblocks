// Wer verwendet eine Modell-Datei? Pure. Gebraucht vor dem Umwandeln Datei → Block: nur
// bei genau EINEM Verweis ist es ein Umzug; bei mehr entstünde eine zweite Wahrheit oder
// ein toter Verweis (Spec § 5.2). Obsidian indiziert Codeblock-Inhalte nicht als Links —
// deshalb ein eigener Textlauf über ```3d-Blöcke UND Embeds, mit EINER Auflösungsfunktion
// von außen, damit beide Wege dieselbe Wikilink-Semantik haben.
// Ein übersehener Verweis lässt Datei → Block eine noch benutzte Datei löschen: im Zweifel zählen.
import { parseBlockConfig } from "../block-config";
import { fenceFor } from "./fence";

export interface NoteText {
  path: string;
  text: string;
}

export type AloneReason = "list" | "quote" | "indent" | "inline" | "table" | "continuation";

/**
 * `nested` (nur gesetzt, wenn wahr): der Block steht in einem Zitat/Callout oder einer Liste. Obsidian
 * rendert ihn, aber ein Ersatz an Spalte 0 würde die Struktur zerreißen — der Aufrufer lehnt ab.
 * `aloneReason` (nur gesetzt, wenn `alone` falsch ist): warum der Embed nicht ersetzbar ist.
 * `link`: einfacher Wikilink ohne `!` — nie ersetzbar, aber nach dem Löschen der Datei tot.
 */
export type ModelReference =
  | { notePath: string; kind: "block"; from: number; to: number; text: string; nested?: true }
  | { notePath: string; kind: "embed"; from: number; to: number; text: string; alone: boolean; aloneReason?: AloneReason }
  | { notePath: string; kind: "link"; from: number; to: number; text: string };

// `\|` (maskierter Strich in Tabellen) wird akzeptiert; der Linktext verliert den Backslash.
const WIKI = /(!?)\[\[([^\]|#^]+)(?:[#^|][^\]]*)?\]\]/g;
// `![alt](pfad)` / `![](<pfad mit leerzeichen>)` — Obsidians Embed-Registry rendert registrierte
// Erweiterungen auch in dieser Schreibweise (embed.ts:67 MODEL_EXTENSIONS, registerExtension).
const MD_EMBED = /!\[[^\]]*\]\((<[^>]*>|[^)\s]*)\)/g;
const QUOTE = /^\s*>[ ]?/;
const LIST_MARK = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const FENCE_OPEN = /^(`{3,}|~{3,})\s*([^\s`]*)/;

interface ScannedFence {
  lang: string;
  from: number;
  to: number;
  nested: boolean;
  body: string;
}

function stripQuotes(line: string): { rest: string; quoted: boolean } {
  let rest = line;
  let quoted = false;
  while (QUOTE.test(rest)) {
    rest = rest.replace(QUOTE, "");
    quoted = true;
  }
  return { rest, quoted };
}

/** Zaunsuche, die Zitat- und Listen-Präfixe kennt (Obsidian rendert solche Zäune; fence.ts bewusst nicht). */
function scanFences(lines: string[]): ScannedFence[] {
  const out: ScannedFence[] = [];
  let i = 0;
  while (i < lines.length) {
    const { rest: afterQuote, quoted } = stripQuotes(lines[i]);
    let rest = afterQuote;
    let marked = false;
    if (LIST_MARK.test(rest)) {
      rest = rest.replace(LIST_MARK, "");
      marked = true;
    }
    const indent = /^[ \t]*/.exec(rest)?.[0] ?? "";
    const open = FENCE_OPEN.exec(rest.slice(indent.length));
    if (!open) {
      i += 1;
      continue;
    }
    const nested = quoted || marked || indent.includes("\t") || indent.length > 3;
    const marker = open[1];
    const closeRe = new RegExp(`^\\s*${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
    let j = i + 1;
    const body: string[] = [];
    while (j < lines.length) {
      const content = stripQuotes(lines[j]).rest;
      if (closeRe.test(content) && (nested || /^ {0,3}\S/.test(content))) break;
      body.push(content.trim());
      j += 1;
    }
    const to = j < lines.length ? j : lines.length - 1;
    out.push({ lang: open[2].toLowerCase(), from: i, to, nested, body: body.join("\n") });
    i = to + 1;
  }
  return out;
}

const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const ALONE_LINE = /^ {0,3}!\[\[[^\]]*\]\]\s*$/;

/**
 * Konservativ: ein Embed ist nur dann "alone" (durch einen Zaun ersetzbar), wenn die Zeile nur aus ihm
 * besteht (höchstens drei Leerzeichen davor, kein Tab) UND er keine Fortsetzungszeile eines Listenpunkts,
 * Zitats oder einer Tabelle ist (davor Leerzeile bzw. Absatz/Überschrift/Zaun, oder selbst ein Embed).
 * Im Zweifel: nicht alone.
 */
function aloneReason(lines: string[], index: number, match: string, inFence: Set<number>): AloneReason | undefined {
  const line = lines[index];
  const at = line.indexOf(match);
  const before = line.slice(0, at);
  const after = line.slice(at + match.length);
  if (before.includes("|") || after.includes("|")) return "table";
  if (/^\s*>/.test(line)) return "quote";
  if (LIST_LINE.test(line)) return "list";
  if (before.includes("\t") || /^ {4,}/.test(line)) return "indent";
  if (line.trim() !== match) return "inline";
  const indented = /^\s+\S/.test(line);
  let p = index - 1;
  const directlyAfter = p >= 0 && lines[p].trim() !== "";
  while (p >= 0 && lines[p].trim() === "") p -= 1;
  if (p < 0 || inFence.has(p)) return undefined;
  const prev = lines[p];
  const prevBad = /^\s*>/.test(prev) || LIST_LINE.test(prev) || prev.trim().startsWith("|") || /^(\t| {2,})\S/.test(prev);
  if (!prevBad) return undefined;
  if (directlyAfter) return ALONE_LINE.test(prev) ? undefined : "continuation";
  return indented ? "continuation" : undefined;
}

export function findModelReferences(
  notes: readonly NoteText[],
  targetPath: string,
  resolve: (link: string, sourcePath: string) => string | null,
): ModelReference[] {
  const refs: ModelReference[] = [];
  for (const note of notes) {
    const lines = note.text.split(/\r?\n/);
    const inFence = new Set<number>();
    for (const fence of scanFences(lines)) {
      for (let l = fence.from; l <= fence.to; l++) inFence.add(l);
      if (fence.lang !== "3d") continue;
      const file = parseBlockConfig(fence.body).config?.file;
      if (file && resolve(file, note.path) === targetPath) {
        refs.push({
          notePath: note.path,
          kind: "block",
          from: fence.from,
          to: fence.to,
          text: lines.slice(fence.from, fence.to + 1).join("\n"),
          ...(fence.nested ? { nested: true as const } : {}),
        });
      }
    }
    lines.forEach((line, index) => {
      if (inFence.has(index)) return;
      const hit = (link: string) => resolve(link, note.path) === targetPath;
      for (const match of line.matchAll(WIKI)) {
        if (!hit(match[2].replace(/\\+$/, "").trim())) continue;
        if (match[1] === "") {
          refs.push({ notePath: note.path, kind: "link", from: index, to: index, text: line });
          continue;
        }
        const reason = aloneReason(lines, index, match[0], inFence);
        refs.push({
          notePath: note.path,
          kind: "embed",
          from: index,
          to: index,
          text: line,
          alone: reason === undefined,
          ...(reason ? { aloneReason: reason } : {}),
        });
      }
      for (const match of line.matchAll(MD_EMBED)) {
        let link = match[1].replace(/^<|>$/g, "");
        try {
          link = decodeURIComponent(link);
        } catch {
          // kein gültiges Prozent-Muster: Rohtext verwenden
        }
        if (!hit(link)) continue;
        refs.push({ notePath: note.path, kind: "embed", from: index, to: index, text: line, alone: false, aloneReason: "inline" });
      }
    });
  }
  // Reihenfolge: je Notiz nach Zeile — die Meldung an den Nutzer liest sich dann wie der Vault.
  return refs.sort((a, b) => (a.notePath === b.notePath ? a.from - b.from : a.notePath < b.notePath ? -1 : 1));
}

export function referenceBlock(linktext: string): string {
  return ["```3d", `file: ${linktext}`, "```"].join("\n");
}

/**
 * Regel: BOM weg, CRLF → LF, alle abschließenden Zeilenumbrüche entfallen; sonst bleibt der Text unberührt.
 * Ein führendes BOM (U+FEFF) würde in der ersten DSL-Zeile sitzen und deren Parsing brechen. Bekannte,
 * akzeptierte Normalisierung: die Rückumwandlung (Block → Datei) schreibt eine BOM-lose Datei.
 */
export function shapesBlock(text: string): string {
  const body = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const fence = fenceFor(body);
  return [`${fence}shapes`, body, fence].join("\n");
}
