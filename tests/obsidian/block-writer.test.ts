import { describe, expect, it, vi } from "vitest";
import {
  BlockChangedError,
  replaceLines,
  writeBlockBody,
  type BlockLocation,
} from "../../src/obsidian/block-writer";

const NOTE = ["# Note", "", "```3d", "file: a.glb", "```", "", "text below"].join("\n");
const LOC: BlockLocation = { path: "note.md", lineStart: 2, lineEnd: 4, fence: "3d" };

// {line, ch} → Zeichen-Offset im Gesamttext. Wichtig: eine Mock-Version, die
// stattdessen ganze Zeilen spleisst und `ch` ignoriert, kann eine falsche
// Spaltenarithmetik (z. B. ein invertierter Bereich) nicht erkennen — sie
// wuerde zufaellig trotzdem das Richtige tun.
function toOffset(text: string, pos: { line: number; ch: number }): number {
  const lines = text.split("\n");
  const before = lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0);
  return before + pos.ch;
}

function makePorts(content = NOTE, withEditor = false) {
  const state = { content };
  const editor = {
    getValue: () => state.content,
    replaceRange: vi.fn((text: string, from: any, to: any) => {
      const fromOffset = toOffset(state.content, from);
      const toOffsetVal = toOffset(state.content, to);
      // Ein echter Editor lehnt einen invertierten Bereich ab (oder tauscht ihn
      // stillschweigend) — beides ist falsch fuer unseren Zweck. Wir validieren
      // wie die strengere Variante, damit ein invertierter Bereich hier auffliegt
      // statt zufaellig das richtige Ergebnis zu erzeugen.
      if (fromOffset > toOffsetVal) {
        throw new RangeError("replaceRange: from is after to");
      }
      state.content = state.content.slice(0, fromOffset) + text + state.content.slice(toOffsetVal);
    }),
  };
  return {
    state,
    editor,
    ports: {
      editorFor: (path: string) => (withEditor && path === "note.md" ? editor : null),
      vault: {
        read: async () => state.content,
        process: async (_path: string, fn: (text: string) => string) => {
          state.content = fn(state.content);
        },
      },
    },
  };
}

