// Kleine Icon-Leiste oben rechts im Viewport — der Ersatz fuer die Sidebar,
// wenn sie geschlossen ist. Sichtbarkeit steuert CSS (hover/focus-within),
// die Entscheidung "gibt es sie ueberhaupt" trifft `resolvePanelTarget`.
import { setIcon } from "obsidian";
import {
  MODEL_LOADING_REASON,
  NO_BLOCK_REASON,
  type ViewportController,
} from "../core/active-viewport";
import type { EditUiModel } from "../core/edit-session";
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

interface EditButtonSpec {
  icon: string;
  label: string;
  disabled: (edit: EditUiModel) => boolean;
  // `null` = kein eigener Tooltip, Label reicht als title.
  title: (edit: EditUiModel) => string | null;
  isActive?: (edit: EditUiModel) => boolean;
  run: (edit: EditUiModel) => void;
}

const EDIT_BUTTONS: EditButtonSpec[] = [
  {
    icon: "move",
    label: "Move",
    disabled: () => false,
    title: () => null,
    isActive: (edit) => edit.mode === "translate",
    run: (edit) => edit.setMode("translate"),
  },
  {
    icon: "scaling",
    label: "Scale",
    disabled: () => false,
    title: () => null,
    isActive: (edit) => edit.mode === "scale",
    run: (edit) => edit.setMode("scale"),
  },
  {
    icon: "rotate-ccw",
    label: "Reset node",
    disabled: (edit) => edit.selection === null,
    title: () => null,
    run: (edit) => edit.reset(),
  },
  {
    icon: "save",
    label: "Save edits",
    disabled: (edit) => !edit.dirty,
    title: (edit) => (edit.dirty ? null : "No changes yet"),
    run: (edit) => edit.save(),
  },
  {
    icon: "x",
    label: "Discard edits",
    disabled: () => false,
    title: () => null,
    run: (edit) => edit.discard(),
  },
];

/** Ein Icon-Button, wie ihn beide Leisten (View-Buttons, Edit-Buttons) brauchen —
 *  Icon, zugaengliches `aria-label` (UI-STANDARD §2), disabled+title, stopPropagation
 *  gegen den Klick-durch-zum-Viewport-Bug. */
function appendButton(
  bar: HTMLElement,
  icon: string,
  label: string,
  disabled: boolean,
  title: string,
  isActive: boolean,
  onClick: () => void,
): void {
  const button = bar.createEl("button", { cls: "tdcb-toolbar-button" });
  setIcon(button, icon);
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.title = title;
  button.toggleClass("is-active", isActive);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
}

/** `edit` optional: ohne ihn (Embed/FileView-Altpfad) exakt das bisherige Verhalten —
 *  nur die drei View-Buttons. Mit `edit` kommt je nach `edit.active` entweder ein
 *  vierter View-Button ("Edit model") dazu, oder die View-Buttons weichen komplett
 *  den fuenf Edit-Buttons (Move/Scale/Reset/Save/Discard). */
export function buildToolbar(
  parent: HTMLElement,
  controller: ViewportController,
  edit?: EditUiModel | null,
): HTMLElement {
  const bar = parent.createDiv({ cls: "tdcb-toolbar" });

  if (edit?.active) {
    for (const spec of EDIT_BUTTONS) {
      appendButton(
        bar,
        spec.icon,
        spec.label,
        spec.disabled(edit),
        spec.title(edit) ?? spec.label,
        spec.isActive?.(edit) ?? false,
        () => spec.run(edit),
      );
    }
    return bar;
  }

  const hasBlock = controller.canSave();
  const hasView = controller.getView() !== null;

  for (const spec of BUTTONS) {
    const reason = spec.disabledReason(hasBlock, hasView);
    appendButton(bar, spec.icon, spec.label, reason !== null, reason ?? spec.label, false, () =>
      spec.run(controller),
    );
  }

  if (edit) {
    appendButton(
      bar,
      "pencil",
      "Edit model",
      edit.disabledReason !== null,
      edit.disabledReason ?? "Edit model",
      false,
      () => edit.enter(),
    );
  }

  return bar;
}
