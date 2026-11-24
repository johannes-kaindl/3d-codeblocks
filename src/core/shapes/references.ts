// Wer verwendet eine Modell-Datei? Pure. Gebraucht vor dem Umwandeln Datei → Block: nur
// bei genau EINEM Verweis ist es ein Umzug; bei mehr entstünde eine zweite Wahrheit oder
// ein toter Verweis (Spec § 5.2). Obsidian indiziert Codeblock-Inhalte nicht als Links —
// deshalb ein eigener Textlauf über ```3d-Blöcke UND Embeds, mit EINER Auflösungsfunktion
// von außen, damit beide Wege dieselbe Wikilink-Semantik haben.
// Ein übersehener Verweis lässt Datei → Block eine noch benutzte Datei löschen: im Zweifel zählen.
import { parseBlockConfig } from "../block-config";
import { listAllFences, wrapInFence } from "../../vendor/kit/fences";

export interface NoteText {
  path: string;
  text: string;
}

export type AloneReason = "list" | "quote" | "indent" | "inline" | "table" | "continuation" | "markdown-embed";

/**
 * `nested`: der Block steht in einem Zitat/Callout oder einer Liste. Obsidian
 * rendert ihn, aber ein Ersatz an Spalte 0 würde die Struktur zerreißen — der Aufrufer lehnt ab.
 * `aloneReason` (nur gesetzt, wenn `alone` falsch ist): warum der Embed nicht ersetzbar ist.
 * `link`: einfacher Wikilink ohne `!` — nie ersetzbar, aber nach dem Löschen der Datei tot.
 */
export type ModelReference =
  | { notePath: string; kind: "block"; from: number; to: number; text: string; nested: boolean }
  | { notePath: string; kind: "embed"; from: number; to: number; text: string; alone: boolean; aloneReason?: AloneReason; options?: string }
  | { notePath: string; kind: "link"; from: number; to: number; text: string };

