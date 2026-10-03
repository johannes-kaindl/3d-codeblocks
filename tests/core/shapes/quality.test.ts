import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MEASUREMENTS, failureHint, findMeasurement, qualityLine } from "../../../src/core/shapes/quality";
import { promptSha } from "../../helpers/prompt-sha";
import { BASE, REFINE_BASE } from "../../helpers/shapes-cases";
import { CREATE_CASES } from "../../helpers/shapes-cases";
import { parseShapes } from "../../../src/core/shapes/parse";
import { runCreateCase } from "../../helpers/shapes-lab-run";
import { evaluate } from "../../helpers/shapes-spike-eval";

describe("quality", () => {
  it("names a measured model's result", () => {
    expect(qualityLine("qwen/qwen3.8-27b", "create")).toEqual({
      measured: true,
      text: "Measured: 9 of 10 test prompts gave a plausible 3D model (qwen/qwen3.8-27b, 2026-10-01, n=1 per prompt).",
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

  it("has no cross-task guess: a create row never answers a refine question", () => {
    expect(findMeasurement("verdigado-pro", "refine")).toBeNull();
    expect(qualityLine("qwen/qwen3.8-27b", "refine").text).toBe("Measured: 8 of 8 test change requests were applied correctly (qwen/qwen3.8-27b, 2026-10-03, n=1 per request).");
    expect(qualityLine("google/gemma-4-e4b", "refine").text).toBe("Measured: 6 of 8 test change requests were applied correctly (google/gemma-4-e4b, 2026-10-03, n=1 per request).");
  });

  it("uses task-aware texts for refine", () => {
    expect(qualityLine("verdigado-pro", "refine")).toEqual({
      measured: false,
      text: "Not measured for this model — the one small model tested (gemma-4-e4b) got 6 of 8 test change requests right.",
    });
  });

  it("refine failure hint: best refine model, never the create statistics", () => {
    expect(failureHint("google/gemma-4-e4b", "refine")).toBe(
      "The change list could not be applied. A larger model may do better — measured best: qwen/qwen3.8-27b, 8 of 8 test change requests applied correctly.",
    );
    expect(failureHint("qwen/qwen3.8-27b", "refine")).toBe(
      "The change list could not be applied. In the test this model got 8 of 8 test change requests applied correctly — try a simpler wording or a smaller change.",
    );
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
      const names = [...m.source.matchAll(/tests\/fixtures\/(shapes-spike|shapes-lab)\/([\w.-]+\.jsonl)/g)].map((x) => [x[1], x[2]]);
      expect(names.length, m.model).toBeGreaterThan(0);
      for (const [dir, n] of names) {
        const path = fileURLToPath(new URL(`../../fixtures/${dir}/${n}`, import.meta.url));
        expect(existsSync(path), n).toBe(true);
        const recs = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { model?: string });
        for (const r of recs) if (r.model !== undefined) expect(r.model, n).toBe(m.model);
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

  it("every row carries the promptSha of the CURRENT prompt of its task (a prompt edit retires the rows)", () => {
    for (const m of MEASUREMENTS) expect(m.promptSha, `${m.model} ${m.task}`).toBe(promptSha(m.task));
  });

  it("falls back to the plain sentence when no reference row exists (M-2)", () => {
    expect(qualityLine("x", "refine", [])).toEqual({ measured: false, text: "Not measured for this model." });
    expect(qualityLine("x", "create", [])).toEqual({ measured: false, text: "Not measured for this model." });
  });

  it("falls back to the create sentence when there is no small refine row", () => {
    const table = MEASUREMENTS.filter((m) => !(m.task === "refine" && m.model === "google/gemma-4-e4b"));
    expect(qualityLine("x", "refine", table).text).toContain("4 of 10 test prompts plausible");
  });

  it("replays the create control run through the production path: 9 of 10, A07 bad (M-1)", async () => {
    const path = fileURLToPath(new URL("../../fixtures/shapes-lab/qwen3.8-27b-create-2026-10-03.jsonl", import.meta.url));
    const recs = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const summary = recs.find((r) => r.summary === true);
    expect(summary).toMatchObject({ complete: true, dry: false, good: 9, of: 10 });
    const cases = recs.filter((r) => r.summary !== true);
    expect(cases).toHaveLength(10);
    const outcomes: Record<string, string> = {};
    for (const r of cases) {
      const answer = String(r.answer);
      expect(answer.length, `${String(r.id)} would be truncated`).toBeLessThan(6000);
      const c = CREATE_CASES.find((x) => x.id === r.id);
      if (!c) throw new Error(`unknown case ${String(r.id)}`);
      outcomes[c.id] = String((await runCreateCase(c, async () => ({ text: answer, ms: 0, status: 200 }))).outcome);
      expect(outcomes[c.id], c.id).toBe(r.outcome);
    }
    expect(Object.values(outcomes).filter((o) => o === "good")).toHaveLength(9);
    expect(outcomes.A07).toBe("bad");
  });

  it("the hand-mirrored BASE equals the parsed REFINE_BASE (M-8)", () => {
    const parsed = parseShapes(REFINE_BASE).parts.map((p) => ({ kind: p.kind, name: p.name, size: p.size, at: p.at, rot: p.rot, color: p.color }));
    expect(BASE).toEqual(parsed);
  });
});
