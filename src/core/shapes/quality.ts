// Messtabelle (Spec § 7.3): das Panel sagt nur, was gemessen ist. Pure.
// Kein Raten aus Familie oder Namen: endpoint-source liefert die Familie, nicht die Größe,
// und Aliasnamen sagen nichts. Neue Zeilen kommen NUR aus einem Messlauf (Protokoll: docs/LAB.md). `measuredAt` ist je Eintrag das Datum des aufgezeichneten Laufs;
// die Zahlen leitet quality.test.ts bei jedem Lauf aus den Fixtures neu ab.
// Die Messungen liefen mit temperature 0.2, max_tokens 14000 und ohne response_format; das Panel muss
// dasselbe Sampling senden oder neu messen. `promptSha` bindet jede Zeile an den gemessenen Prompt
// (Regel: tests/helpers/prompt-sha.ts); ändert sich der Prompt, wird die Zeile ungültig und gehört nach
// docs/LAB.md in die Liste der zurückgezogenen Zeilen.
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
  /** Fingerabdruck des gemessenen Prompts (System + Vorlage), siehe tests/helpers/prompt-sha.ts. */
  promptSha: string;
  source: string;
}

export const MEASUREMENTS: readonly Measurement[] = [
  {
    model: "qwen/qwen3.8-27b", mode: "structured", task: "create", good: 9, of: 10, measuredAt: "2026-10-01", promptSha: "6d29c7c76d4532f2",
    source: "Spike A 2026-10-01, tests/fixtures/shapes-spike/a-q27-dsl.jsonl (+ tests/fixtures/shapes-spike/a-q27-dsl-rerun.jsonl for A04), evaluated via tests/helpers/shapes-spike-eval.ts (golden-spike.test.ts). The lab control run on 2026-10-03 through the production code reproduced 9 of 10 (A07 bad again): tests/fixtures/shapes-lab/qwen3.8-27b-create-2026-10-03.jsonl",
  },
  {
    model: "google/gemma-4-e4b", mode: "structured", task: "create", good: 4, of: 10, measuredAt: "2026-10-01", promptSha: "6d29c7c76d4532f2",
    source: "Spike A 2026-10-01, tests/fixtures/shapes-spike/a-e4b-dsl.jsonl, evaluated via tests/helpers/shapes-spike-eval.ts (golden-spike.test.ts). The spike recorded 5/10 without the hole check; 4/10 is re-derived (2026-10-03) with the stricter hole check on A01",
  },
  // Verfeinern: keine Zeilen. Die zwei Zeilen vom 2026-10-03 (qwen 8/8, gemma 6/8) maßen den alten REFINE_SYSTEM
  // und sind seit dem Formwechsel per `change` zurückgezogen (docs/LAB.md, Retired rows); neue Zeilen kommen
  // aus dem Messlauf mit dem jetzigen Prompt.
];

/** Bezugszahl für ungemessene Modelle: das eine gemessene kleine Modell, nie als dessen eigenes Ergebnis gezeigt. */
const SMALL_MODEL = "google/gemma-4-e4b";

function smallReference(task: QualityTask, table: readonly Measurement[]): Measurement | null {
  return table.find((x) => x.model === SMALL_MODEL && x.task === task) ?? null;
}

export function findMeasurement(model: string, task: QualityTask, table: readonly Measurement[] = MEASUREMENTS): Measurement | null {
  const wanted = model.trim().toLowerCase();
  if (wanted === "") return null;
  return table.find((m) => m.task === task && m.model.toLowerCase() === wanted) ?? null;
}

const NOUN: Record<QualityTask, { measured: string; plural: string }> = {
  create: { measured: "test prompts gave a plausible 3D model", plural: "test prompts plausible" },
  refine: { measured: "test change requests were applied correctly", plural: "test change requests right" },
};

export function qualityLine(model: string, task: QualityTask, table: readonly Measurement[] = MEASUREMENTS): { measured: boolean; text: string } {
  const m = findMeasurement(model, task, table);
  if (m) return { measured: true, text: `Measured: ${m.good} of ${m.of} ${NOUN[task].measured} (${m.model}, ${m.measuredAt}, n=1 per ${task === "refine" ? "request" : "prompt"}).` };
  // Kein kleiner Verfeinern-Eintrag: auf den Erstellen-Satz zurückfallen.
  const refTask: QualityTask = smallReference(task, table) ? task : "create";
  const ref = smallReference(refTask, table);
  if (!ref) return { measured: false, text: "Not measured for this model." };
  const shortName = ref.model.slice(ref.model.lastIndexOf("/") + 1);
  return {
    measured: false,
    text: `Not measured for this model — the one small model tested (${shortName}) got ${ref.good} of ${ref.of} ${NOUN[refTask].plural}.`,
  };
}

function best(task: QualityTask, table: readonly Measurement[]): Measurement | null {
  // Gleichstand: Modellname alphabetisch zuerst (deterministisch).
  return table.filter((m) => m.task === task)
    .sort((a, b) => b.good / b.of - a.good / a.of || a.model.localeCompare(b.model))[0] ?? null;
}

export function failureHint(model: string, task: QualityTask = "create", table: readonly Measurement[] = MEASUREMENTS): string {
  const base = task === "refine" ? "The change list could not be applied." : "The answer could not be turned into a model.";
  const noun = task === "refine" ? "test change requests applied correctly" : "test prompts plausible";
  const top = best(task, table);
  if (!top) return base;
  const own = findMeasurement(model, task, table);
  if (own && own.model === top.model) {
    return `${base} In the test this model got ${own.good} of ${own.of} ${noun} — try a simpler wording or a smaller change.`;
  }
  return `${base} A larger model may do better — measured best: ${top.model}, ${top.good} of ${top.of} ${noun}.`;
}
