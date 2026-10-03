import { describe, expect, it, vi } from "vitest";
import { ShapesFileView } from "../../src/obsidian/shapes-file-view";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import { ActiveViewport } from "../../src/core/active-viewport";

function fakeEditor() {
  let value = "";
  return {
    setValue: vi.fn((t: string) => {
      value = t;
    }),
    applyExternalEdit: vi.fn((t: string) => {
      value = t;
    }),
    getValue: () => value,
    setIssues: vi.fn(),
    focus: vi.fn(),
    hasFocus: vi.fn(() => false),
    destroy: vi.fn(),
    type: (t: string) => {
      value = t;
    },
  };
}

function makeView() {
  const editor = fakeEditor();
  let onChange: (t: string) => void = () => {};
  const loadModel = vi.fn().mockResolvedValue({ object: {}, cameras: [] });
  const viewports: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const budget = { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() };
  const deps = {
    settings: () => DEFAULT_SETTINGS,
    factory: {
      isWebGLAvailable: () => true,
      create: () => {
        const vp = {
          setModel: vi.fn(),
          setView: vi.fn(),
          getView: vi.fn(() => null),
          setColors: vi.fn(),
          resize: vi.fn(),
          resetCamera: vi.fn(),
          capturePoster: () => "",
          dispose: vi.fn(),
        };
        viewports.push(vp);
        return vp;
      },
    },
    budget,
    loadModel,
    readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
    active: new ActiveViewport(),
    createEditor: (_parent: unknown, opts: { onChange: (t: string) => void }) => {
      onChange = opts.onChange;
      return editor;
    },
  };
  const view = new ShapesFileView({ app: undefined } as never, deps as never);
  return {
    view,
    editor,
    loadModel,
    viewports,
    budget,
    typeText: (t: string) => {
      editor.type(t);
      onChange(t);
    },
  };
}

const pill = (view: ShapesFileView, mode: string) => view.pillStateForTest().find((p) => p.mode === mode);

