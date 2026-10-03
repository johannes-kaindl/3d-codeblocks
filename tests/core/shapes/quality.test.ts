import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MEASUREMENTS, failureHint, findMeasurement, qualityLine } from "../../../src/core/shapes/quality";
import { evaluate } from "../../helpers/shapes-spike-eval";

describe("quality", () => {
  it("names a measured model's result", () => {
    expect(qualityLine("qwen/qwen3.8-27b", "create")).toEqual({
      measured: true,
      text: "Measured: 9 of 10 test prompts gave a plausible 3D model (2026-10-01).",
    });
    expect(qualityLine("QWEN/QWEN3.8-27B", "create").measured).toBe(true);
    expect(qualityLine("  qwen/qwen3.8-27b ", "create").measured).toBe(true);
  });

  it("never guesses for other spellings or aliases", () => {
    for (const m of ["qwen/qwen3.8-27b@4bit", "verdigado-pro", "qwen3.8", ""]) {
      expect(findMeasurement(m, "create"), m).toBeNull();
      expect(qualityLine(m, "create")).toEqual({
        measured: false,
        text: "Not measured for this model — the one small model tested (gemma-4-e4b) got 4 of 10 test prompts plausible.",
      });
    }
  });

  it("has no cross-task guess: refine is not measured for a create-only model", () => {
    expect(findMeasurement("qwen/qwen3.8-27b", "refine")).toBeNull();
    expect(qualityLine("qwen/qwen3.8-27b", "refine").measured).toBe(false);
  });

  it("points to a larger model when another model's answer fails", () => {
    const expected =
      "The answer could not be turned into a model. A larger model may do better — measured best: qwen/qwen3.8-27b, 9 of 10 test prompts plausible.";
    expect(failureHint("google/gemma-4-e4b")).toBe(expected);
    expect(failureHint("verdigado-pro")).toBe(expected);
  });

  it("does not point the best model at itself", () => {
    expect(failureHint("qwen/qwen3.8-27b")).toBe(
      "The answer could not be turned into a model. In the test this model got 9 of 10 test prompts plausible — try a simpler wording or a smaller change.",
    );
  });

  it("falls back to the bare sentence with an empty table", async () => {
    vi.resetModules();
    vi.doMock("../../../src/core/shapes/quality", async () => {
      const real = await vi.importActual<typeof import("../../../src/core/shapes/quality")>("../../../src/core/shapes/quality");
      (real.MEASUREMENTS as unknown as unknown[]).length = 0;
      return real;
    });
    const mod = await import("../../../src/core/shapes/quality");
    expect(mod.failureHint("x")).toBe("The answer could not be turned into a model.");
    vi.doUnmock("../../../src/core/shapes/quality");
    vi.resetModules();
  });

  it("every source names existing fixtures whose model field equals the table's model", async () => {
    for (const m of MEASUREMENTS) {
      const names = [...m.source.matchAll(/tests\/fixtures\/shapes-spike\/([\w.-]+\.jsonl)/g)].map((x) => x[1]);
      expect(names.length, m.model).toBeGreaterThan(0);
      for (const n of names) {
        const path = fileURLToPath(new URL(`../../fixtures/shapes-spike/${n}`, import.meta.url));
        expect(existsSync(path), n).toBe(true);
        const recs = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { model: string });
        for (const r of recs) expect(r.model, n).toBe(m.model);
      }
      if (m.task === "create") {
        const main = [...m.source.matchAll(/shapes-spike\/([\w.-]+\.jsonl)/g)][0][1];
        expect(await evaluate(main), m.model).toHaveLength(m.of);
      }
    }
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
