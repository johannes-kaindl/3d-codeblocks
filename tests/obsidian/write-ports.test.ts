import { describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile, makeFakeApp } from "../__mocks__/obsidian";
import { obsidianWritePorts } from "../../src/obsidian/write-ports";

// (c) Der Adapter darf die Zusicherung, auf der `writeBlockBody`s Guard beruht, nicht
// unterlaufen: `process` operiert auf wirklich frischem Inhalt (kein vorab gelesener,
// beim Aufbau eingefrorener Schnappschuss), und ein Wurf im Callback lehnt das
// zurueckgegebene Promise ab, statt geschluckt zu werden.
function makeApp(initialContent: string) {
  const file = new TFile();
  file.path = "note.md";
  const state = { content: initialContent };
  const app = makeFakeApp();
  app.vault.getAbstractFileByPath = vi.fn((path: string) => (path === file.path ? file : null));
  app.vault.read = vi.fn(async () => state.content);
  // Simuliert Obsidians "atomically read, modify, save": liest bei JEDEM Aufruf den
  // aktuellen Stand, nicht einen beim Testaufbau eingefrorenen. Ein Wurf in `fn`
  // propagiert unveraendert (kein try/catch) — genau das reale Vault.process-Verhalten.
  app.vault.process = vi.fn(async (f: TFile, fn: (data: string) => string) => {
    const next = fn(state.content);
    state.content = next;
    return next;
  });
  return { app, state, file };
}

describe("obsidianWritePorts", () => {
  describe("vault.process", () => {
    it("operates on the content at call time, not a stale snapshot from construction", async () => {
      const { app, state } = makeApp("A");
      const ports = obsidianWritePorts(app);

      // Aendert sich zwischen Aufbau der Ports und dem eigentlichen Schreibaufruf --
      // ein Adapter, der vorab liest und den alten Text festhaelt, wuerde ihn ueberschreiben.
      state.content = "B";
      await ports.vault.process("note.md", (text) => `${text}!`);

      expect(state.content).toBe("B!");
    });

    it("rejects the returned promise when the callback throws, without writing", async () => {
      const { app, state } = makeApp("A");
      const ports = obsidianWritePorts(app);

      await expect(
        ports.vault.process("note.md", () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(state.content).toBe("A");
    });

    it("rejects when the note is not found, without calling the vault", async () => {
      const { app } = makeApp("A");
      app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      const ports = obsidianWritePorts(app);

      await expect(ports.vault.process("missing.md", (text) => text)).rejects.toThrow(
        "Note not found: missing.md",
      );
      expect(app.vault.process).not.toHaveBeenCalled();
    });
  });

  describe("editorFor", () => {
    it("finds the editor of the open markdown leaf for the given path", () => {
      const { app, file } = makeApp("A");
      const view = new MarkdownView();
      view.file = file;
      const editor = { getValue: () => "" };
      view.editor = editor as any;
      app.workspace.getLeavesOfType = vi.fn().mockReturnValue([{ view }]);
      const ports = obsidianWritePorts(app);

      expect(ports.editorFor("note.md")).toBe(editor);
    });

    it("returns null when no open leaf shows that path", () => {
      const { app } = makeApp("A");
      app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
      const ports = obsidianWritePorts(app);

      expect(ports.editorFor("note.md")).toBeNull();
    });
  });
});
