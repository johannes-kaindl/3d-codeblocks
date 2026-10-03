// Trockenlauf des Messlauf-Ablaufs ohne Modell: derselbe Code (runCreateCase/runRefineCase) mit
// eingespeister Chat-Funktion. Ein Fehler im Messlauf soll hier auffallen, nicht in einem echten Lauf.
import { describe, expect, it } from "vitest";
import { CREATE_CASES, REFINE_CASES } from "../../helpers/shapes-cases";
import { changesAsAnswerText } from "../../helpers/shapes-refine-answers";
import { dryChat, readLabEnv, runCreateCase, runRefineCase, summarize, type Chat } from "../../helpers/shapes-lab-run";

describe("lab harness (dry, no model, no network)", () => {
  it("create: canned golden answers run prompt → read → convert → load → check", async () => {
    const recs = [];
    for (const c of CREATE_CASES) recs.push(await runCreateCase(c, dryChat("create", c.id)));
    expect(recs.filter((r) => r.error !== undefined && r.id !== "A07")).toEqual([]);
    expect(recs.every((r) => typeof r.parts === "number" || r.id === "A07")).toBe(true);
    // wie der Golden-Test: 9 von 10 plausibel, A07 nicht
    expect(recs.filter((r) => r.good).length).toBe(9);
    expect(recs.find((r) => r.good === false)?.id).toBe("A07");
  });

  it("refine: hand-authored correct lists run through the whole path, 8 of 8", async () => {
    const recs = [];
    for (const c of REFINE_CASES) recs.push(await runRefineCase(c, dryChat("refine", c.id)));
    expect(recs.map((r) => [r.id, r.good, r.error])).toEqual(REFINE_CASES.map((c) => [c.id, true, undefined]));
    expect(recs.every((r) => Array.isArray(r.dropped) && (r.dropped as unknown[]).length === 0)).toBe(true);
  });

  it("records a transport error without throwing", async () => {
    const failing: Chat = async () => ({ text: "", ms: 3, status: 500, error: "HTTP 500: boom" });
    const rec = await runRefineCase(REFINE_CASES[0], failing);
    expect(rec).toMatchObject({ id: "R01", good: false, outcome: "infra", status: 500, ms: 3 });
    expect(String(rec.error)).toContain("HTTP 500");
    const thrown: Chat = async () => { throw new Error("socket closed"); };
    expect(await runCreateCase(CREATE_CASES[0], thrown)).toMatchObject({ good: false, outcome: "infra", error: "socket closed" });
  });

  it("refine is all-or-nothing: a dropped item fails the case and records dropped + reasons", async () => {
    const good = JSON.parse(changesAsAnswerText([{ op: "change", name: "Platte", at: [0, 0.925, 0] }])) as { changes: unknown[] };
    good.changes.push({ op: "change", name: "Bein-1" }); // ändert nichts → vom Leser verworfen
    const chat: Chat = async () => ({ text: JSON.stringify(good), ms: 1 });
    const rec = await runRefineCase(REFINE_CASES[0], chat);
    expect(rec.good).toBe(false);
    expect(rec.dropped).toHaveLength(1);
    expect((rec.problems as string[])[0]).toContain("nothing applied");
  });

  it("an answer without usable JSON is a failed case, not an exception", async () => {
    const chat: Chat = async () => ({ text: "Sorry, no.", ms: 1 });
    expect(await runRefineCase(REFINE_CASES[1], chat)).toMatchObject({ id: "R02", good: false });
    expect(await runCreateCase(CREATE_CASES[1], chat)).toMatchObject({ id: "A02", good: false });
  });

  const ctx = { run: "test-run", dry: true };
  const sum = (recs: Record<string, unknown>[]) => summarize(recs, { ...ctx, model: "m", task: "refine" });

  it("every record carries outcome, run and dry", async () => {
    const rec = await runRefineCase(REFINE_CASES[2], dryChat("refine", "R03"), ctx);
    expect(rec).toMatchObject({ outcome: "good", good: true, run: "test-run", dry: true });
    const bad = await runRefineCase(REFINE_CASES[2], async () => ({ text: "{\"changes\":[]}", ms: 1 }), ctx);
    expect(bad).toMatchObject({ outcome: "bad", good: false });
  });

  it("transport error and HTTP 500 are infra and make the run INCOMPLETE", async () => {
    const down: Chat = async () => ({ text: "", ms: 2, error: "connect ECONNREFUSED" });
    const e500: Chat = async () => ({ text: "", ms: 2, status: 500, error: "HTTP 500: x" });
    const recs = [await runRefineCase(REFINE_CASES[0], dryChat("refine", "R01"), ctx), await runRefineCase(REFINE_CASES[1], down, ctx), await runRefineCase(REFINE_CASES[2], e500, ctx)];
    expect(recs.map((r) => r.outcome)).toEqual(["good", "infra", "infra"]);
    const { summary, line } = sum(recs);
    expect(summary).toMatchObject({ summary: true, complete: false, good: 1, of: 3, infraErrors: 2, timeouts: 0, dry: true });
    expect(line).toBe("INCOMPLETE refine m (infra errors: 2) — not measured");
  });

  it("a response whose content is not text (array, error object, no choices) is infra", async () => {
    const shape: Chat = async () => ({ text: "", ms: 1, status: 200, error: "content is an array of parts, not text" });
    const rec = await runCreateCase(CREATE_CASES[0], shape, ctx);
    expect(rec).toMatchObject({ outcome: "infra", status: 200 });
    expect(String(rec.error)).toContain("array of parts");
  });

  it("a timeout is a labelled result and the run stays COMPLETE", async () => {
    const slow: Chat = async () => ({ text: "", ms: 900_000, timedOut: true, error: "timeout after 900 s" });
    const recs = [await runRefineCase(REFINE_CASES[0], slow, ctx), await runRefineCase(REFINE_CASES[2], dryChat("refine", "R03"), ctx)];
    expect(recs.map((r) => [r.outcome, r.good])).toEqual([["timeout", false], ["good", true]]);
    const { summary, line } = sum(recs);
    expect(summary).toMatchObject({ complete: true, good: 1, of: 2, timeouts: 1, infraErrors: 0 });
    expect(line).toBe("COMPLETE refine m: 1 of 2 (timeouts: 1)");
  });

  it("empty content with finish_reason length is the model's failure (bad), not infra", async () => {
    const cut: Chat = async () => ({ text: "", ms: 5, status: 200, finishReason: "length", usage: { completion_tokens: 14000 } });
    const rec = await runCreateCase(CREATE_CASES[1], cut, ctx);
    expect(rec).toMatchObject({ outcome: "bad", good: false, finish_reason: "length", status: 200 });
    expect(rec.usage).toEqual({ completion_tokens: 14000 });
    expect(sum([rec]).summary.complete).toBe(true);
  });

  it("create records how many parts the converter dropped", async () => {
    const chat: Chat = async () => ({ text: JSON.stringify({ parts: [{ name: "a", shape: "box", position: [0, 0, 0], size: [1, 1, 1] }, { name: "b", shape: "blob", size: [1] }] }), ms: 1 });
    expect((await runCreateCase(CREATE_CASES[1], chat, ctx)).partsDropped).toBe(1);
  });

  it("an empty run is never complete", () => {
    expect(sum([]).summary.complete).toBe(false);
  });

  it("env is read strictly", () => {
    expect(readLabEnv({})).toEqual({ active: false });
    const bad = (e: Record<string, string>) => { const r = readLabEnv(e); return r.active && !r.ok ? r.problems.join("|") : "ok"; };
    expect(bad({ SHAPES_LAB_URL: "http://x" })).toContain("both SHAPES_LAB_URL and SHAPES_LAB_MODEL");
    expect(bad({ SHAPES_LAB_URL: "u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TASK: "Refine" })).toContain("TASK");
    expect(bad({ SHAPES_LAB_URL: "u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TEMPERATURE: "abc" })).toContain("TEMPERATURE");
    expect(bad({ SHAPES_LAB_URL: "u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TEMPERATURE: "-1" })).toContain("TEMPERATURE");
    expect(bad({ SHAPES_LAB_URL: "u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TEMPERATURE: "" })).toContain("TEMPERATURE");
    expect(bad({ SHAPES_LAB_DRY: "yes" })).toContain("DRY");
    expect(readLabEnv({ SHAPES_LAB_DRY: "1" })).toMatchObject({ active: true, ok: true, task: "create", temperature: 0.2, dry: true });
    expect(readLabEnv({ SHAPES_LAB_URL: "u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TASK: "refine", SHAPES_LAB_TEMPERATURE: "0" })).toMatchObject({ ok: true, task: "refine", temperature: 0 });
  });
});
