// uebernommen aus json-editor/src/obsidian/SourceView.ts, 2026-10-03
// Abweichungen vom Original: umbenannt (SourceView -> SourceEditor, SourceViewOptions -> SourceEditorOptions);
// weggelassen: JSON-Sprachmodus (`json()`), Such-Öffner (`openSearchPanel`) und die private `mount`-Methode
// (der Aufbau steht im Konstruktor); hinzugefügt: eigene Undo-Historie (`history()` + `historyKeymap`), weil hier —
// anders als in json-editor — keine übergeordnete Historie existiert, `EditorView.lineWrapping`, das Interface
// `SourceEditorLike` (für Attrappen), `setIssues()` und `issueField`, das Zeilen mit Parser-Fehlern markiert
// (REGISTRY „CM6-Zeilen-Highlight per StateField“, Vorbild neurovim-obsidian/src/diffHighlight.ts).
// `setValue` und `applyExternalEdit` entsprechen dem Original: eine externe Änderung (Sync) kommt als minimale
// Spanne an, der Cursor bleibt stehen.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, StateEffect, StateField, Transaction, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { diffReplaceSpan } from "../core/textdiff";

export interface IssueLine {
  /** 1-basiert, wie die Meldungen des Parsers. */
  line: number;
  message: string;
  severity: "error" | "warning";
}

export const setIssues = StateEffect.define<IssueLine[]>();

export const issueField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setIssues)) continue;
      const ranges: Range<Decoration>[] = [];
      for (const issue of effect.value) {
        if (issue.line < 1 || issue.line > tr.state.doc.lines) continue;
        const from = tr.state.doc.line(issue.line).from;
        ranges.push(
          Decoration.line({
            class: `tdcb-issue-line is-${issue.severity}`,
            attributes: { title: issue.message },
          }).range(from),
        );
      }
      next = Decoration.set(ranges, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface SourceEditorOptions {
  onChange?: (newText: string) => void;
}

export interface SourceEditorLike {
  setValue(text: string): void;
  applyExternalEdit(text: string): void;
  getValue(): string;
  setIssues(issues: IssueLine[]): void;
  destroy(): void;
}

export class SourceEditor implements SourceEditorLike {
  private view: EditorView | null = null;
  private suppressChange = false;

  constructor(
    private container: HTMLElement,
    private opts: SourceEditorOptions,
  ) {
    const state = EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        history(),
        highlightSelectionMatches(),
        keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
        issueField,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (this.suppressChange) return;
          if (update.docChanged && this.opts.onChange) this.opts.onChange(update.state.doc.toString());
        }),
      ],
    });
    this.view = new EditorView({ state, parent: this.container });
  }

  setValue(text: string): void {
    if (!this.view) return;
    this.suppressChange = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      annotations: Transaction.addToHistory.of(false),
    });
    this.suppressChange = false;
  }

  /** Externe Änderung (Sync) als minimale Spanne — der Cursor bleibt außerhalb stehen. */
  applyExternalEdit(text: string): void {
    if (!this.view) return;
    const span = diffReplaceSpan(this.getValue(), text);
    this.suppressChange = true;
    this.view.dispatch({
      changes: { from: span.from, to: span.to, insert: span.insert },
      annotations: Transaction.addToHistory.of(false),
    });
    this.suppressChange = false;
  }

  setIssues(issues: IssueLine[]): void {
    this.view?.dispatch({ effects: setIssues.of(issues) });
  }

  getValue(): string {
    return this.view ? this.view.state.doc.toString() : "";
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
  }
}
