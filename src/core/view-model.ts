// Viewer-Zustand → Anzeigemodell. Pure: die Render-Schicht konsumiert nur das
// ViewModel und trifft keine Entscheidungen (UI-STANDARD §6).
import { SUPPORTED_EXTENSIONS } from "./format";

export type ViewerState =
  | { kind: "config-error"; messages: string[] }
  | { kind: "missing-file"; path: string }
  | { kind: "unsupported-format"; path: string }
  | { kind: "compressed-gltf"; extensions: string[] }
  | { kind: "invalid-file" }
  | { kind: "invalid-gltf-json" }
  | { kind: "no-webgl" }
  | { kind: "context-lost" }
  | { kind: "load-failed"; detail: string }
  | { kind: "loading" }
  | { kind: "poster" }
  | { kind: "ready" };

export interface ViewModel {
  /** `null` = keine Meldungsbox zeigen. */
  message: string | null;
  tone: "error" | "info" | null;
  showReloadButton: boolean;
  showSpinner: boolean;
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
    case "poster":
      return SILENT;
    case "loading":
      return { ...SILENT, showSpinner: true };
    case "config-error":
      return error(state.messages.join(" "));
    case "missing-file":
      return error(`File not found: ${state.path}`);
    case "unsupported-format":
      return error(
        `Unsupported format: ${state.path} (supported: ${SUPPORTED_EXTENSIONS.join(", ")})`,
      );
    case "compressed-gltf":
      return error(
        "Compressed glTF is not supported (Obsidian does not allow web workers). " +
          `Please export uncompressed. Required: ${state.extensions.join(", ")}`,
      );
    case "invalid-file":
      return error("The file is damaged or not a valid GLB.");
    case "invalid-gltf-json":
      return error("The glTF code is not valid JSON.");
    case "no-webgl":
      return error("WebGL is unavailable, so the 3D view cannot be shown.");
    case "context-lost":
      return error("The 3D context was lost.", true);
    case "load-failed":
      return error(`Could not load the model: ${state.detail}`, true);
  }
}
