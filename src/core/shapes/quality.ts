// Messtabelle (Spec § 7.3): das Panel sagt nur, was gemessen ist. Pure.
// Kein Raten aus Familie oder Namen: endpoint-source liefert die Familie, nicht die Größe,
// und Aliasnamen sagen nichts. Neue Zeilen kommen NUR aus einem Messlauf (Protokoll: docs/LAB.md,
// entsteht mit dem ersten Lab-Lauf). `measuredAt` ist je Eintrag das Datum des aufgezeichneten Laufs;
// die Zahlen leitet quality.test.ts bei jedem Lauf aus den Fixtures neu ab.
export type QualityTask = "create" | "refine";

export interface Measurement {
  model: string;
  /**
   * mode = the sampling mode the panel sends (spec § 7.1: structured, temperature 0.2 like the spike).
   * The spike itself sent only temperature 0.2 and max_tokens 14000, no response_format; JSON-only came
   * from its system prompt. The measurement used the spike's system prompt — if the panel's prompt
   * differs, the numbers describe the spike prompt.
   */
  mode: "structured";
  task: QualityTask;
  good: number;
  of: number;
  measuredAt: string;
  source: string;
}

export const MEASUREMENTS: readonly Measurement[] = [
  {
    model: "qwen/qwen3.8-27b", mode: "structured", task: "create", good: 9, of: 10, measuredAt: "2026-10-01",
    source: "Spike A 2026-10-01, tests/fixtures/shapes-spike/a-q27-dsl.jsonl (+ a-q27-dsl-rerun.jsonl for A04), evaluated via tests/helpers/shapes-spike-eval.ts (golden-spike.test.ts)",
  },
  {
    model: "google/gemma-4-e4b", mode: "structured", task: "create", good: 4, of: 10, measuredAt: "2026-10-01",
    source: "Spike A 2026-10-01, tests/fixtures/shapes-spike/a-e4b-dsl.jsonl, evaluated via tests/helpers/shapes-spike-eval.ts (golden-spike.test.ts). The spike recorded 5/10 without the hole check; 4/10 is re-derived (2026-10-03) with the stricter hole check on A01",
  },
];

/** Bezugszahl für ungemessene Modelle: das eine gemessene kleine Modell, nie als dessen eigenes Ergebnis gezeigt. */
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
  if (m) return { measured: true, text: `Measured: ${m.good} of ${m.of} test prompts gave a plausible 3D model (${m.measuredAt}).` };
  const ref = smallReference();
  const shortName = ref.model.slice(ref.model.lastIndexOf("/") + 1);
  return {
    measured: false,
    text: `Not measured for this model — the one small model tested (${shortName}) got ${ref.good} of ${ref.of} test prompts plausible.`,
  };
}

function bestCreate(): Measurement | null {
  // Gleichstand: Modellname alphabetisch zuerst (deterministisch).
  return MEASUREMENTS.filter((m) => m.task === "create")
    .sort((a, b) => b.good / b.of - a.good / a.of || a.model.localeCompare(b.model))[0] ?? null;
}

export function failureHint(model: string): string {
  const base = "The answer could not be turned into a model.";
  const best = bestCreate();
  if (!best) return base;
  const own = findMeasurement(model, "create");
  if (own && own.model === best.model) {
    return `${base} In the test this model got ${own.good} of ${own.of} test prompts plausible — try a simpler wording or a smaller change.`;
  }
  return `${base} A larger model may do better — measured best: ${best.model}, ${best.good} of ${best.of} test prompts plausible.`;
}
