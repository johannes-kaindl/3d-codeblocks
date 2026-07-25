// Kleine Icon-Leiste oben rechts im Viewport — der Ersatz fuer die Sidebar,
// wenn sie geschlossen ist. Sichtbarkeit steuert CSS (hover/focus-within),
// die Entscheidung "gibt es sie ueberhaupt" trifft `resolvePanelTarget`.
import { setIcon } from "obsidian";
import {
  MODEL_LOADING_REASON,
  NO_BLOCK_REASON,
  type ViewportController,
} from "../core/active-viewport";
import { resolvePanelTarget, type PanelPlacement } from "../core/panel-target";

export function toolbarVisible(placement: PanelPlacement, panelVisible: boolean): boolean {
  return resolvePanelTarget(placement, panelVisible) === "toolbar";
}

interface ToolbarButton {
  icon: string;
  label: string;
  // `hasBlock`/`hasView` statt einem einzelnen Flag: Save braucht beides (wie die
  // Sidebar in control-panel.ts), Clear nur `hasBlock`, Fit gar nichts — ein Save-
  // Button, der aktiv ist aber ins Leere klickt, war genau der Bug, den die Sidebar
  // schon einmal fixen musste.
  disabledReason: (hasBlock: boolean, hasView: boolean) => string | null;
  run: (controller: ViewportController) => void;
}

const BUTTONS: ToolbarButton[] = [
  {
    icon: "pin",
    label: "Save view",
    disabledReason: (hasBlock, hasView) =>
      !hasBlock ? NO_BLOCK_REASON : !hasView ? MODEL_LOADING_REASON : null,
    run: (controller) => {
      const spec = controller.getView();
      if (spec !== null) void controller.save(spec);
    },
  },
  {
    icon: "pin-off",
    label: "Clear view",
    disabledReason: (hasBlock) => (hasBlock ? null : NO_BLOCK_REASON),
    run: (controller) => void controller.save(null),
  },
  {
    icon: "maximize",
    label: "Fit camera to model",
    disabledReason: () => null,
    run: (controller) => controller.applyView(null),
  },
];

export function buildToolbar(parent: HTMLElement, controller: ViewportController): HTMLElement {
  const bar = parent.createDiv({ cls: "tdcb-toolbar" });
  const hasBlock = controller.canSave();
  const hasView = controller.getView() !== null;

  for (const spec of BUTTONS) {
    const button = bar.createEl("button", { cls: "tdcb-toolbar-button" });
    setIcon(button, spec.icon);
    // Icon-only-Buttons brauchen ein zugaengliches Label (UI-STANDARD §2).
    button.setAttribute("aria-label", spec.label);
    const reason = spec.disabledReason(hasBlock, hasView);
    button.disabled = reason !== null;
    button.title = reason ?? spec.label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      spec.run(controller);
    });
  }

  return bar;
}
