// Controller fuer die Wege ohne Codeblock (Embed, FileView): steuerbar, aber
// nicht speicherbar. Bewusst eine geteilte Fabrik statt zweier gleicher
// Methodensaetze — der Unterschied zwischen den beiden Wegen ist nur, woher
// Host und Label kommen.
import { Notice } from "obsidian";
import { NO_BLOCK_REASON, type ViewportController } from "../core/active-viewport";
import type { ViewSpec } from "../core/view-spec";

interface HostLike {
  currentView(): ViewSpec | null;
  applyView(spec: ViewSpec | null): void;
}

export function readOnlyController(
  host: () => HostLike | null,
  label: () => string,
): ViewportController {
  return {
    label,
    getView: () => host()?.currentView() ?? null,
    applyView: (spec) => host()?.applyView(spec),
    canSave: () => false,
    async save() {
      new Notice(NO_BLOCK_REASON);
    },
  };
}
