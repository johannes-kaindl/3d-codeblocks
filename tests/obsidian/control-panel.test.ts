import { describe, expect, it, vi } from "vitest";
import { ControlPanelView, panelModel } from "../../src/obsidian/control-panel";
import { ActiveViewport, NO_BLOCK_REASON, type ViewportController } from "../../src/core/active-viewport";
import { NAMED_VIEWS } from "../../src/core/view-spec";

const LOADING_REASON = "The model is still loading";

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
    expect(model.canClear).toBe(true);
    expect(model.clearDisabledReason).toBeNull();
  });

  it("explains why saving and clearing are impossible without a block", () => {
    const model = panelModel(controller({ canSave: () => false }));
    expect(model.canSave).toBe(false);
    expect(model.saveDisabledReason).toBe("The view can only be saved in a `3d` code block");
    expect(model.canClear).toBe(false);
    expect(model.clearDisabledReason).toBe("The view can only be saved in a `3d` code block");
  });

  it("disables saving while the model is still loading, but keeps clearing available", () => {
    // Ein Block wird schon beim ersten Antippen der Buehne aktiv — das kann waehrend
    // des Ladens passieren, bevor `getView()` etwas liefert (siehe Review Task 10).
    const model = panelModel(controller({ getView: () => null }));
    expect(model.canSave).toBe(false);
    expect(model.saveDisabledReason).toBe(LOADING_REASON);
    expect(model.canClear).toBe(true);
    expect(model.clearDisabledReason).toBeNull();
  });
});

// Hilft, Buttons unabhaengig von ihrer Position in der DOM-Fake zu finden, ohne die
// Struktur von `draw()` im Test zu wiederholen.
function findByText(root: any, text: string): any {
  for (const child of root.children as any[]) {
    if (child.textContent === text) return child;
    const nested = findByText(child, text);
    if (nested) return nested;
  }
  return undefined;
}

function findByClass(root: any, cls: string): any {
  for (const child of root.children as any[]) {
    if (String(child.className).split(" ").includes(cls)) return child;
    const nested = findByClass(child, cls);
    if (nested) return nested;
  }
  return undefined;
}

// `addEventListener` ist ein `vi.fn()` ohne eigene Klick-Ausloesung — der registrierte
// Handler steckt aber in `.mock.calls`, den holen wir uns direkt.
function click(el: any): void {
  const call = el.addEventListener.mock.calls.find((c: any[]) => c[0] === "click");
  call[1]();
}

function makeView(): { view: ControlPanelView; active: ActiveViewport } {
  const active = new ActiveViewport();
  const view = new ControlPanelView({} as any, active);
  return { view, active };
}

describe("ControlPanelView", () => {
  it("renders the empty state when nothing is active", () => {
    const { view } = makeView();
    view.onload();
    const empty = findByClass(view.contentEl, "tdcb-empty");
    expect(empty).toBeTruthy();
    expect(empty.textContent).toBe("Click a 3D model to control it here.");
  });

  it("disables Save and Clear with the shared no-block reason", () => {
    const { view, active } = makeView();
    view.onload();
    active.set(controller({ canSave: () => false }));

    const save = findByText(view.contentEl, "Save view");
    const clear = findByText(view.contentEl, "Clear view");
    expect(save.disabled).toBe(true);
    expect(save.title).toBe(NO_BLOCK_REASON);
    expect(clear.disabled).toBe(true);
    expect(clear.title).toBe(NO_BLOCK_REASON);
  });

  it("disables only Save while the model is still loading", () => {
    const { view, active } = makeView();
    view.onload();
    active.set(controller({ getView: () => null }));

    const save = findByText(view.contentEl, "Save view");
    const clear = findByText(view.contentEl, "Clear view");
    expect(save.disabled).toBe(true);
    expect(save.title).toBe(LOADING_REASON);
    expect(clear.disabled).toBe(false);
  });

  it("saves the current view on click", () => {
    const { view, active } = makeView();
    view.onload();
    const c = controller();
    active.set(c);

    click(findByText(view.contentEl, "Save view"));

    expect(c.save).toHaveBeenCalledWith(NAMED_VIEWS.top);
  });

  it("fits the camera on click", () => {
    const { view, active } = makeView();
    view.onload();
    const c = controller();
    active.set(c);

    click(findByText(view.contentEl, "Fit"));

    expect(c.applyView).toHaveBeenCalledWith(null);
  });

  it("redraws when the active viewport changes and when it becomes none", () => {
    const { view, active } = makeView();
    view.onload();
    expect(findByClass(view.contentEl, "tdcb-empty")).toBeTruthy();

    active.set(controller());
    expect(findByClass(view.contentEl, "tdcb-empty")).toBeFalsy();
    expect(findByText(view.contentEl, "eg.glb")).toBeTruthy();

    active.set(null);
    expect(findByClass(view.contentEl, "tdcb-empty")).toBeTruthy();
  });
});
