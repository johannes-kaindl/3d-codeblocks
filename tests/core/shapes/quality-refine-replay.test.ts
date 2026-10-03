// Replay: die aufgezeichneten Verfeinern-Antworten vom 2026-10-03 laufen über denselben Produktionsweg wie im
// Messlauf (runRefineCase mit eingespeister Antwort). Seit dem Formwechsel per `change` sind die zugehörigen
// Tabellenzeilen zurückgezogen (alter REFINE_SYSTEM); der Replay bleibt als REGRESSIONSTEST von Leser und
// Anwender auf aufgezeichneten Antworten (8 und 6 gut), ohne Bindung an MEASUREMENTS.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
