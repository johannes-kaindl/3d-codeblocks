// Trockenlauf des Messlauf-Ablaufs ohne Modell: derselbe Code (runCreateCase/runRefineCase) mit
// eingespeister Chat-Funktion. Ein Fehler im Messlauf soll hier auffallen, nicht in einem echten Lauf.
import { describe, expect, it } from "vitest";
import { CREATE_CASES, REFINE_CASES } from "../../helpers/shapes-cases";
import { changesAsAnswerText } from "../../helpers/shapes-refine-answers";
import { dryChat, runCreateCase, runRefineCase, type Chat } from "../../helpers/shapes-lab-run";

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
    expect(rec).toMatchObject({ id: "R01", good: false, status: 500, ms: 3 });
    expect(String(rec.error)).toContain("HTTP 500");
    const thrown: Chat = async () => { throw new Error("socket closed"); };
    expect(await runCreateCase(CREATE_CASES[0], thrown)).toMatchObject({ good: false, error: "socket closed" });
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
});
