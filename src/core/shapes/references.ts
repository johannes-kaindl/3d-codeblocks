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
 * `nested`: der Block steht in einem Zitat/Callout oder einer Liste. Obsidian
 * rendert ihn, aber ein Ersatz an Spalte 0 würde die Struktur zerreißen — der Aufrufer lehnt ab.
 * `aloneReason` (nur gesetzt, wenn `alone` falsch ist): warum der Embed nicht ersetzbar ist.
 * `link`: einfacher Wikilink ohne `!` — nie ersetzbar, aber nach dem Löschen der Datei tot.
 */
export type ModelReference =
  | { notePath: string; kind: "block"; from: number; to: number; text: string; nested: boolean }
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
  /** true, wenn eine echte Schlusszeile gefunden wurde (nicht implizit/EOF geschlossen). */
  closed: boolean;
  body: string;
}

function stripQuotes(line: string): { rest: string; quoted: boolean; depth: number } {
  let rest = line;
  let depth = 0;
  while (QUOTE.test(rest)) {
    rest = rest.replace(QUOTE, "");
    depth += 1;
  }
  return { rest, quoted: depth > 0, depth };
}

/**
 * Zaunsuche, die Zitat- und Listen-Präfixe kennt (Obsidian rendert solche Zäune; fence.ts bewusst nicht).
 * Ein Zaun in einem Zitat endet spätestens an der ersten Zeile ohne `>`; ein Zaun in einem Listenpunkt
 * an der ersten nicht leeren Zeile, die unter die Einrückung des Zaunbeginns fällt. Nur ein Zaun auf
 * oberster Ebene läuft (wie bei listFences) bis zum Dateiende.
 */
