import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { issueField, setIssues } from "../../src/obsidian/source-editor";

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
