// Viewer-Zustand → Anzeigemodell. Pure: die Render-Schicht konsumiert nur das
// ViewModel und trifft keine Entscheidungen (UI-STANDARD §6).
import { SUPPORTED_EXTENSIONS } from "./format";
import { capList } from "./shapes/convert";
import { t } from "../i18n/t";

export type ViewerState =
  | { kind: "config-error"; messages: string[] }
  | { kind: "missing-file"; path: string }
  | { kind: "unsupported-format"; path: string }
  | { kind: "compressed-gltf"; extensions: string[] }
  | { kind: "invalid-file" }
  | { kind: "invalid-gltf-json" }
  | { kind: "invalid-shapes"; messages: string[] }
  /** shapes-Text ohne Teil UND ohne Zeilenfehler (leer, nur Kommentare): Leerzustand, kein Fehler. */
  | { kind: "empty-shapes"; hint: string }
  | { kind: "no-webgl" }
  | { kind: "context-lost" }
  | { kind: "load-failed"; detail: string }
  | { kind: "loading" }
  | { kind: "poster" }
  /** `notes` = das Modell steht, aber etwas daran war nicht ladbar (fehlende Textur,
      blockierte externe Referenz). Kein Fehler: was da ist, wird gezeigt. */
  | { kind: "ready"; notes?: string[] };

export interface ViewModel {
  /** `null` = keine Meldungsbox zeigen. */
  message: string | null;
  tone: "error" | "info" | null;
  showReloadButton: boolean;
  showSpinner: boolean;
  /** true = als Empty-State (`tdcb-empty`) zeigen statt als Meldungsbox (UI-STANDARD §8). */
  empty?: boolean;
}

const SILENT: ViewModel = {
  message: null,
  tone: null,
  showReloadButton: false,
  showSpinner: false,
};

function error(message: string, showReloadButton = false): ViewModel {
  return { message, tone: "error", showReloadButton, showSpinner: false };
}

export function toViewModel(state: ViewerState): ViewModel {
  switch (state.kind) {
    case "ready":
      return state.notes && state.notes.length > 0
        ? { ...SILENT, message: state.notes.join(" "), tone: "info" }
        : SILENT;
    case "poster":
      return SILENT;
    case "loading":
      return { ...SILENT, showSpinner: true };
    case "config-error":
      return error(state.messages.join(" "));
    case "missing-file":
      return error(t("core.vm.missing", state.path));
    case "unsupported-format":
      return error(
        t("core.vm.unsupported", state.path, SUPPORTED_EXTENSIONS.join(", ")),
      );
    case "compressed-gltf":
      // Nennt bewusst den AUSWEG mit: Meshopt geht seit 2026-08-30, nur Draco nicht.
      // Eine Fehlermeldung, die nur "geht nicht" sagt, laesst den Nutzer im Regen.
      return error(
        t("core.vm.draco", state.extensions.join(", ")),
      );
    case "invalid-file":
      return error(t("core.vm.invalidFile"));
    case "invalid-gltf-json":
      return error(t("core.vm.invalidJson"));
    case "invalid-shapes":
      return error(`${t("core.vm.noValidPart")} ${capList(state.messages, 5).join(" ")}`.trim());
    case "empty-shapes":
      return { ...SILENT, message: state.hint, tone: "info", empty: true };
    case "no-webgl":
      return error(t("core.vm.noWebgl"));
    case "context-lost":
      return error(t("core.vm.contextLost"), true);
    case "load-failed":
      return error(t("core.vm.loadFailed", state.detail), true);
  }
}
