// Messtabelle (Spec § 7.3): das Panel sagt nur, was gemessen ist. Pure.
// Kein Raten aus Familie oder Namen: endpoint-source liefert die Familie, nicht die Größe,
// und Aliasnamen sagen nichts. Neue Zeilen kommen NUR aus einem Messlauf (docs/LAB.md).
export type QualityTask = "create" | "refine";

export interface Measurement {
  model: string;
  mode: "structured";
  task: QualityTask;
  good: number;
  of: number;
  measuredAt: string;
  source: string;
}

// Jede Zahl ist am 2026-10-03 aus den aufgezeichneten Spike-A-Antworten neu abgeleitet (golden-Weg,
// Grenzen je Prompt wie im Spike, A01 mit Lochprüfung); quality.test.ts leitet sie bei jedem Lauf neu ab.
export const MEASUREMENTS: readonly Measurement[] = [
  {
    model: "qwen/qwen3.8-27b", mode: "structured", task: "create", good: 9, of: 10, measuredAt: "2026-10-01",
    source: "Spike A 2026-10-01, tests/fixtures/shapes-spike/a-q27-dsl.jsonl (+ a-q27-dsl-rerun.jsonl for A04), evaluated via tests/helpers/shapes-spike-eval.ts (golden-spike.test.ts)",
  },
  {
    model: "google/gemma-4-e4b", mode: "structured", task: "create", good: 4, of: 10, measuredAt: "2026-10-01",
    source: "Spike A 2026-10-01, tests/fixtures/shapes-spike/a-e4b-dsl.jsonl, evaluated via tests/helpers/shapes-spike-eval.ts (golden-spike.test.ts), A01 with hole check",
  },
];

/** Bezugszahl für ungemessene Modelle: das gemessene kleine Modell (Gemma 4B), nie als dessen eigenes Ergebnis gezeigt. */
function smallReference(): Measurement {
  const m = MEASUREMENTS.find((x) => x.model === "google/gemma-4-e4b" && x.task === "create");
  if (!m) throw new Error("quality: small reference measurement missing");
  return m;
}

export function findMeasurement(model: string, task: QualityTask): Measurement | null {
  const wanted = model.trim().toLowerCase();
  if (wanted === "") return null;
  return MEASUREMENTS.find((m) => m.task === task && m.model.toLowerCase() === wanted) ?? null;
}

export function qualityLine(model: string, task: QualityTask): { measured: boolean; text: string } {
  const m = findMeasurement(model, task);
  if (m) return { measured: true, text: `Measured: ${m.good} of ${m.of} test models came out right (${m.measuredAt}).` };
  const ref = smallReference();
  return {
    measured: false,
    text: `Not measured for this model — small models (about 4B) got ${ref.good} of ${ref.of} right in the test.`,
  };
}

export function failureHint(_model: string): string {
  // Bestes gemessenes create-Modell; Gleichstand: kleinerer Modellname zuerst (deterministisch).
  const best = MEASUREMENTS.filter((m) => m.task === "create")
    .sort((a, b) => b.good / b.of - a.good / a.of || a.model.localeCompare(b.model))[0];
  if (!best) return "The answer could not be turned into a model.";
  return `The answer could not be turned into a model. Small models often fail at this — measured best: ${best.model}, ${best.good} of ${best.of}.`;
}
