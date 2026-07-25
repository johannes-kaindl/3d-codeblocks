import { describe, expect, it, vi } from "vitest";
import {
  BlockChangedError,
  writeBlockBody,
  type BlockLocation,
} from "../../src/obsidian/block-writer";

const NOTE = ["# Note", "", "```3d", "file: a.glb", "```", "", "text below"].join("\n");
const LOC: BlockLocation = { path: "note.md", lineStart: 2, lineEnd: 4 };

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
      writeBlockBody(ports, { path: "note.md", lineStart: -3, lineEnd: 1 }, "", "view: top"),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(state.content).toBe(NOTE);
  });

  it("handles a multi-line body", async () => {
    const note = ["```3d", "file: a.glb", "view: front", "title: X", "```"].join("\n");
    const { state, ports } = makePorts(note);
    await writeBlockBody(
      ports,
      { path: "note.md", lineStart: 0, lineEnd: 4 },
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
    const loc: BlockLocation = { path: "note.md", lineStart: 0, lineEnd: 1 };

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
});
