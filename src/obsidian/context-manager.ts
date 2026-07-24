// Plugin-weites WebGL-Kontext-Budget.
//
// Browser schiessen ueberzaehlige Kontexte stillschweigend ab — mit sichtbar kaputten
// Viewports als Folge. Wir entscheiden lieber selbst, welcher Viewport zum Standbild
// degradiert wird (die Auswahl selbst ist pure: core/context-budget).
import { pickEvictions } from "../core/context-budget";
import type { ContextBudget } from "./block-child";

interface Entry {
  lastUsedAt: number;
  release: () => void;
}

export class ContextManager implements ContextBudget {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly limit: () => number,
    private readonly now: () => number,
  ) {}

  register(id: string, release: () => void): void {
    this.entries.set(id, { lastUsedAt: this.now(), release });
    this.enforce();
  }

  touch(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.lastUsedAt = this.now();
    this.enforce();
  }

  unregister(id: string): void {
    this.entries.delete(id);
  }

  private enforce(): void {
    const active = [...this.entries].map(([id, entry]) => ({ id, lastUsedAt: entry.lastUsedAt }));

    for (const id of pickEvictions(active, this.limit())) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      // Erst entfernen, dann freigeben — sonst wuerde derselbe Viewport bei der
      // naechsten Runde erneut ausgewaehlt.
      this.entries.delete(id);
      entry.release();
    }
  }
}
