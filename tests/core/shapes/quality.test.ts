import { describe, expect, it } from "vitest";
import { MEASUREMENTS, failureHint, findMeasurement, qualityLine } from "../../../src/core/shapes/quality";
import { evaluate } from "../../helpers/shapes-spike-eval";

describe("quality", () => {
  it("names a measured model's result", () => {
    expect(qualityLine("qwen/qwen3.8-27b", "create")).toEqual({
      measured: true,
      text: "Measured: 9 of 10 test models came out right (2026-10-01).",
    });
    expect(qualityLine("QWEN/QWEN3.8-27B", "create").measured).toBe(true);
    expect(qualityLine("  qwen/qwen3.8-27b ", "create").measured).toBe(true);
  });

  it("never guesses for other spellings or aliases", () => {
    for (const m of ["qwen/qwen3.8-27b@4bit", "verdigado-pro", "qwen3.8", ""]) {
      expect(findMeasurement(m, "create"), m).toBeNull();
      expect(qualityLine(m, "create")).toEqual({
        measured: false,
        text: "Not measured for this model — small models (about 4B) got 4 of 10 right in the test.",
      });
    }
  });

  it("has no cross-task guess: refine is not measured for a create-only model", () => {
    expect(findMeasurement("qwen/qwen3.8-27b", "refine")).toBeNull();
    expect(qualityLine("qwen/qwen3.8-27b", "refine").measured).toBe(false);
  });

  it("points to a larger model when an answer fails", () => {
    expect(failureHint("google/gemma-4-e4b")).toBe(
      "The answer could not be turned into a model. Small models often fail at this — measured best: qwen/qwen3.8-27b, 9 of 10.",
    );
  });

  it("every entry names a precise source", () => {
    for (const m of MEASUREMENTS) expect(m.source).toMatch(/tests\/fixtures\/shapes-spike\/.+\.jsonl/);
  });

  it("re-derives the create counts from the Spike-A fixtures through the golden path", async () => {
    const q27 = (await evaluate("a-q27-dsl.jsonl")).filter((o) => o.plausible).length;
    const e4b = (await evaluate("a-e4b-dsl.jsonl")).filter((o) => o.plausible).length;
    const q = findMeasurement("qwen/qwen3.8-27b", "create");
    const e = findMeasurement("google/gemma-4-e4b", "create");
    expect(q).toMatchObject({ good: q27, of: 10 });
    expect(e).toMatchObject({ good: e4b, of: 10 });
  });
});
