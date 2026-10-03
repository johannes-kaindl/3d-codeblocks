// Die Prüffunktionen der acht Verfeinern-Fälle gegen den festen Tisch: eine korrekte Liste muss
// bestehen, eine falsche (und die leere) durchfallen — sonst wäre eine Messzahl Unsinn.
import { describe, expect, it } from "vitest";
import { applyChanges } from "../../../src/core/shapes/changes";
import { REFINE_BASE, REFINE_CASES } from "../../helpers/shapes-cases";
import { REFINE_ALTERNATIVES, REFINE_CORRECT, REFINE_WRONG } from "../../helpers/shapes-refine-answers";

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
