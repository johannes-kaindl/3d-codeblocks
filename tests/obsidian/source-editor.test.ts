import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { SourceEditor, issueField, setIssues } from "../../src/obsidian/source-editor";

// Kein DOM in der Testumgebung: EditorView wird durch eine Attrappe ersetzt, die die Update-Listener aus dem
// uebergebenen State liest und ein `dispatch` hat, das auf Wunsch wirft.
const fake = vi.hoisted(() => ({ throwNext: false, listeners: [] as ((u: unknown) => void)[], focused: false, focusCalls: 0 }));
vi.mock("@codemirror/view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/view")>();
  class FakeView {
    static updateListener = actual.EditorView.updateListener;
    static lineWrapping = actual.EditorView.lineWrapping;
    static decorations = actual.EditorView.decorations;
    state: { doc: { length: number; toString: () => string } };
    constructor(config: { state: import("@codemirror/state").EditorState }) {
      fake.listeners = config.state.facet(actual.EditorView.updateListener) as never;
      this.state = { doc: { length: 0, toString: () => "" } };
    }
    dispatch() {
      if (fake.throwNext) {
        fake.throwNext = false;
        throw new Error("dispatch failed");
      }
    }
    get hasFocus() {
      return fake.focused;
    }
    focus() {
      fake.focusCalls += 1;
    }
    destroy() {}
  }
  return { ...actual, EditorView: FakeView };
});

function decorated(state: EditorState): { line: number; cls: string; title: string }[] {
  const out: { line: number; cls: string; title: string }[] = [];
  state.field(issueField).between(0, state.doc.length, (from, _to, deco) => {
    const spec = deco.spec as { class: string; attributes: { title: string } };
    out.push({ line: state.doc.lineAt(from).number, cls: spec.class, title: spec.attributes.title });
  });
  return out;
}

describe("issueField", () => {
  const doc = "box A size 1\nbox B size 1 2\nbox C size 1 bogus";

  it("marks the reported lines with their message", () => {
    let state = EditorState.create({ doc, extensions: [issueField] });
    state = state.update({
      effects: setIssues.of([
        { line: 2, message: "`size` of a box needs 1 or 3 numbers", severity: "error" },
        { line: 3, message: "Unknown word `bogus` ignored", severity: "warning" },
      ]),
    }).state;
    expect(decorated(state)).toEqual([
      { line: 2, cls: "tdcb-issue-line is-error", title: "`size` of a box needs 1 or 3 numbers" },
      { line: 3, cls: "tdcb-issue-line is-warning", title: "Unknown word `bogus` ignored" },
    ]);
  });

  it("ignores lines outside the document and clears on an empty list", () => {
    let state = EditorState.create({ doc, extensions: [issueField] });
    state = state.update({ effects: setIssues.of([{ line: 99, message: "x", severity: "error" }]) }).state;
    expect(decorated(state)).toEqual([]);
    state = state.update({ effects: setIssues.of([{ line: 1, message: "x", severity: "error" }]) }).state;
    state = state.update({ effects: setIssues.of([]) }).state;
    expect(decorated(state)).toEqual([]);
  });

  it("moves marks with edits above them", () => {
    let state = EditorState.create({ doc, extensions: [issueField] });
    state = state.update({ effects: setIssues.of([{ line: 2, message: "m", severity: "error" }]) }).state;
    state = state.update({ changes: { from: 0, insert: "# neu\n" } }).state;
    expect(decorated(state).map((d) => d.line)).toEqual([3]);
  });
});

describe("SourceEditor", () => {
  it("a throwing dispatch does not silence onChange for good", () => {
    const onChange = vi.fn();
    const editor = new SourceEditor({} as HTMLElement, { onChange });
    const typed = () => { for (const l of fake.listeners) l({ docChanged: true, state: { doc: { toString: () => "neu" } } }); };
    fake.throwNext = true;
    expect(() => editor.setValue("x")).toThrow("dispatch failed");
    typed();
    expect(onChange).toHaveBeenCalledWith("neu");
    onChange.mockClear();
    fake.throwNext = true;
    expect(() => editor.applyExternalEdit("y")).toThrow("dispatch failed");
    typed();
    expect(onChange).toHaveBeenCalledWith("neu");
  });

  it("still suppresses onChange for its own successful writes", () => {
    const onChange = vi.fn();
    const editor = new SourceEditor({} as HTMLElement, { onChange });
    const real = (editor as unknown as { view: { dispatch: () => void } }).view;
    real.dispatch = () => { for (const l of fake.listeners) l({ docChanged: true, state: { doc: { toString: () => "x" } } }); };
    editor.setValue("x");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes focus and hasFocus", () => {
    const editor = new SourceEditor({} as HTMLElement, {});
    fake.focused = true;
    expect(editor.hasFocus()).toBe(true);
    editor.focus();
    expect(fake.focusCalls).toBeGreaterThan(0);
  });
});
