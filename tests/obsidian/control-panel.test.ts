import { describe, expect, it, vi } from "vitest";
import { panelModel } from "../../src/obsidian/control-panel";
import type { ViewportController } from "../../src/core/active-viewport";

function controller(overrides: Partial<ViewportController> = {}): ViewportController {
  return {
    getView: () => null,
    applyView: vi.fn(),
    canSave: () => true,
    save: vi.fn(async () => {}),
    label: () => "eg.glb",
    ...overrides,
  };
}

describe("panelModel", () => {
  it("is empty without a controller", () => {
    const model = panelModel(null);
    expect(model.empty).toBe(true);
    expect(model.label).toBe("Click a 3D model to control it here.");
  });

  it("shows the model label when one is active", () => {
    const model = panelModel(controller());
    expect(model.empty).toBe(false);
    expect(model.label).toBe("eg.glb");
    expect(model.canSave).toBe(true);
    expect(model.saveDisabledReason).toBeNull();
  });

  it("explains why saving is impossible", () => {
    const model = panelModel(controller({ canSave: () => false }));
    expect(model.canSave).toBe(false);
    expect(model.saveDisabledReason).toBe("The view can only be saved in a `3d` code block");
  });
});
