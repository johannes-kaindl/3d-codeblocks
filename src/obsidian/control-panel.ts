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
  }
}
