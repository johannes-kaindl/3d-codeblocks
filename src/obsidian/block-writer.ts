// Schreibt den Rumpf eines Codeblocks zurueck in die Notiz — zweigleisig.
//
// 1. Notiz in einem sichtbaren Editor offen → `replaceRange`, damit Strg+Z wirkt.
// 2. Sonst → `vault.process` (atomar, funktioniert auch im Lesemodus).
//
// Beide Wege pruefen VOR dem Schreiben, ob an der gemerkten Stelle noch der Block
// steht, den wir gerendert haben. `getSectionInfo` kann veraltet sein, wenn
// zwischenzeitlich getippt wurde — ohne diese Pruefung wuerden fremde Zeilen
// ueberschrieben. Das ist der gefaehrlichste Fehler dieses Features und wird
// durch Vergleich statt durch Vertrauen ausgeschlossen.

/** Zeilen des Blocks: `lineStart` ist die ```-Zeile, `lineEnd` die schliessende. */
export interface BlockLocation {
  path: string;
  lineStart: number;
  lineEnd: number;
}

export interface EditorHandle {
  getValue(): string;
  replaceRange(
    text: string,
    from: { line: number; ch: number },
    to: { line: number; ch: number },
  ): void;
}

export interface VaultPort {
  read(path: string): Promise<string>;
  process(path: string, fn: (text: string) => string): Promise<void>;
}

export interface WritePorts {
  /** Editor der Datei, wenn sie in einem sichtbaren Blatt offen ist — sonst `null`. */
  editorFor(path: string): EditorHandle | null;
  vault: VaultPort;
}

export class BlockChangedError extends Error {
  constructor() {
    super("Note changed — view not saved");
    this.name = "BlockChangedError";
  }
}

/** Zeilen zwischen den Fences, oder `null`, wenn die Stelle nicht mehr passt. */
function bodyAt(content: string, loc: BlockLocation): string | null {
  const lines = content.split("\n");
  if (loc.lineEnd >= lines.length || loc.lineStart >= loc.lineEnd) return null;
  return lines.slice(loc.lineStart + 1, loc.lineEnd).join("\n");
}

// Obsidian liefert den gerenderten Blockquelltext immer mit \n, aber eine unter
// Windows gespeicherte Notiz kann auf der Platte \r\n enthalten. Ohne Normalisierung
// wuerde der Abgleich bei jedem Schreibversuch auf solchen Notizen fehlschlagen —
// fail-safe, aber dauerhaft nutzlos. \r\n → \n aendert die Zeilenzahl nicht, die
// Positionen in `loc` bleiben also gueltig. Normalisiert wird nur fuer den Vergleich;
// geschrieben wird immer der unveraenderte Text.
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function bodyMatches(content: string, loc: BlockLocation, expectedBody: string): boolean {
  return bodyAt(normalizeLineEndings(content), loc) === normalizeLineEndings(expectedBody);
}

function replaceBody(content: string, loc: BlockLocation, nextBody: string): string {
  const lines = content.split("\n");
  return [
    ...lines.slice(0, loc.lineStart + 1),
    ...nextBody.split("\n"),
    ...lines.slice(loc.lineEnd),
  ].join("\n");
}

export async function writeBlockBody(
  ports: WritePorts,
  loc: BlockLocation,
  expectedBody: string,
  nextBody: string,
): Promise<void> {
  const editor = ports.editorFor(loc.path);

  if (editor) {
    const content = editor.getValue();
    if (!bodyMatches(content, loc, expectedBody)) throw new BlockChangedError();

    const lines = content.split("\n");
    const lastBodyLine = loc.lineEnd - 1;
    editor.replaceRange(
      nextBody,
      { line: loc.lineStart + 1, ch: 0 },
      { line: lastBodyLine, ch: lines[lastBodyLine].length },
    );
    return;
  }

  const content = await ports.vault.read(loc.path);
  if (!bodyMatches(content, loc, expectedBody)) throw new BlockChangedError();

  await ports.vault.process(loc.path, (current) => {
    // Zwischen `read` und `process` kann sich die Datei geaendert haben — erneut pruefen.
    if (!bodyMatches(current, loc, expectedBody)) throw new BlockChangedError();
    return replaceBody(current, loc, nextBody);
  });
}
