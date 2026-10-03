// Replay: die aufgezeichneten Verfeinern-Antworten vom 2026-10-03 laufen über denselben Produktionsweg wie im
// Messlauf (runRefineCase mit eingespeister Antwort). Seit dem Formwechsel per `change` sind die zugehörigen
// Tabellenzeilen zurückgezogen (alter REFINE_SYSTEM); der Replay bleibt als REGRESSIONSTEST von Leser und
// Anwender auf aufgezeichneten Antworten (8 und 6 gut), ohne Bindung an MEASUREMENTS.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEASUREMENTS, findMeasurement } from "../../../src/core/shapes/quality";
import { promptSha } from "../../helpers/prompt-sha";
import { REFINE_CASES } from "../../helpers/shapes-cases";
import { runRefineCase } from "../../helpers/shapes-lab-run";

type Rec = Record<string, unknown>;

function load(name: string): Rec[] {
  const path = fileURLToPath(new URL(`../../fixtures/shapes-lab/${name}`, import.meta.url));
  return readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Rec);
}

export async function replay(recs: Rec[]): Promise<Record<string, Rec>> {
  const out: Record<string, Rec> = {};
  for (const r of recs) {
    if (r.summary === true) continue;
    const c = REFINE_CASES.find((x) => x.id === r.id);
    if (!c) throw new Error(`unknown case ${String(r.id)}`);
    out[c.id] = await runRefineCase(c, async () => ({ text: String(r.answer), ms: 0, status: 200 }));
  }
  return out;
}

const count = (o: Record<string, Rec>) => Object.values(o).filter((r) => r.outcome === "good").length;

const FIXTURES = [
  { file: "qwen3.8-27b-refine-2026-10-03.jsonl", model: "qwen/qwen3.8-27b", good: 8 },
  { file: "gemma-4-e4b-refine-2026-10-03.jsonl", model: "google/gemma-4-e4b", good: 6 },
];

describe("refine replay", () => {
  for (const f of FIXTURES) {
    it(`${f.model}: re-derives ${f.good} of 8 from the recorded answers (regression test, retired table row)`, async () => {
      const recs = load(f.file);
      const summary = recs.find((r) => r.summary === true)!;
      expect(summary).toMatchObject({ complete: true, dry: false, good: f.good, of: 8, model: f.model, task: "refine" });
      const out = await replay(recs);
      expect(Object.keys(out)).toHaveLength(8);
      expect(count(out)).toBe(f.good);
      // Jeder Fall stimmt mit der Aufzeichnung überein, nicht nur die Summe.
      for (const r of recs) if (r.summary !== true) expect(out[String(r.id)].outcome, String(r.id)).toBe(r.outcome);
    });
  }

  it("gemma: R01 and R07 are bad, the other six good", async () => {
    const out = await replay(load("gemma-4-e4b-refine-2026-10-03.jsonl"));
    expect(out.R01.outcome).toBe("bad");
    expect(out.R07.outcome).toBe("bad");
    expect(out.R07.error).toBeDefined();
    for (const id of ["R02", "R03", "R04", "R05", "R06", "R08"]) expect(out[id].outcome, id).toBe("good");
  });

  it("mutation probe: a tampered answer changes the count", async () => {
    const recs = load("qwen3.8-27b-refine-2026-10-03.jsonl");
    const tampered = recs.map((r) => (r.id === "R01" ? { ...r, answer: "```json\n{\"changes\": []}\n```" } : r));
    expect(count(await replay(tampered))).toBeLessThan(8);
  });
});

// Die Fixtures MIT dem neuen Prompt (Formwechsel per change, promptSha 71051822eb114cf6): sie tragen die Tabellenzeilen.
const NEW_FIXTURES = [
  { file: "qwen3.8-27b-refine-2026-10-03-71051822.jsonl", model: "qwen/qwen3.8-27b", good: 8 },
  { file: "gemma-4-e4b-refine-2026-10-03-71051822.jsonl", model: "google/gemma-4-e4b", good: 6 },
];

describe("refine replay of the current-prompt runs (backs the table rows)", () => {
  for (const f of NEW_FIXTURES) {
    it(`${f.model}: ${f.good} of 8 re-derived, outcomes equal the record, row matches`, async () => {
      const recs = load(f.file);
      const summary = recs.find((r) => r.summary === true)!;
      expect(summary).toMatchObject({ complete: true, dry: false, good: f.good, of: 8, model: f.model, task: "refine", promptSha: promptSha("refine") });
      const out = await replay(recs);
      expect(Object.keys(out)).toHaveLength(8);
      expect(count(out)).toBe(f.good);
      for (const r of recs) if (r.summary !== true) expect(out[String(r.id)].outcome, String(r.id)).toBe(r.outcome);
      const row = findMeasurement(f.model, "refine");
      expect(row).toMatchObject({ good: count(out), of: 8, promptSha: promptSha("refine") });
      expect(row?.source).toContain(f.file);
    });
  }

  it("gemma: R01 and R08 are bad, R07 is good now (shape change); R08 failed on adds without size", async () => {
    const out = await replay(load("gemma-4-e4b-refine-2026-10-03-71051822.jsonl"));
    expect(out.R01.outcome).toBe("bad");
    expect(out.R08.outcome).toBe("bad");
    expect(out.R07.outcome).toBe("good");
    expect(String(out.R08.error ?? JSON.stringify(out.R08))).toContain("`size` is missing");
    for (const id of ["R02", "R03", "R04", "R05", "R06"]) expect(out[id].outcome, id).toBe("good");
  });

  it("every shipped refine row has a replayed fixture and the current promptSha", () => {
    const rows = MEASUREMENTS.filter((m) => m.task === "refine");
    expect(rows).toHaveLength(NEW_FIXTURES.length);
    for (const m of rows) expect(m.promptSha).toBe(promptSha("refine"));
  });

  it("mutation probe: a tampered qwen answer changes the count", async () => {
    const recs = load("qwen3.8-27b-refine-2026-10-03-71051822.jsonl");
    const tampered = recs.map((r) => (r.id === "R07" ? { ...r, answer: "{\"changes\": []}" } : r));
    expect(count(await replay(tampered))).toBeLessThan(8);
  });
});
