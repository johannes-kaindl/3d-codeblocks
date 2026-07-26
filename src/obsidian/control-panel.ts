// Bedienung des aktiven Viewports in der rechten Leiste.
//
// Die Ansichts-Entscheidungen stecken in `panelModel` (pur, testbar); diese Klasse
// zeichnet nur — UI-STANDARD §6. DOM ausschliesslich ueber createEl/createDiv.
import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import {
  MODEL_LOADING_REASON,
  NO_BLOCK_REASON,
  type ActiveViewport,
  type ViewportController,
} from "../core/active-viewport";
import type { EditUiModel } from "../core/edit-session";
import { NAMED_VIEWS } from "../core/view-spec";

export const VIEW_TYPE_3D_CONTROLS = "three-d-controls";

export interface PanelModel {
  empty: boolean;
  label: string;
  /** Save schreibt eine Kamera — die gibt es erst, wenn `getView()` nicht mehr `null` ist. */
  canSave: boolean;
  saveDisabledReason: string | null;
  /** Clear entfernt nur den Key, braucht also kein geladenes Modell. */
  canClear: boolean;
  clearDisabledReason: string | null;
}

export function panelModel(controller: ViewportController | null): PanelModel {
  if (controller === null) {
    return {
      empty: true,
      label: "Click a 3D model to control it here.",
      canSave: false,
      saveDisabledReason: null,
      canClear: false,
      clearDisabledReason: null,
    };
  }

  const hasBlock = controller.canSave();
  const hasView = controller.getView() !== null;

  return {
    empty: false,
    label: controller.label(),
    canSave: hasBlock && hasView,
    saveDisabledReason: !hasBlock ? NO_BLOCK_REASON : !hasView ? MODEL_LOADING_REASON : null,
    canClear: hasBlock,
    clearDisabledReason: hasBlock ? null : NO_BLOCK_REASON,
  };
}

export class ControlPanelView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly active: ActiveViewport,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_3D_CONTROLS;
  }

  getDisplayText(): string {
    return "3D view";
  }

  getIcon(): string {
    return "box";
  }

  onload(): void {
    this.register(this.active.subscribe(() => this.draw()));
    this.draw();
  }

  private draw(): void {
    const controller = this.active.get();
    const model = panelModel(controller);
    const root = this.contentEl;
    root.empty();
    root.addClass("tdcb-panel");

    if (model.empty || controller === null) {
      root.createDiv({ cls: "tdcb-empty", text: model.label });
      return;
    }

    root.createDiv({ cls: "tdcb-panel-label", text: model.label });

    const presets = root.createDiv({ cls: "tdcb-panel-presets" });
    for (const name of Object.keys(NAMED_VIEWS)) {
      const button = presets.createEl("button", { text: name });
      // Kopie, nicht die geteilte Konstante selbst — `applyView` reicht das Objekt an
      // den Viewport weiter, der es als `pendingView` haelt. Ohne Kopie koennte eine
      // spaetere Mutation dort (es gibt derzeit keine, aber der Typ erlaubt es) die
      // Konstante fuer ALLE Viewports gleichzeitig veraendern.
      button.addEventListener("click", () => controller.applyView({ ...NAMED_VIEWS[name] }));
    }

    const actions = root.createDiv({ cls: "tdcb-panel-actions" });

    const save = actions.createEl("button", { cls: "mod-cta", text: "Save view" });
    save.disabled = !model.canSave;
    if (model.saveDisabledReason) save.title = model.saveDisabledReason;
    save.addEventListener("click", () => void controller.save(controller.getView()));

    const clear = actions.createEl("button", { text: "Clear view" });
    clear.disabled = !model.canClear;
    if (model.clearDisabledReason) clear.title = model.clearDisabledReason;
    clear.addEventListener("click", () => void controller.save(null));

    const fit = actions.createEl("button", { text: "Fit" });
    fit.addEventListener("click", () => controller.applyView(null));
    setIcon(fit.createSpan({ cls: "tdcb-icon" }), "maximize");

    const edit = controller.editPanel?.();
    if (edit) drawEditSection(root, edit);
  }
}

/** Edit-Sektion unter den View-Buttons — nur wenn der Controller `editPanel` anbietet
 *  (glTF/GLB-Weg, Task 8/10). Zwei Zustaende: `!active` zeigt nur den Einstiegsknopf,
 *  `active` die Modus-Buttons plus — je nach Auswahl — entweder die Zahlenfelder mit
 *  Reset/Save/Discard oder den Hinweis, erst ein Teil des Modells auszuwaehlen. */
function drawEditSection(root: HTMLElement, edit: EditUiModel): void {
  const section = root.createDiv({ cls: "tdcb-panel-edit" });

  if (!edit.active) {
    const enter = section.createEl("button", { text: "Edit model" });
    enter.disabled = edit.disabledReason !== null;
    if (edit.disabledReason) enter.title = edit.disabledReason;
    enter.addEventListener("click", () => edit.enter());
    return;
  }

  const modes = section.createDiv({ cls: "tdcb-panel-edit-modes" });
  const move = modes.createEl("button", { text: "Move" });
  move.toggleClass("mod-cta", edit.mode === "translate");
  move.addEventListener("click", () => edit.setMode("translate"));
  const scale = modes.createEl("button", { text: "Scale" });
  scale.toggleClass("mod-cta", edit.mode === "scale");
  scale.addEventListener("click", () => edit.setMode("scale"));

  const selection = edit.selection;
  if (selection === null) {
    section.createDiv({ text: "Click a part of the model to select it." });
    return;
  }

  section.createDiv({ cls: "tdcb-panel-edit-label", text: selection.name });

  // Beide Zeilen fuellen sich aus DERSELBEN `inputs`-Liste -- der `change`-Handler
  // liest beim Feuern alle sechs aktuellen Feldwerte (nicht nur den geaenderten), weil
  // `applyTrs` immer das komplette `NodeTrs` erwartet.
  const inputs: HTMLInputElement[] = [];
  const addField = (row: HTMLElement, value: number): void => {
    const input = row.createEl("input");
    input.type = "number";
    input.value = String(value);
    inputs.push(input);
  };

  const positionRow = section.createDiv({ cls: "tdcb-panel-edit-row" });
  for (const value of selection.trs.translation) addField(positionRow, value);
  const scaleRow = section.createDiv({ cls: "tdcb-panel-edit-row" });
  for (const value of selection.trs.scale) addField(scaleRow, value);

  const onChange = (): void => {
    const [tx, ty, tz, sx, sy, sz] = inputs.map((input) => Number(input.value));
    edit.applyTrs({ translation: [tx, ty, tz], scale: [sx, sy, sz] });
  };
  for (const input of inputs) input.addEventListener("change", onChange);

  const buttons = section.createDiv({ cls: "tdcb-panel-actions" });
  const reset = buttons.createEl("button", { text: "Reset node" });
  reset.addEventListener("click", () => edit.reset());

  const save = buttons.createEl("button", { cls: "mod-cta", text: "Save edits" });
  save.disabled = !edit.dirty;
  save.addEventListener("click", () => edit.save());

  const discard = buttons.createEl("button", { text: "Discard edits" });
  discard.addEventListener("click", () => edit.discard());
}
