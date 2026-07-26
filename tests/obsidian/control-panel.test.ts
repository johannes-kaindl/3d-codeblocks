import { describe, expect, it, vi } from "vitest";
import { ControlPanelView, panelModel } from "../../src/obsidian/control-panel";
import {
  ActiveViewport,
  MODEL_LOADING_REASON,
  NO_BLOCK_REASON,
  type ViewportController,
} from "../../src/core/active-viewport";
import type { EditUiModel } from "../../src/core/edit-session";
import { NAMED_VIEWS } from "../../src/core/view-spec";

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

// Identisch zum Helfer aus viewport-toolbar.test.ts (Task 10) -- Testdateien teilen
// keine Helfer ueber Dateigrenzen.
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
    expect(model.saveDisabledReason).toBe(MODEL_LOADING_REASON);
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

// Alle INPUT-Elemente im Baum, jeweils mit einer `.handlers`-Bequemlichkeitsansicht
// auf `addEventListener.mock.calls` -- der Mock kennt keine echten input-Events, zeichnet
// registrierte Handler aber ueber `addEventListener` auf (wie `click()` oben schon nutzt).
function collectInputs(root: any): any[] {
  const found: any[] = [];
  const walk = (el: any) => {
    if (el.tagName === "INPUT") {
      const handlers: Record<string, ((event?: any) => void)[]> = {};
      for (const call of el.addEventListener.mock.calls as any[]) {
        (handlers[call[0]] ??= []).push(call[1]);
      }
      el.handlers = handlers;
      found.push(el);
    }
    for (const child of el.children as any[]) walk(child);
  };
  walk(root);
  return found;
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
    expect(save.title).toBe(MODEL_LOADING_REASON);
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

  it("passes a copy of a named preset, never the shared constant itself", () => {
    // Ohne die Kopie koennte eine spaetere Mutation des an `applyView` durchgereichten
    // Objekts (dort landet es als `pendingView`) die Konstante fuer ALLE Viewports
    // gleichzeitig veraendern.
    const { view, active } = makeView();
    view.onload();
    const c = controller();
    active.set(c);

    click(findByText(view.contentEl, "front"));

    expect(c.applyView).toHaveBeenCalledWith(NAMED_VIEWS.front);
    const passed = (c.applyView as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(passed).not.toBe(NAMED_VIEWS.front);
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

describe("Edit-Sektion", () => {
  it("zeigt den Edit-Button, wenn der Controller editPanel anbietet", () => {
    const { view, active } = makeView();
    view.onload();
    active.set({ ...controller(), editPanel: () => makeEditModel() });

    expect(JSON.stringify(view.contentEl.children)).toContain("Edit model");
  });

  it("aktiv: zeigt Auswahlname und sechs Zahlenfelder, applyTrs bei Aenderung", () => {
    const { view, active } = makeView();
    view.onload();
    const model = makeEditModel({
      active: true,
      selection: { name: "privat-herd", trs: { translation: [1, 0, 2], scale: [1, 1, 1] } },
    });
    active.set({ ...controller(), editPanel: () => model });

    expect(findByText(view.contentEl, "privat-herd")).toBeTruthy();

    const inputs = collectInputs(view.contentEl);
    expect(inputs).toHaveLength(6);
    inputs[0].value = "4";
    inputs[0].handlers.change?.forEach((fn: any) => fn());
    expect(model.applyTrs).toHaveBeenCalledWith({ translation: [4, 0, 2], scale: [1, 1, 1] });
  });

  it("aktiv ohne Auswahl: Hinweis statt Felder, aber Save/Discard bleiben bedienbar", () => {
    // Save/Discard wirken auf die SESSION, nicht die Auswahl -- wer einen Node bearbeitet
    // und dann ins Leere klickt (Auswahl weg), muss weiter speichern/verwerfen koennen.
    // Nur Reset ist an eine Auswahl gebunden (wie in der Toolbar): sichtbar, aber deaktiviert.
    const { view, active } = makeView();
    view.onload();
    const model = makeEditModel({ active: true, selection: null, dirty: false });
    active.set({ ...controller(), editPanel: () => model });

    expect(JSON.stringify(view.contentEl.children)).toContain("Click a part of the model to select it.");
    expect(collectInputs(view.contentEl)).toHaveLength(0);

    const reset = findByText(view.contentEl, "Reset node");
    const save = findByText(view.contentEl, "Save edits");
    const discard = findByText(view.contentEl, "Discard edits");
    expect(reset.disabled).toBe(true);
    expect(save.disabled).toBe(true); // dirty: false
    expect(discard.disabled).toBe(false);

    // Reset absichtlich NICHT geklickt: `disabled` verhindert im echten DOM den Klick,
    // der Mock bildet das nicht nach -- ein Klick hier wuerde `edit.reset()` also trotz
    // Deaktivierung ausloesen und faelschlich gruen bleiben.
    click(discard);
    expect(model.discard).toHaveBeenCalled();
  });

  it("ohne Auswahl, aber dirty: Save edits ist bedienbar", () => {
    const { view, active } = makeView();
    view.onload();
    const model = makeEditModel({ active: true, selection: null, dirty: true });
    active.set({ ...controller(), editPanel: () => model });

    const save = findByText(view.contentEl, "Save edits");
    expect(save.disabled).toBe(false);
    click(save);
    expect(model.save).toHaveBeenCalled();
  });

  it("ohne editPanel am Controller (alte Wege) keine Edit-Sektion", () => {
    const { view, active } = makeView();
    view.onload();
    active.set(controller());

    expect(JSON.stringify(view.contentEl.children)).not.toContain("Edit model");
  });

  it("Enter-Button ruft edit.enter()", () => {
    const { view, active } = makeView();
    view.onload();
    const model = makeEditModel();
    active.set({ ...controller(), editPanel: () => model });

    click(findByText(view.contentEl, "Edit model"));

    expect(model.enter).toHaveBeenCalled();
  });

  it("Enter-Button deaktiviert und traegt den Sperrgrund als Tooltip", () => {
    const { view, active } = makeView();
    view.onload();
    const model = makeEditModel({ disabledReason: "Editing requires a glTF or GLB file" });
    active.set({ ...controller(), editPanel: () => model });

    const button = findByText(view.contentEl, "Edit model");
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Editing requires a glTF or GLB file");
  });

  it("Modus-Buttons: aktiver Modus traegt mod-cta, Klick ruft setMode", () => {
    const { view, active } = makeView();
    view.onload();
    const model = makeEditModel({ active: true, mode: "translate" });
    active.set({ ...controller(), editPanel: () => model });

    const move = findByText(view.contentEl, "Move");
    const scale = findByText(view.contentEl, "Scale");
    expect(String(move.className).split(" ")).toContain("mod-cta");
    expect(String(scale.className).split(" ")).not.toContain("mod-cta");

    click(scale);
    expect(model.setMode).toHaveBeenCalledWith("scale");
  });

  it("Reset/Save/Discard: Save folgt dirty, Klicks rufen die Modell-Handler", () => {
    const { view, active } = makeView();
    view.onload();
    const model = makeEditModel({
      active: true,
      dirty: true,
      selection: { name: "privat-herd", trs: { translation: [0, 0, 0], scale: [1, 1, 1] } },
    });
    active.set({ ...controller(), editPanel: () => model });

    const save = findByText(view.contentEl, "Save edits");
    expect(save.disabled).toBe(false);

    click(findByText(view.contentEl, "Reset node"));
    expect(model.reset).toHaveBeenCalled();
    click(save);
    expect(model.save).toHaveBeenCalled();
    click(findByText(view.contentEl, "Discard edits"));
    expect(model.discard).toHaveBeenCalled();
  });

  it("Save edits ist deaktiviert, solange nichts dirty ist", () => {
    const { view, active } = makeView();
    view.onload();
    const model = makeEditModel({
      active: true,
      dirty: false,
      selection: { name: "privat-herd", trs: { translation: [0, 0, 0], scale: [1, 1, 1] } },
    });
    active.set({ ...controller(), editPanel: () => model });

    expect(findByText(view.contentEl, "Save edits").disabled).toBe(true);
  });
});
