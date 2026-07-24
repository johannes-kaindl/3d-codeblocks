import type { TFile } from "obsidian";

/** Eine Inline-View (Codeblock, gltf-Block, Embed), die auf Datei-Änderungen und
    Theme-Wechsel reagiert und sich beim Entladen selbst abmeldet. */
export interface TrackedView {
  onFileModified(file: TFile): void | Promise<void>;
  refreshColors(): void;
  register(cb: () => void): void;
}
