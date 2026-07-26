import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "../__mocks__/obsidian";
import { buildToolbar, toolbarVisible } from "../../src/obsidian/viewport-toolbar";
import { NAMED_VIEWS } from "../../src/core/view-spec";
import { MODEL_LOADING_REASON, type ViewportController } from "../../src/core/active-viewport";
import type { EditUiModel } from "../../src/core/edit-session";

function controller(overrides: Partial<ViewportController> = {}): ViewportController {
  return {
    getView: () => NAMED_VIEWS.top,
    applyView: vi.fn(),
    canSave: () => true,
    save: vi.fn(async () => {}),
    label: () => "eg.glb",
    ...overrides,
  };
}

function makeEditModel(over: Partial<EditUiModel> = {}): EditUiModel {
  return {
    active: false,
    disabledReason: null,
    mode: "translate",
    dirty: false,
    selection: null,
    enter: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    setMode: vi.fn(),
    reset: vi.fn(),
    applyTrs: vi.fn(),
    ...over,
  };
}

const labels = (bar: any) => bar.children.map((b: any) => b.getAttribute("aria-label"));

describe("toolbarVisible", () => {
  it("shows only when resolvePanelTarget picks the toolbar", () => {
    expect(toolbarVisible("auto", false)).toBe(true);
    expect(toolbarVisible("auto", true)).toBe(false);
    expect(toolbarVisible("toolbar", true)).toBe(true);
    expect(toolbarVisible("sidebar", false)).toBe(false);
  });
});

describe("buildToolbar", () => {
  it("gives every icon button an accessible label", () => {
    const parent = makeFakeEl();
    // `any`: buildToolbar() ist auf das echte HTMLElement getypt, der Fake liefert
    // aber kein Element mit .click()/.disabled — wie findByText in control-panel.test.ts.
    const bar: any = buildToolbar(parent, controller());
    for (const button of bar.children) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("saves the current view when the save button is clicked", () => {
    const c = controller();
    const bar: any = buildToolbar(makeFakeEl(), c);
    bar.children[0].click();
    expect(c.save).toHaveBeenCalledWith(NAMED_VIEWS.top);
  });

  it("fits the camera when the fit button is clicked", () => {
    const c = controller();
    const bar: any = buildToolbar(makeFakeEl(), c);
    bar.children[2].click();
    expect(c.applyView).toHaveBeenCalledWith(null);
  });

  it("disables saving when the block cannot be written", () => {
    const bar: any = buildToolbar(makeFakeEl(), controller({ canSave: () => false }));
    expect(bar.children[0].disabled).toBe(true);
    expect(bar.children[1].disabled).toBe(true);
    expect(bar.children[2].disabled).toBe(false);
  });

  // Regressionstest fuer die Abweichung vom Brief: Save braucht MEHR als Clear (Block UND
  // geladenes Modell). Ein Controller mit Block aber ohne Kamera (Modell laedt noch) muss
  // Save sperren, Clear aber weiter erlauben — genau die Asymmetrie, die die Sidebar schon
  // einmal reparieren musste (siehe `control-panel.ts` / `panelModel`).
  it("disables only saving while the model is still loading (block writable, no view yet)", () => {
    const bar: any = buildToolbar(
      makeFakeEl(),
      controller({ canSave: () => true, getView: () => null }),
    );
    expect(bar.children[0].disabled).toBe(true);
    expect(bar.children[0].title).toBe(MODEL_LOADING_REASON);
    expect(bar.children[1].disabled).toBe(false);
  });
});

describe("buildToolbar im Edit-Kontext", () => {
  it("inaktiv: View-Buttons + Edit-Button", () => {
    const bar: any = buildToolbar(makeFakeEl(), controller(), makeEditModel());
    expect(labels(bar)).toContain("Edit model");
  });

  it("Edit-Button traegt den Sperrgrund als Tooltip und ist deaktiviert", () => {
    const bar: any = buildToolbar(
      makeFakeEl(),
      controller(),
      makeEditModel({ disabledReason: "Editing requires a glTF or GLB file" }),
    );
    const edit = bar.children.find((b: any) => b.getAttribute("aria-label") === "Edit model");
    expect(edit.disabled).toBe(true);
    expect(edit.title).toContain("glTF");
  });

  it("aktiv: Move/Scale/Reset/Save/Discard statt der View-Buttons; Save folgt dirty", () => {
    const model = makeEditModel({ active: true, dirty: false, selection: null });
    const bar: any = buildToolbar(makeFakeEl(), controller(), model);
    expect(labels(bar)).toEqual(["Move", "Scale", "Reset node", "Save edits", "Discard edits"]);
    const save = bar.children.find((b: any) => b.getAttribute("aria-label") === "Save edits");
    expect(save.disabled).toBe(true);
    const reset = bar.children.find((b: any) => b.getAttribute("aria-label") === "Reset node");
    expect(reset.disabled).toBe(true); // keine Auswahl
  });

  it("Klicks rufen die Modell-Handler", () => {
    const model = makeEditModel({
      active: true,
      dirty: true,
      selection: { name: "privat-herd", trs: { translation: [0, 0, 0], scale: [1, 1, 1] } },
    });
    const bar: any = buildToolbar(makeFakeEl(), controller(), model);
    bar.children.find((b: any) => b.getAttribute("aria-label") === "Scale").click();
    expect(model.setMode).toHaveBeenCalledWith("scale");
    bar.children.find((b: any) => b.getAttribute("aria-label") === "Save edits").click();
    expect(model.save).toHaveBeenCalled();
  });

  it("ohne Edit-Modell (Embed/FileView-Altpfad) unveraendert nur View-Buttons", () => {
    const bar: any = buildToolbar(makeFakeEl(), controller());
    expect(labels(bar)).toEqual(["Save view", "Clear view", "Fit camera to model"]);
  });
});
