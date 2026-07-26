// Controller fuer die Wege ohne Codeblock (Embed, FileView): steuerbar, aber
// nicht speicherbar. Bewusst eine geteilte Fabrik statt zweier gleicher
// Methodensaetze — der Unterschied zwischen den beiden Wegen ist nur, woher
// Host und Label kommen.
import { Notice } from "obsidian";
import { NO_BLOCK_REASON, type ViewportController } from "../core/active-viewport";
import type { EditUiModel } from "../core/edit-session";
import type { ViewSpec } from "../core/view-spec";

interface HostLike {
  currentView(): ViewSpec | null;
  applyView(spec: ViewSpec | null): void;
}

// `editPanel` optional (Task 12): Embed/FileView haben seit Task 12 einen eigenen
// EditCoordinator, aber die Fabrik bleibt fuer beide Wege (mit und ohne Edit) nutzbar.
// Nur ins Rueckgabeobjekt aufnehmen, wenn er mitgegeben wurde -- sonst zeigt die
// Sidebar faelschlich eine (leere) Edit-Sektion fuer Controller ohne Coordinator.
export function readOnlyController(
  host: () => HostLike | null,
  label: () => string,
  editPanel?: () => EditUiModel | null,
): ViewportController {
  return {
    label,
    getView: () => host()?.currentView() ?? null,
    applyView: (spec) => host()?.applyView(spec),
    canSave: () => false,
    async save() {
      new Notice(NO_BLOCK_REASON);
    },
    ...(editPanel ? { editPanel } : {}),
  };
}