function scanFences(lines: string[]): ScannedFence[] {
  const out: ScannedFence[] = [];
  let i = 0;
  while (i < lines.length) {
    // Zitat- und Listenpräfixe abwechselnd abstreifen, bis nichts mehr geht (`- > ```3d`, `- - ```3d`).
    let rest = lines[i];
    let depth = 0;
    let marked = false;
    for (;;) {
      if (QUOTE.test(rest)) {
        rest = rest.replace(QUOTE, "");
        depth += 1;
      } else if (LIST_MARK.test(rest)) {
        rest = rest.replace(LIST_MARK, "");
        marked = true;
      } else break;
    }
    const quoted = depth > 0;
    const indent = /^[ \t]*/.exec(rest)?.[0] ?? "";
    const fenceText = rest.slice(indent.length);
    const open = FENCE_OPEN.exec(fenceText);
    // CommonMark: der Info-String eines Backtick-Zauns darf keinen Backtick enthalten ("```x``` text" ist kein Zaun).
    if (!open || (open[1][0] === "`" && fenceText.slice(open[1].length).includes("`"))) {
      i += 1;
      continue;
    }
    const nested = quoted || marked || indent.includes("\t") || indent.length > 3 || (indent.length > 0 && containersBefore(lines, i).list);
    const marker = open[1];
    const closeRe = new RegExp(`^\\s*${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
    const col = lines[i].length - fenceText.length;
    let j = i + 1;
    let closed = false;
    const body: string[] = [];
    while (j < lines.length) {
      const stripped = stripQuotes(lines[j]);
      // Zitat-Tiefe: der Zaun endet, sobald die Tiefe unter die des Zaunbeginns fällt.
      if (quoted && stripped.depth < depth) break;
      if (!quoted && nested && lines[j].trim() !== "" && /^[ \t]*/.exec(lines[j])![0].length < col) break;
      if (closeRe.test(stripped.rest) && (nested || /^ {0,3}\S/.test(stripped.rest))) {
        closed = true;
        break;
      }
      body.push(stripped.rest.trim());
      j += 1;
    }
    let to = closed ? j : j - 1;
    while (!closed && to > i && stripQuotes(lines[to]).rest.trim() === "") to -= 1;
    out.push({ lang: open[2].toLowerCase(), from: i, to, nested, closed, body: body.join("\n") });
    i = to + 1;
  }
  return out;
}

const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const ALONE_LINE = /^ {0,3}!\[\[[^\]]*\]\]\s*$/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const THEMATIC = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;

/** Zustand der Container (offener Listenpunkt / offenes Zitat) NACH den Zeilen vor `index`. */
function containersBefore(lines: string[], index: number): { list: boolean; quote: boolean } {
  let list = false;
  let quote = false;
  for (let k = 0; k < index; k++) {
    const l = lines[k];
    if (l.trim() === "") {
      quote = false;
      continue;
    }
    quote = /^\s*>/.test(l);
    if (LIST_LINE.test(l)) list = true;
    else if (!/^\s/.test(l) && !quote && (k === 0 || lines[k - 1].trim() === "" || HEADING.test(lines[k - 1]) || THEMATIC.test(lines[k - 1]))) list = false;
  }
  return { list, quote };
}

/**
 * Konservative WHITELIST: ein Embed ist nur dann "alone" (durch einen Zaun ersetzbar), wenn die Zeile nur
 * aus ihm besteht (Spalte 0..3, kein Tab) UND die Zeile davor ein sicherer Absatzbruch ist: Dateianfang,
 * Leerzeile, ATX-Überschrift, Trennlinie, Schlusszeile eines Zauns auf oberster Ebene, schließendes `$$`
 * oder ein selbst alleinstehender Embed. Zusätzlich: ist ein Listenpunkt offen (offen ab Markerzeile bis zu
 * einer nicht leeren Zeile in Spalte 0, die kein Marker ist), ist nur Spalte 0 nach einer Leerzeile sicher
 * (sie beendet die Liste); ein Zitat endet an Leerzeile bzw. Zeile ohne `>`. Alles andere: "continuation".
 */
function aloneReason(lines: string[], index: number, match: string, fences: ScannedFence[]): AloneReason | undefined {
  const line = lines[index];
  const at = line.indexOf(match);
  const before = line.slice(0, at);
  const after = line.slice(at + match.length);
  if (before.includes("|") || after.includes("|")) return "table";
  if (/^\s*>/.test(line)) return "quote";
  if (LIST_LINE.test(line)) return "list";
  if (before.includes("\t") || /^ {4,}/.test(line)) return "indent";
  if (line.trim() !== match) return "inline";
  const { list } = containersBefore(lines, index);
  if (list && /^\s/.test(line)) return "continuation";
  const p = index - 1;
  if (p < 0 || lines[p].trim() === "") return undefined;
  const prev = lines[p];
  if (HEADING.test(prev) || THEMATIC.test(prev)) return undefined;
  if (fences.some((f) => f.to === p && f.closed && !f.nested)) return undefined;
  if (prev.trim() === "$$" && lines.slice(0, p + 1).filter((l) => l.trim() === "$$").length % 2 === 0) return undefined;
  if (ALONE_LINE.test(prev) && aloneReason(lines, p, prev.trim(), fences) === undefined) return undefined;
  return "continuation";
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
    const fences = scanFences(lines);
    for (const fence of fences) {
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
          nested: fence.nested,
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
        const reason = aloneReason(lines, index, match[0], fences);
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

/**
 * Sicherheitsnetz, unabhängig vom Markdown-Parser: jede Zeile, die den Dateinamen MIT Endung (ohne
 * Beachtung der Groß-/Kleinschreibung; auch in URL-kodierter Form, wie sie `![](a%20b.shapes)` trägt)
 * enthält und von keinem gefundenen Verweis abgedeckt ist. Der Aufrufer lehnt dann ab. Bewusst grob:
 * derselbe Dateiname in einem anderen Ordner, Fließtext, Fremdzäune und HTML-Kommentare werden ebenfalls
 * gemeldet — ein Treffer über den Basisnamen lässt sich nicht unterscheiden. `file:`-Werte ohne Endung
 * lösen (getFirstLinkpathDest) nie auf eine .shapes-Datei auf, deshalb genügt der Name mit Endung.
 */
export function unaccountedMentions(
  notes: readonly NoteText[],
  targetPath: string,
  refs: readonly ModelReference[],
): { notePath: string; line: number; text: string }[] {
  const fold = (t: string) => t.normalize("NFC").toLowerCase();
  const base = fold(targetPath.slice(targetPath.lastIndexOf("/") + 1));
  if (base === "") return [];
  const needleSet = new Set<string>();
  const addEncoded = (name: string) => {
    needleSet.add(name);
    needleSet.add(name.replace(/\./g, "%2e"));
    try {
      const enc = encodeURIComponent(name).toLowerCase();
      needleSet.add(enc);
      needleSet.add(enc.replace(/\./g, "%2e"));
    } catch {
      // einzelnes Surrogat: URIError — diese Variante entfällt, das Netz darf nie werfen
    }
    needleSet.add(name.replace(/ /g, "%20"));
  };
  addEncoded(base);
  addEncoded(fold(targetPath.slice(targetPath.lastIndexOf("/") + 1).normalize("NFD")));
  const needles = [...needleSet].filter((n) => n !== "");
  /** Anzahl der Erwähnungen: Treffer aller Varianten, überlappende Treffer (z. B. zwei Schreibweisen
   *  derselben Erwähnung) werden zu einem Intervall verschmolzen und nur einmal gezählt. Die Indizes
   *  stammen aus der gefalteten Kopie und werden nur zum Zählen benutzt, nie zum Schneiden des Originals. */
  const countMentions = (lower: string): number => {
    const spans: [number, number][] = [];
    for (const n of needles) {
      for (let at = lower.indexOf(n); at !== -1; at = lower.indexOf(n, at + 1)) spans.push([at, at + n.length]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    let count = 0;
    let end = -1;
    for (const [from, to] of spans) {
      if (from >= end) count += 1;
      end = Math.max(end, to);
    }
    return count;
  };
  const out: { notePath: string; line: number; text: string }[] = [];
  for (const note of notes) {
    const mine = refs.filter((r) => r.notePath === note.path);
    note.text.split(/\r?\n/).forEach((text, line) => {
      const mentions = countMentions(fold(text));
      if (mentions === 0) return;
      // Erlaubt: je Embed/Link dieser Zeile eine Erwähnung, je Block, der die Zeile überdeckt, eine.
      let allowed = 0;
      for (const r of mine) {
        if (r.kind === "block") {
          if (line >= r.from && line <= r.to) allowed += 1;
        } else if (r.from === line) allowed += 1;
      }
      if (mentions > allowed) out.push({ notePath: note.path, line, text });
    });
  }
  return out;
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
