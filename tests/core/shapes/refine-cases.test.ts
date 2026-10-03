// Die Prüffunktionen der acht Verfeinern-Fälle gegen den festen Tisch: eine korrekte Liste muss
// bestehen, eine falsche (und die leere) durchfallen — sonst wäre eine Messzahl Unsinn.
import { describe, expect, it } from "vitest";
import { applyChanges } from "../../../src/core/shapes/changes";
import { REFINE_BASE, REFINE_CASES } from "../../helpers/shapes-cases";
import { runRefineCase } from "../../helpers/shapes-lab-run";
import { changesAsAnswerText, REFINE_ALTERNATIVES, REFINE_CORRECT, REFINE_CORRECT_SHAPE_CHANGE, REFINE_WRONG } from "../../helpers/shapes-refine-answers";

describe("refine cases are satisfiable and their checks are sound", () => {
  for (const c of REFINE_CASES) {
    it(`${c.id}: correct list passes, wrong and empty lists fail`, () => {
      const right = applyChanges(REFINE_BASE, REFINE_CORRECT[c.id]);
      expect(right.ok, JSON.stringify(right)).toBe(true);
      if (right.ok) expect(c.check(right.after)).toBe(true);

      [...(REFINE_ALTERNATIVES[c.id] ?? [])].forEach((alt, i) => {
        const r = applyChanges(REFINE_BASE, alt);
        expect(r.ok, `alternative ${i}: ${JSON.stringify(r)}`).toBe(true);
        if (r.ok) expect(c.check(r.after), `alternative ${i} must pass`).toBe(true);
      });

      REFINE_WRONG[c.id].forEach((list, i) => {
        const wrong = applyChanges(REFINE_BASE, list);
        expect(wrong.ok, `wrong ${i}: ${JSON.stringify(wrong)}`).toBe(true);
        if (wrong.ok) expect(c.check(wrong.after), `wrong ${i} must fail`).toBe(false);
      });

      const empty = applyChanges(REFINE_BASE, []);
      expect(empty.ok).toBe(true);
      if (empty.ok) expect(c.check(empty.after)).toBe(false);
    });
  }

  it("has an answer pair for every case and nothing else", () => {
    const ids = REFINE_CASES.map((c) => c.id).sort();
    expect(Object.keys(REFINE_CORRECT).sort()).toEqual(ids);
    expect(Object.keys(REFINE_WRONG).sort()).toEqual(ids);
  });
});

describe("R07 has two correct ways since Plan 3b: remove+add and shape change", () => {
  const r07 = REFINE_CASES.find((c) => c.id === "R07");

  it("both canned variants satisfy the check", () => {
    for (const [label, list] of [["remove+add", REFINE_CORRECT.R07], ["shape change", REFINE_CORRECT_SHAPE_CHANGE.R07]] as const) {
      const r = applyChanges(REFINE_BASE, list);
      expect(r.ok, label).toBe(true);
      expect(r.ok && r07?.check(r.after), label).toBe(true);
    }
  });

  it("the recorded gemma R07 situation (change with shape) now passes through runRefineCase", async () => {
    const handAuthored = '{"changes":[{"op":"change","name":"Bein-1","shape":"cylinder","size":[0.03,0.7]}]}';
    expect(changesAsAnswerText(REFINE_CORRECT_SHAPE_CHANGE.R07)).toBe(handAuthored);
    const rec = await runRefineCase(r07 as NonNullable<typeof r07>, async () => ({ text: handAuthored, ms: 0, status: 200 }));
    expect(rec).toMatchObject({ id: "R07", outcome: "good", good: true });
    expect(rec.error).toBeUndefined();
  });

  it("a shape change to a wrong form still fails the check", async () => {
    const wrong = '{"changes":[{"op":"change","name":"Bein-1","shape":"sphere","size":[0.1]}]}';
    const rec = await runRefineCase(r07 as NonNullable<typeof r07>, async () => ({ text: wrong, ms: 0, status: 200 }));
    expect(rec).toMatchObject({ id: "R07", outcome: "bad" });
  });
});