// `\|` (maskierter Strich in Tabellen) wird akzeptiert; der Linktext verliert den Backslash.
// Linear auch bei Zeilen voller `[[` ohne Abschluss (Fuzz `tests/core/linear-fuzz.test.ts`): der Name enthält kein `[` (Obsidian erlaubt es in Dateinamen nicht),
// der Anzeigeteil hört vor jedem `[[` auf. Ohne beides läuft jede der n Startstellen bis ans Zeilenende (n = 10 000: 2,5 s, quadratisch).
const WIKI = /(!?)\[\[([^[\]|#^]+)(?:[#^|](?:[^\][]|\[(?!\[))*)?\]\]/g;
// `![alt](pfad)` / `![](<pfad mit leerzeichen>)` — Obsidians Embed-Registry rendert registrierte
// Erweiterungen auch in dieser Schreibweise (embed.ts:67 MODEL_EXTENSIONS, registerExtension).
// Gleiche Bauart: der Alt-Text hört vor jedem `![` auf, der Pfad enthält weder `(` noch `<` (spitze Klammern nur als Umschließung), sonst liefe jede Startstelle bis ans Zeilenende.
const MD_EMBED = /!\[(?:(?!!\[)[^\]])*\]\((<[^<>]*>|[^()\s<]*)\)/g;

interface ScannedFence {
  lang: string;
  from: number;
  to: number;
  nested: boolean;
  /** true, wenn eine echte Schlusszeile gefunden wurde (nicht implizit/EOF geschlossen). */
  closed: boolean;
  body: string;
}

/**
 * Alle Zäune einer Notiz, flach und verschachtelt, aus dem Kit-Leser `listAllFences` (code-kit 0.87.0; dieselbe Lesart wie `countFences` und `findNestedFenceAt`).
 * Zwei Dinge liest das Kit nicht und bleiben hier, mit Grund:
 * - `nested` ist hier weiter als beim Kit: auch ein Zaun auf der Zeile eines Listenmarkers (`- ```3d`, im Kit flach) und ein eingerückter Zaun unter einem
 *   offenen Listenpunkt gelten als verschachtelt, denn ein Ersatz an Spalte 0 würde die Liste zerreißen (der Aufrufer lehnt dann ab).
 * - Ein nicht geschlossener Zaun endet beim Kit auf der letzten Zeile seines Zitats oder der Notiz; `to` schneidet die leeren Schlusszeilen ab, damit ein Ersatz
 *   keine Leerzeilen mitnimmt, die nicht zum Zaun gehören.
 */
function scanFences(lines: string[]): ScannedFence[] {
  const containers = containerTracker(lines);
  return listAllFences(lines.join("\n")).map((f) => {
    const open = lines[f.openLine] ?? "";
    const flatStart = /^ {0,3}(?:`{3,}|~{3,})/.test(open);
    const indented = /^[ \t]+/.test(open) && containers(f.openLine).list;
    let to = f.closeLine;
    while (!f.closed && to > f.openLine && (lines[to] ?? "").replace(/^(?:\s*>[ ]?)+/, "").trim() === "") to -= 1;
    return { lang: f.lang, from: f.openLine, to, nested: f.nested || !flatStart || indented, closed: f.closed, body: f.body };
  });
}

const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const ALONE_LINE = /^ {0,3}!\[\[[^\]]*\]\]\s*$/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const THEMATIC = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;

/** Zustand der Container (offener Listenpunkt / offenes Zitat) NACH den Zeilen vor `index`.
 *  Läuft von der zuletzt erreichten Zeile weiter statt je Aufruf bei 0 anzufangen: bei steigendem `index` (jede Zaunzeile, jeder Embed einer Notiz)
 *  ist die Gesamtarbeit linear; ein kleinerer `index` (der Blick auf die Zeile davor) beginnt neu. Vorher war jeder eingerückte Zaun ein Lauf über alle
 *  Zeilen davor (20 000 Zeilen mit Zäunen: 2,4 s, Fuzz Welle 36). */
function containerTracker(lines: string[]): (index: number) => { list: boolean; quote: boolean } {
  let k = 0;
  let list = false;
  let quote = false;
  return (index) => {
    if (index < k) {
      k = 0;
      list = false;
      quote = false;
    }
    for (; k < index; k++) {
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
  };
}

/**
 * Konservative WHITELIST: ein Embed ist nur dann "alone" (durch einen Zaun ersetzbar), wenn die Zeile nur
 * aus ihm besteht (Spalte 0..3, kein Tab) UND die Zeile davor ein sicherer Absatzbruch ist: Dateianfang,
 * Leerzeile, ATX-Überschrift, Trennlinie, Schlusszeile eines Zauns auf oberster Ebene, schließendes `$$`
 * oder ein selbst alleinstehender Embed. Zusätzlich: ist ein Listenpunkt offen (offen ab Markerzeile bis zu
 * einer nicht leeren Zeile in Spalte 0, die kein Marker ist), ist nur Spalte 0 nach einer Leerzeile sicher
 * (sie beendet die Liste); ein Zitat endet an Leerzeile bzw. Zeile ohne `>`. Alles andere: "continuation".
 */
function aloneReason(lines: string[], index: number, match: string, fences: ScannedFence[], containers: (index: number) => { list: boolean; quote: boolean }): AloneReason | undefined {
  const line = lines[index];
  const at = line.indexOf(match);
  const before = line.slice(0, at);
  const after = line.slice(at + match.length);
  if (before.includes("|") || after.includes("|")) return "table";
  if (/^\s*>/.test(line)) return "quote";
  if (LIST_LINE.test(line)) return "list";
  if (before.includes("\t") || /^ {4,}/.test(line)) return "indent";
  if (line.trim() !== match) return "inline";
  const { list } = containers(index);
  if (list && /^\s/.test(line)) return "continuation";
  const p = index - 1;
  if (p < 0 || lines[p].trim() === "") return undefined;
  const prev = lines[p];
  if (HEADING.test(prev) || THEMATIC.test(prev)) return undefined;
  if (fences.some((f) => f.to === p && f.closed && !f.nested)) return undefined;
  if (prev.trim() === "$$" && lines.slice(0, p + 1).filter((l) => l.trim() === "$$").length % 2 === 0) return undefined;
  if (ALONE_LINE.test(prev) && aloneReason(lines, p, prev.trim(), fences, containers) === undefined) return undefined;
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
    const containers = containerTracker(lines);
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
        const reason = aloneReason(lines, index, match[0], fences, containers);
        // Anzeigeoptionen (`|400`, `|alias`, `#Ueberschrift`, `^id`) hinter dem Linktext: ein Zaun kann sie nicht tragen.
        const options = match[0].slice(3, -2).slice(match[2].length).trim();
        refs.push({
          notePath: note.path,
          kind: "embed",
          from: index,
          to: index,
          text: line,
          alone: reason === undefined,
          ...(reason ? { aloneReason: reason } : {}),
          ...(options !== "" ? { options } : {}),
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
        refs.push({ notePath: note.path, kind: "embed", from: index, to: index, text: line, alone: false, aloneReason: "markdown-embed" });
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
  // Dieselbe Regel wie der Kit-Baustein (BOM, CRLF, Schlusszeilen, Zaunlänge): die eigene Kopie ist entfallen (Angleichen); Ausgabe unverändert.
  return wrapInFence("shapes", text);
}
