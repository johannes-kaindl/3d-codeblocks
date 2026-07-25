// Welcher Viewport wird gerade bedient? Pure — kein obsidian, kein three.
//
// Eine Notiz kann mehrere Modelle zeigen (fuenf Etagen). Aktiv ist der zuletzt
// benutzte; gespeist wird das aus `onInteract`, das schon heute jede echte
// Nutzerinteraktion meldet (Autorotate zaehlt bewusst nicht).
import type { ViewSpec } from "./view-spec";

/**
 * Begruendung, wenn `canSave()` false ist. Steht hier, damit Sidebar, Toolbar,
 * Block und die Wege ohne Codeblock denselben Satz zeigen.
 */
export const NO_BLOCK_REASON = "The view can only be saved in a `3d` code block";

/** Was Sidebar und Toolbar von einem Viewport brauchen — three.js sehen sie nie. */
export interface ViewportController {
  /** Aktuelle Kamera als Spec, oder `null`, wenn (noch) kein Modell geladen ist. */
  getView(): ViewSpec | null;
  /** Kamera setzen; `null` = automatisch einpassen. */
  applyView(spec: ViewSpec | null): void;
  /** Gibt es einen Codeblock, in den geschrieben werden kann? */
  canSave(): boolean;
  /** In den Block schreiben; `null` entfernt den Key. */
  save(spec: ViewSpec | null): Promise<void>;
  /** Anzeigename fuer die Sidebar (Titel oder Dateipfad). */
  label(): string;
}

type Listener = (controller: ViewportController | null) => void;

export class ActiveViewport {
  private current: ViewportController | null = null;
  private readonly listeners = new Set<Listener>();

  get(): ViewportController | null {
    return this.current;
  }

  set(controller: ViewportController | null): void {
    if (this.current === controller) return;
    this.current = controller;
    for (const listener of this.listeners) listener(controller);
  }

  /** Beim Entladen eines Blocks — raeumt nur auf, wenn er auch der aktive war. */
  clearIf(controller: ViewportController): void {
    if (this.current === controller) this.set(null);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
