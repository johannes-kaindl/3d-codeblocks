import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "../__mocks__/obsidian";
import { buildToolbar, toolbarVisible } from "../../src/obsidian/viewport-toolbar";
import { NAMED_VIEWS } from "../../src/core/view-spec";
import { MODEL_LOADING_REASON, type ViewportController } from "../../src/core/active-viewport";

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
