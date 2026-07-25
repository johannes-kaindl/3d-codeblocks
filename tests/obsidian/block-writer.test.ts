import { describe, expect, it, vi } from "vitest";
import {
  BlockChangedError,
  writeBlockBody,
  type BlockLocation,
} from "../../src/obsidian/block-writer";

const NOTE = ["# Note", "", "```3d", "file: a.glb", "```", "", "text below"].join("\n");
const LOC: BlockLocation = { path: "note.md", lineStart: 2, lineEnd: 4 };

function makePorts(content = NOTE, withEditor = false) {
  const state = { content };
  const editor = {
    getValue: () => state.content,
    replaceRange: vi.fn((text: string, from: any, to: any) => {
      const lines = state.content.split("\n");
      const before = lines.slice(0, from.line);
      const after = lines.slice(to.line + 1);
      state.content = [...before, ...text.split("\n"), ...after].join("\n");
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

  it("refuses to write when the block moved out of the file", async () => {
    const { state, ports } = makePorts("short file");
    await expect(
      writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top"),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(state.content).toBe("short file");
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
  // nutzlos).
  it("accepts a CRLF note when the content is otherwise identical", async () => {
    const crlfNote = NOTE.replace(/\n/g, "\r\n");
    const { state, ports } = makePorts(crlfNote);
    await writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top");
    expect(state.content).toContain("file: a.glb\nview: top");
    expect(state.content).toContain("text below");
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
});