describe("ShapesFileView", () => {
  it("loads the file text into editor and model", async () => {
    const { view, editor, loadModel } = makeView();
    await view.onOpen();
    view.setViewData("box A size 1", true);
    await view.rendering;
    expect(editor.setValue).toHaveBeenCalledWith("box A size 1");
    expect(loadModel).toHaveBeenCalledTimes(1);
  });

  it("marks broken lines in the editor", async () => {
    const { view, editor } = makeView();
    await view.onOpen();
    view.setViewData("box A size 1\nbox B size 1 2", true);
    await view.rendering;
    expect(editor.setIssues).toHaveBeenLastCalledWith([
      { line: 2, message: "`size` of a box needs 1 or 3 numbers", severity: "error" },
    ]);
  });

  it("(h) never reports header lines as an error", async () => {
    const { view, editor } = makeView();
    await view.onOpen();
    view.setViewData("title: My model\nheight: 300\nbox A size 1", true);
    await view.rendering;
    expect(editor.setIssues).toHaveBeenLastCalledWith([]);
  });

  it("saves and re-renders after a typing pause, not on every key", async () => {
    vi.useFakeTimers();
    try {
      const { view, loadModel, typeText } = makeView();
      await view.onOpen();
      view.setViewData("box A size 1", true);
      await view.rendering;
      typeText("box A size 2");
      typeText("box A size 3");
      expect(view.requestSave).toHaveBeenCalledTimes(2);
      expect(view.getViewData()).toBe("box A size 3");
      expect(loadModel).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300);
      await view.rendering;
      expect(loadModel).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(d) rapid typing renders once after the pause, with the last text", async () => {
    vi.useFakeTimers();
    try {
      const { view, loadModel, typeText } = makeView();
      await view.onOpen();
      view.setViewData("box A size 1", true);
      await view.rendering;
      loadModel.mockClear();
      for (const t of ["box A size 2", "box A size 3", "box A size 4"]) {
        typeText(t);
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(loadModel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      await view.rendering;
      expect(loadModel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(d) a broken line goes through the host's failBeforeMount path and keeps no stale viewport", async () => {
    vi.useFakeTimers();
    try {
      const { view, loadModel, viewports, budget, typeText } = makeView();
      await view.onOpen();
      view.setViewData("box A size 1", true);
      await view.rendering;
      expect(viewports).toHaveLength(1);
      loadModel.mockClear();
      typeText("box B size 1 2");
      await vi.advanceTimersByTimeAsync(300);
      await view.rendering;
      expect(loadModel).not.toHaveBeenCalled();
      expect(viewports[0]?.dispose).toHaveBeenCalledTimes(1);
      expect(budget.unregister).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("(d) closing cancels a pending re-render and destroys editor and host exactly once", async () => {
    vi.useFakeTimers();
    try {
      const { view, editor, loadModel, viewports, typeText } = makeView();
      await view.onOpen();
      view.setViewData("box A size 1", true);
      await view.rendering;
      loadModel.mockClear();
      typeText("box A size 2");
      await view.onClose();
      await vi.advanceTimersByTimeAsync(1000);
      await view.rendering;
      expect(loadModel).not.toHaveBeenCalled();
      expect(editor.destroy).toHaveBeenCalledTimes(1);
      expect(viewports[0]?.dispose).toHaveBeenCalledTimes(1);
      await view.onClose();
      expect(editor.destroy).toHaveBeenCalledTimes(1);
      expect(viewports[0]?.dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies an external change as a minimal edit", async () => {
    const { view, editor } = makeView();
    await view.onOpen();
    view.setViewData("box A size 1", true);
    view.setViewData("box A size 1\nbox B size 1", false);
    expect(editor.applyExternalEdit).toHaveBeenCalledWith("box A size 1\nbox B size 1");
  });

  it("(e) an external change re-renders the model and does not echo into a save", async () => {
    const { view, editor, loadModel } = makeView();
    await view.onOpen();
    view.setViewData("box A size 1", true);
    await view.rendering;
    loadModel.mockClear();
    view.setViewData("box A size 1\nbox B size 1", false);
    await view.rendering;
    expect(editor.setValue).toHaveBeenCalledTimes(1); // nur das erste Laden, kein Voll-Ersetzen
    expect(editor.applyExternalEdit).toHaveBeenCalledTimes(1);
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(view.requestSave).not.toHaveBeenCalled();
  });

  it("shows three pills when wide, two when narrow, with aria-pressed", async () => {
    const { view } = makeView();
    await view.onOpen();
    view.setWidthForTest(900);
    expect(view.pillStateForTest()).toEqual([
      { mode: "model", hidden: false, pressed: "false" },
      { mode: "text", hidden: false, pressed: "false" },
      { mode: "split", hidden: false, pressed: "true" },
    ]);
    view.setWidthForTest(400);
    expect(pill(view, "split")?.hidden).toBe(true);
    expect(pill(view, "model")?.pressed).toBe("true");
  });

  it("keeps a chosen mode across width changes", async () => {
    const { view } = makeView();
    await view.onOpen();
    view.setWidthForTest(900);
    view.setMode("text");
    view.setWidthForTest(950);
    expect(pill(view, "text")?.pressed).toBe("true");
  });

  it("(a) the stored mode survives a narrow pane: Split returns when widened again", async () => {
    const { view } = makeView();
    await view.onOpen();
    view.setWidthForTest(900);
    view.setMode("split");
    view.setWidthForTest(400);
    expect(pill(view, "split")?.hidden).toBe(true);
    expect(pill(view, "model")?.pressed).toBe("true");
    expect(view.modelVisibleForTest()).toBe(true);
    expect(view.textVisibleForTest()).toBe(false);
    view.setWidthForTest(900);
    expect(pill(view, "split")?.hidden).toBe(false);
    expect(pill(view, "split")?.pressed).toBe("true");
  });

  it("(b) initialMode waits for the first real width: 0 does not decide, a later wide width gives Split", async () => {
    const { view } = makeView();
    await view.onOpen();
    // Noch nicht gemessen (Pane nicht gelayoutet): kein Modus ist festgelegt, nur Modell sichtbar.
    expect(view.modeForTest()).toBeNull();
    view.setWidthForTest(0);
    expect(view.modeForTest()).toBeNull();
    view.setWidthForTest(900);
    expect(view.modeForTest()).toBe("split");
    expect(pill(view, "split")?.pressed).toBe("true");
  });

  it("(b) a narrow first measurement starts in Model and a user choice before measuring is not overridden", async () => {
    const a = makeView();
    await a.view.onOpen();
    a.view.setWidthForTest(400);
    expect(a.view.modeForTest()).toBe("model");

    const b = makeView();
    await b.view.onOpen();
    b.view.setMode("text");
    b.view.setWidthForTest(900);
    expect(b.view.modeForTest()).toBe("text");
  });

  it("gives issues a text channel: a summary naming the first error line", async () => {
    const { view } = makeView();
    await view.onOpen();
    view.setViewData("box A size 1\nbox B size 1 2", true);
    expect(view.issueSummaryForTest()).toContain("Line 2");
    view.setViewData("box A size 1", true);
    expect(view.issueSummaryForTest()).toBe("");
  });

  it("(M9) choosing Text or Split focuses the editor", async () => {
    const { view, editor } = makeView();
    await view.onOpen();
    view.setWidthForTest(900);
    view.setMode("text");
    expect(editor.focus).toHaveBeenCalledTimes(1);
    view.setMode("split");
    expect(editor.focus).toHaveBeenCalledTimes(2);
  });

  it("(M9) choosing Model while the editor has focus moves focus to the pressed pill", async () => {
    const { view, editor } = makeView();
    await view.onOpen();
    view.setWidthForTest(900);
    editor.hasFocus.mockReturnValue(true);
    view.setMode("model");
    const pills = (view as unknown as { pills: Map<string, { focus: ReturnType<typeof vi.fn> }> }).pills;
    expect(pills.get("model")?.focus).toHaveBeenCalledTimes(1);
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it("(M9) choosing Model without editor focus leaves focus alone", async () => {
    const { view } = makeView();
    await view.onOpen();
    view.setWidthForTest(900);
    view.setMode("model");
    const pills = (view as unknown as { pills: Map<string, { focus: ReturnType<typeof vi.fn> }> }).pills;
    expect(pills.get("model")?.focus).not.toHaveBeenCalled();
  });

  it("cleans up on close", async () => {
    const { view, editor } = makeView();
    await view.onOpen();
    await view.onClose();
    expect(editor.destroy).toHaveBeenCalled();
  });
});
