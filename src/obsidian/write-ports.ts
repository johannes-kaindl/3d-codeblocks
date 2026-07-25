// Die Obsidian-Seite der Schreib-Ports aus `block-writer.ts`. Bewusst winzig:
// alle Entscheidungen liegen im testbaren Schreiber, hier ist nur der Zugriff.
import { MarkdownView, TFile, type App } from "obsidian";
import type { EditorHandle, WritePorts } from "./block-writer";

export function obsidianWritePorts(app: App): WritePorts {
  return {
    editorFor(path: string): EditorHandle | null {
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file?.path === path) return view.editor;
      }
      return null;
    },
    vault: {
      async read(path: string): Promise<string> {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
        return app.vault.read(file);
      },
      async process(path: string, fn: (text: string) => string): Promise<void> {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
        // `vault.process` liest, ruft `fn` und schreibt selbst atomar (siehe obsidian.d.ts:
        // "Atomically read, modify, and save"). Nicht vorher selbst lesen und den Text hier
        // festhalten — das waere ein Schnappschuss, der zwischen Aufbau und Aufruf veralten
        // kann. Ein Wurf in `fn` propagiert unveraendert (kein try/catch): das ist Absicht,
        // `writeBlockBody` faengt `BlockChangedError` gezielt ab, alles andere zeigt `save()`
        // in `block-child.ts` als generischen Fehler an.
        await app.vault.process(file, fn);
      },
    },
  };
}
