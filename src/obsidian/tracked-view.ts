import type { TFile } from "obsidian";

/** Eine View (Codeblock, gltf-Block, Embed, FileView), die auf Datei-Änderungen und
    Theme-Wechsel reagiert und sich beim Entladen selbst abmeldet.
    Die FileView gehoert seit dem Whole-Branch-Review ausdruecklich dazu: sie ist ein
    vollwertiger Edit-Ort, und ohne `modify`-Abo waere eine dort laufende Edit-Session
    nach der ersten Regenerierung dauerhaft stale. */
export interface TrackedView {
  onFileModified(file: TFile): void | Promise<void>;
  refreshColors(): void;
  /** "Auto-rotate"-Setting auf den lebenden Viewport anwenden (Smoke-#5-Befund:
      es wurde sonst nur beim Mount gelesen und ein Toggle blieb wirkungslos). */
  refreshAutoRotate?(): void;
  register(cb: () => void): void;
  /** Leiste an-/abhaengen, wenn sich Placement oder Sidebar-Sichtbarkeit aendern.
      Optional: nur `ModelBlock` hat ueberhaupt eine Hover-Toolbar. */
  syncToolbar?(): void;
}