describe("writeBlockBody", () => {
  it("replaces the block body through the vault when no editor is open", async () => {
    const { state, ports } = makePorts();
    await writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top");
    expect(state.content).toContain("```3d\nfile: a.glb\nview: top\n```");
    expect(state.content).toContain("text below");
  });

  it("uses the editor when the note is open, so undo works", async () => {
    const { state, editor, ports } = makePorts(NOTE, true);
    await writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top");
    expect(editor.replaceRange).toHaveBeenCalled();
    expect(state.content).toContain("view: top");
  });

  it("refuses to write when the note changed underneath", async () => {
    const changed = NOTE.replace("file: a.glb", "file: SOMETHING-ELSE.glb");
    const { state, ports } = makePorts(changed);
    await expect(
      writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top"),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(state.content).toBe(changed);
  });

  it("refuses to write via the editor when the note changed underneath, without touching the buffer", async () => {
    const changed = NOTE.replace("file: a.glb", "file: SOMETHING-ELSE.glb");
    const { state, editor, ports } = makePorts(changed, true);
    await expect(
      writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top"),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(state.content).toBe(changed);
  });

  it("refuses to write when the block moved out of the file", async () => {
    const { state, ports } = makePorts("short file");
    await expect(
      writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top"),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(state.content).toBe("short file");
  });

  it("refuses to write when the location has a negative line number", async () => {
    const { state, ports } = makePorts();
    await expect(
      writeBlockBody(
        ports,
        { path: "note.md", lineStart: -3, lineEnd: 1, fence: "3d" },
        "",
        "view: top",
      ),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(state.content).toBe(NOTE);
  });

  it("handles a multi-line body", async () => {
    const note = ["```3d", "file: a.glb", "view: front", "title: X", "```"].join("\n");
    const { state, ports } = makePorts(note);
    await writeBlockBody(
      ports,
      { path: "note.md", lineStart: 0, lineEnd: 4, fence: "3d" },
      "file: a.glb\nview: front\ntitle: X",
      "file: a.glb\nview: top\ntitle: X",
    );
    expect(state.content).toBe(["```3d", "file: a.glb", "view: top", "title: X", "```"].join("\n"));
  });

  // Obsidian liefert den gerenderten Blockquelltext immer mit \n. Eine unter
  // Windows gespeicherte Notiz kann auf der Platte \r\n enthalten. Der
  // Abgleich vor dem Schreiben darf darauf nicht hereinfallen — sonst
  // schlaegt jeder Schreibversuch bei solchen Notizen fehl (fail-safe, aber
  // nutzlos). Der geschriebene Text muss dabei aber Zeilenumbruch-einheitlich
  // bleiben — nicht nur der Abgleich, auch das Ergebnis.
  it("accepts a CRLF note when the content is otherwise identical, and keeps the whole note CRLF", async () => {
    const crlfNote = NOTE.replace(/\n/g, "\r\n");
    const { state, ports } = makePorts(crlfNote);
    await writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top");
    expect(state.content).toBe(
      "# Note\r\n\r\n```3d\r\nfile: a.glb\r\nview: top\r\n```\r\n\r\ntext below",
    );
  });

  it("still refuses to write when a CRLF note genuinely changed", async () => {
    const changedCrlf = NOTE.replace("file: a.glb", "file: SOMETHING-ELSE.glb").replace(
      /\n/g,
      "\r\n",
    );
    const { state, ports } = makePorts(changedCrlf);
    await expect(
      writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top"),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(state.content).toBe(changedCrlf);
  });

  // Fences direkt aneinander (leerer Rumpf, keine Zeile dazwischen) ist ein
  // erreichbarer Fall — `block-edit.ts` behandelt eine leere Blockquelle
  // explizit als Sonderfall. Beide Schreibwege muessen zum selben Ergebnis
  // kommen; der Editor-Weg darf dabei keinen invertierten Bereich bauen.
  describe("adjacent fences (empty body)", () => {
    const note = ["```3d", "```"].join("\n");
    const loc: BlockLocation = { path: "note.md", lineStart: 0, lineEnd: 1, fence: "3d" };

    it("inserts the body through the vault", async () => {
      const { state, ports } = makePorts(note);
      await writeBlockBody(ports, loc, "", "view: top");
      expect(state.content).toBe(["```3d", "view: top", "```"].join("\n"));
    });

    it("inserts the body through the editor without inverting the range", async () => {
      const { state, ports } = makePorts(note, true);
      await writeBlockBody(ports, loc, "", "view: top");
      expect(state.content).toBe(["```3d", "view: top", "```"].join("\n"));
    });
  });

  // (a) Ein einzeiliger Rumpf aus einer CRLF-Notiz kommt bei Obsidian moeglicherweise
  // mit einem einzelnen, nicht gepaarten \r am Ende an: das Fragment wird per
  // split("\n") + slice + join gewonnen, nur die letzte Zeile verliert dabei ihr
  // trennendes \n, das \r bleibt als Suffix haengen (siehe Kommentar bei `bodyAt`
  // in block-writer.ts). Ohne Toleranz dafuer wuerde der Abgleich mit dem sauber
  // normalisierten Inhalt der Notiz fuer immer scheitern -- Speichern waere auf
  // CRLF-Notizen mit einzeiligem Rumpf dauerhaft tot.
  it("tolerates a lone trailing \\r in expectedBody (CRLF fragment, unpaired \\r)", async () => {
    const note = ["```3d", "file: a.glb", "```"].join("\n");
    const loc: BlockLocation = { path: "note.md", lineStart: 0, lineEnd: 2, fence: "3d" };
    const { state, ports } = makePorts(note);
    await writeBlockBody(ports, loc, "file: a.glb\r", "file: a.glb\nview: top");
    expect(state.content).toBe(["```3d", "file: a.glb", "view: top", "```"].join("\n"));
  });

  // (b) Der Fingerabdruck darf sich nicht allein auf den Rumpf verlassen: bei einem
  // leeren Rumpf ist er fuer JEDEN Block an dieser Zeile identisch (die leere
  // Zeichenkette) -- eine veraltete Position, die zufaellig auf einen fremden
  // ```python- oder ```mermaid-Block zeigt, wuerde sonst den Guard passieren.
  describe("fence guard", () => {
    it("writes when the fence language matches (case-insensitive, trimmed)", async () => {
      const note = ["```3D ", "file: a.glb", "```"].join("\n");
      const loc: BlockLocation = { path: "note.md", lineStart: 0, lineEnd: 2, fence: "3d" };
      const { state, ports } = makePorts(note);
      await writeBlockBody(ports, loc, "file: a.glb", "file: a.glb\nview: top");
      expect(state.content).toBe(["```3D ", "file: a.glb", "view: top", "```"].join("\n"));
    });

    it("refuses when the fence at that position is a different language, leaving the content unchanged", async () => {
      const note = ["```python", "file: a.glb", "```"].join("\n");
      const loc: BlockLocation = { path: "note.md", lineStart: 0, lineEnd: 2, fence: "3d" };
      const { state, ports } = makePorts(note);
      await expect(
        writeBlockBody(ports, loc, "file: a.glb", "file: a.glb\nview: top"),
      ).rejects.toBeInstanceOf(BlockChangedError);
      expect(state.content).toBe(note);
    });

    it("refuses through the editor path too, without touching the buffer", async () => {
      const note = ["```mermaid", "file: a.glb", "```"].join("\n");
      const loc: BlockLocation = { path: "note.md", lineStart: 0, lineEnd: 2, fence: "3d" };
      const { state, editor, ports } = makePorts(note, true);
      await expect(
        writeBlockBody(ports, loc, "file: a.glb", "file: a.glb\nview: top"),
      ).rejects.toBeInstanceOf(BlockChangedError);
      expect(editor.replaceRange).not.toHaveBeenCalled();
      expect(state.content).toBe(note);
    });

    // Tilde-Fences sind gueltiges CommonMark und Obsidian rendert sie -- ein Block
    // waere sonst rendersichtbar, aber niemals speicherbar.
    it("writes when the fence uses tildes instead of backticks", async () => {
      const note = ["~~~3d", "file: a.glb", "~~~"].join("\n");
      const loc: BlockLocation = { path: "note.md", lineStart: 0, lineEnd: 2, fence: "3d" };
      const { state, ports } = makePorts(note);
      await writeBlockBody(ports, loc, "file: a.glb", "file: a.glb\nview: top");
      expect(state.content).toBe(["~~~3d", "file: a.glb", "view: top", "~~~"].join("\n"));
    });

    // Nur das erste Token des Info-Strings zaehlt -- weitere Woerter (z. B. ein vom
    // Nutzer angehaengter Kommentar) duerfen den Guard nicht auf ewig verriegeln.
    it("writes when the info string carries a trailing token after the language", async () => {
      const note = ["```3d extra", "file: a.glb", "```"].join("\n");
      const loc: BlockLocation = { path: "note.md", lineStart: 0, lineEnd: 2, fence: "3d" };
      const { state, ports } = makePorts(note);
      await writeBlockBody(ports, loc, "file: a.glb", "file: a.glb\nview: top");
      expect(state.content).toBe(["```3d extra", "file: a.glb", "view: top", "```"].join("\n"));
    });
  });
});

describe("replaceLines", () => {
  const RNOTE = "# T\n```shapes\nbox A size 1\n```\nEnde";
  const FENCE = "```shapes\nbox A size 1\n```";

  it("replaces a whole fence through the vault", async () => {
    const { state, ports } = makePorts(RNOTE);
    await replaceLines(ports, "note.md", 1, 3, FENCE, "```3d\nfile: a.shapes\n```");
    expect(state.content).toBe("# T\n```3d\nfile: a.shapes\n```\nEnde");
  });

  it("replaces through an open editor", async () => {
    const { state, editor, ports } = makePorts(RNOTE, true);
    await replaceLines(ports, "note.md", 1, 3, FENCE, "X");
    expect(editor.replaceRange).toHaveBeenCalled();
    expect(state.content).toBe("# T\nX\nEnde");
  });

  it("refuses when the lines changed in the meantime (vault and editor, buffer untouched)", async () => {
    const changed = RNOTE.replace("size 1", "size 2");
    for (const withEditor of [false, true]) {
      const { state, editor, ports } = makePorts(changed, withEditor);
      await expect(replaceLines(ports, "note.md", 1, 3, FENCE, "X")).rejects.toBeInstanceOf(
        BlockChangedError,
      );
      expect(editor.replaceRange).not.toHaveBeenCalled();
      expect(state.content).toBe(changed);
    }
  });

  it("refuses when the note is shorter than `to`", async () => {
    const { state, ports } = makePorts("# T\n```shapes");
    await expect(replaceLines(ports, "note.md", 1, 3, FENCE, "X")).rejects.toBeInstanceOf(
      BlockChangedError,
    );
    expect(state.content).toBe("# T\n```shapes");
  });

  it("refuses when the range moved by one line (line inserted above)", async () => {
    for (const withEditor of [false, true]) {
      const moved = "new\n" + RNOTE;
      const { state, ports } = makePorts(moved, withEditor);
      await expect(replaceLines(ports, "note.md", 1, 3, FENCE, "X")).rejects.toBeInstanceOf(
        BlockChangedError,
      );
      expect(state.content).toBe(moved);
    }
  });

  it("refuses when expected differs only in trailing whitespace", async () => {
    const { state, ports } = makePorts(RNOTE.replace("size 1", "size 1 "));
    await expect(replaceLines(ports, "note.md", 1, 3, FENCE, "X")).rejects.toBeInstanceOf(
      BlockChangedError,
    );
    expect(state.content).toBe(RNOTE.replace("size 1", "size 1 "));
  });

  it("keeps CRLF notes CRLF (LF expected is a match), vault and editor", async () => {
    for (const withEditor of [false, true]) {
      const { state, ports } = makePorts(RNOTE.replace(/\n/g, "\r\n"), withEditor);
      await replaceLines(ports, "note.md", 1, 3, FENCE, "a\nb");
      expect(state.content).toBe("# T\r\na\r\nb\r\nEnde");
    }
  });

  it("treats CRLF in `expected` against an LF note as a match", async () => {
    const { state, ports } = makePorts(RNOTE);
    await replaceLines(ports, "note.md", 1, 3, FENCE.replace(/\n/g, "\r\n"), "a\r\nb");
    expect(state.content).toBe("# T\na\nb\nEnde");
  });

  it("aborts when the content changes between the check and the write (inside process)", async () => {
    const state = { content: RNOTE };
    const racing = {
      editorFor: () => null,
      vault: {
        read: async () => state.content,
        process: async (_p: string, fn: (t: string) => string) => {
          state.content = RNOTE.replace("size 1", "size 9"); // sync/linter strikes here
          state.content = fn(state.content);
        },
      },
    };
    await expect(replaceLines(racing, "note.md", 1, 3, FENCE, "X")).rejects.toBeInstanceOf(
      BlockChangedError,
    );
    expect(state.content).toBe(RNOTE.replace("size 1", "size 9"));
  });

  it("refuses from > to, negative from, non-integers, without writing", async () => {
    for (const [from, to] of [[3, 1], [-1, 2], [1.5, 3], [1, Number.NaN]] as const) {
      const { state, ports } = makePorts(RNOTE);
      await expect(replaceLines(ports, "note.md", from, to, FENCE, "X")).rejects.toBeInstanceOf(
        BlockChangedError,
      );
      expect(state.content).toBe(RNOTE);
    }
  });

  it("keeps a BOM at the start of the note", async () => {
    const { state, ports } = makePorts("\uFEFF" + RNOTE);
    await replaceLines(ports, "note.md", 1, 3, FENCE, "X");
    expect(state.content).toBe("\uFEFF# T\nX\nEnde");
  });

  it("does not add a final newline when the note has none, and keeps one when present", async () => {
    const a = makePorts("a\nb");
    await replaceLines(a.ports, "note.md", 1, 1, "b", "X\nY");
    expect(a.state.content).toBe("a\nX\nY");
    const b = makePorts("a\nb\n");
    await replaceLines(b.ports, "note.md", 1, 1, "b", "X");
    expect(b.state.content).toBe("a\nX\n");
    const c = makePorts("a\nb\n", true);
    await replaceLines(c.ports, "note.md", 1, 1, "b", "X");
    expect(c.state.content).toBe("a\nX\n");
  });

  // Entscheidung: eine leere Ersetzung ist erlaubt und ersetzt den Bereich durch EINE
  // leere Zeile (Zeilenzahl-Logik: "" ist eine Zeile). Wer Zeilen loeschen will, nimmt
  // einen anderen Weg; hier wird nie still eine Zeilenzahl veraendert, die ein
  // Aufrufer nicht erwartet.
  it("an empty replacement leaves one empty line (documented behaviour)", async () => {
    const { state, ports } = makePorts(RNOTE);
    await replaceLines(ports, "note.md", 1, 3, FENCE, "");
    expect(state.content).toBe("# T\n\nEnde");
    const e = makePorts(RNOTE, true);
    await replaceLines(e.ports, "note.md", 1, 3, FENCE, "");
    expect(e.state.content).toBe("# T\n\nEnde");
  });
});

// Fix round 1: replaceLines darf ausserhalb von from..to kein Byte aendern.
describe("replaceLines: untouched surroundings and BOM", () => {
  // Stil-Regel: dominanter Stil der Notiz laut lineEndingSignal (enthaelt irgendwo
  // \r\n -> CRLF, sonst LF); Zeilen ausserhalb des Bereichs bleiben unveraendert.
  const MIXED = ["l0\r", "l1", "l2\rx", "A\r", "B", "l5\r", "l6", "l7"].join("\n");

  it("leaves every line outside the range byte-identical (middle range)", async () => {
    const { state, ports } = makePorts(MIXED);
    await replaceLines(ports, "note.md", 3, 4, "A\nB", "X\nY\nZ");
    expect(state.content).toBe(["l0\r", "l1", "l2\rx", "X\r", "Y\r", "Z\r", "l5\r", "l6", "l7"].join("\n"));
  });

  it("leaves the rest identical for the first and the last lines", async () => {
    const first = makePorts(MIXED);
    await replaceLines(first.ports, "note.md", 0, 0, "l0", "F");
    expect(first.state.content).toBe(["F\r", ...MIXED.split("\n").slice(1)].join("\n"));
    const last = makePorts(MIXED);
    await replaceLines(last.ports, "note.md", 7, 7, "l7", "L");
    // last line had no \r and no trailing newline: none is added
    expect(last.state.content).toBe([...MIXED.split("\n").slice(0, 7), "L"].join("\n"));
  });

  it("editor path: lone \\r in an unrelated line and inside the range is handled consistently", async () => {
    const { state, ports } = makePorts(MIXED, true);
    await replaceLines(ports, "note.md", 2, 3, "l2x\nA", "X");
    expect(state.content).toBe(["l0\r", "l1", "X\r", "B", "l5\r", "l6", "l7"].join("\n"));
    const e2 = makePorts(MIXED, true);
    await replaceLines(e2.ports, "note.md", 3, 4, "A\nB", "X\nY");
    expect(e2.state.content).toBe(["l0\r", "l1", "l2\rx", "X\r", "Y", "l5\r", "l6", "l7"].join("\n"));
  });

  it("a block on line 0 of a BOM note converts, expected with or without BOM, BOM kept", async () => {
    const note = "\uFEFF```shapes\nbox A size 1\n```\nEnde";
    for (const withEditor of [false, true]) {
      for (const exp of [FENCE0, "\uFEFF" + FENCE0]) {
        const { state, ports } = makePorts(note, withEditor);
        await replaceLines(ports, "note.md", 0, 2, exp, "X");
        expect(state.content).toBe("\uFEFFX\nEnde");
      }
    }
  });
});
const FENCE0 = "```shapes\nbox A size 1\n```";
