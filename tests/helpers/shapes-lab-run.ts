// Ablauf eines Messlauf-Falls, geteilt von Messlauf (echtes Modell) und Trockenlauf-Test im Gate.
// `chat` wird eingespeist: der Messlauf ruft HTTP, der Trockenlauf liefert Fixture-Antworten.
// Derselbe Produktionsweg wie im Panel: Prompt → Antwort lesen → Text → Konverter → loadModel.
import { applyChangesAnswer } from "../../src/core/shapes/changes";
import { buildCreateMessages, buildRefineMessages, readChangesAnswer, type PromptMessage } from "../../src/core/shapes/protocol";
import { CREATE_CASES, REFINE_BASE, REFINE_CASES } from "./shapes-cases";
import { REFINE_CORRECT, changesAsAnswerText } from "./shapes-refine-answers";
import { measureCreate, readRecords } from "./shapes-spike-eval";

// Ergebnisarten je Fall: good/bad = das Modell hat geantwortet (gut bzw. nicht gut), timeout = der Fall lief
// länger als CASE_TIMEOUT_MS (ein gültiges, beschriftetes Ergebnis, zählt als nicht gut), infra = Transport-,
// HTTP- oder Antwortform-Fehler (nichts gemessen, der Lauf ist dann unvollständig).
export type Outcome = "good" | "bad" | "timeout" | "infra";
export const CASE_TIMEOUT_MS = 900_000;

export interface ChatResult {
  text: string;
  ms: number;
  status?: number;
  error?: string;
  /** true = das Zeitlimit des Falls hat ausgelöst. */
  timedOut?: boolean;
  finishReason?: string;
  usage?: unknown;
}
export type Chat = (messages: PromptMessage[]) => Promise<ChatResult>;
export interface RunContext { run: string; dry: boolean }

const msg = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300);

/** HTTP-Chat gegen einen OpenAI-kompatiblen Endpunkt. Wirft nie; ein Fehler steht im Ergebnis. */
export function httpChat(url: string, model: string, temperature: number): Chat {
  return async (messages) => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, temperature, max_tokens: 14000, stream: false, messages }),
        signal: AbortSignal.timeout(CASE_TIMEOUT_MS),
      });
      const ms = () => Date.now() - t0;
      if (res.status !== 200) return { text: "", ms: ms(), status: res.status, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const json = (await res.json()) as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: unknown };
      const choice = json.choices?.[0];
      const content = choice?.message?.content;
      const meta = { status: res.status, finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined, usage: json.usage };
      if (typeof content !== "string") {
        const why = Array.isArray(content) ? "content is an array of parts, not text" : "response has no choices[0].message.content text";
        return { text: "", ms: ms(), ...meta, error: why };
      }
      return { text: content, ms: ms(), ...meta };
    } catch (e) {
      const name = (e as Error)?.name;
      const timedOut = name === "TimeoutError" || name === "AbortError";
      return { text: "", ms: Date.now() - t0, timedOut, error: timedOut ? `timeout after ${CASE_TIMEOUT_MS / 1000} s` : msg(e) };
    }
  };
}

/** Trockenlauf: Antworten aus den Golden-Fixtures (Erzeugen) bzw. den von Hand verfassten korrekten Listen (Verfeinern). */
export function dryChat(task: "create" | "refine", caseId: string): Chat {
  return async () => {
    if (task === "create") {
      const rec = readRecords("a-q27-dsl.jsonl").find((r) => r.id.slice(0, 3) === caseId);
      return { text: rec?.answer ?? "", ms: 0, ...(rec?.answer === undefined ? { error: `no canned answer for ${caseId}` } : {}) };
    }
    const list = REFINE_CORRECT[caseId];
    return { text: list ? changesAsAnswerText(list) : "", ms: 0, ...(list ? {} : { error: `no canned answer for ${caseId}` }) };
  };
}

/** Gemeinsamer Anfang beider Fälle: Chat rufen, Transportfehler und Zeitlimit einordnen. */
async function ask(rec: Record<string, unknown>, chat: Chat, messages: PromptMessage[]): Promise<ChatResult | null> {
  let r: ChatResult;
  try {
    r = await chat(messages);
  } catch (e) {
    rec.outcome = "infra";
    rec.error = msg(e);
    return null;
  }
  rec.ms = r.ms;
  if (r.status !== undefined) rec.status = r.status;
  if (r.finishReason !== undefined) rec.finish_reason = r.finishReason;
  if (r.usage !== undefined) rec.usage = r.usage;
  rec.answer = r.text.slice(0, 6000);
  if (r.timedOut) {
    rec.outcome = "timeout";
    rec.error = r.error ?? "timeout";
    return null;
  }
  if (r.error) {
    rec.outcome = "infra";
    rec.error = r.error;
    return null;
  }
  return r;
}

function finish(rec: Record<string, unknown>, ctx: RunContext): Record<string, unknown> {
  rec.outcome ??= rec.good === true ? "good" : "bad";
  rec.good = rec.outcome === "good";
  return { ...rec, run: ctx.run, dry: ctx.dry };
}

export async function runCreateCase(c: (typeof CREATE_CASES)[number], chat: Chat, ctx: RunContext = { run: "adhoc", dry: false }): Promise<Record<string, unknown>> {
  const rec: Record<string, unknown> = { id: c.id };
  try {
    const r = await ask(rec, chat, buildCreateMessages(c.prompt));
    if (r) {
      const m = await measureCreate(r.text, c);
      rec.partsDropped = m.dropped;
      if (m.error !== undefined) rec.error = m.error.slice(0, 300);
      if (m.parts !== null) { rec.parts = m.parts; rec.size = m.size; }
      rec.good = m.plausible;
    }
  } catch (e) {
    rec.good = false;
    rec.error = msg(e);
  }
  return finish(rec, ctx);
}

export async function runRefineCase(c: (typeof REFINE_CASES)[number], chat: Chat, ctx: RunContext = { run: "adhoc", dry: false }): Promise<Record<string, unknown>> {
  const rec: Record<string, unknown> = { id: c.id };
  try {
    const r = await ask(rec, chat, buildRefineMessages(REFINE_BASE, c.instruction));
    if (r) {
      const answer = readChangesAnswer(r.text);
      if (answer.ok) rec.dropped = answer.dropped;
      // Alles oder nichts: ein verworfener Eintrag lässt den Fall scheitern (Gründe stehen in problems).
      const applied = applyChangesAnswer(REFINE_BASE, answer);
      if (!applied.ok) {
        rec.problems = applied.problems;
        rec.error = applied.problems.join("; ").slice(0, 300);
        rec.good = false;
      } else {
        rec.good = c.check(applied.after);
      }
    }
  } catch (e) {
    rec.good = false;
    rec.error = msg(e);
  }
  return finish(rec, ctx);
}

export interface LabSummary {
  summary: true;
  run: string;
  model: string;
  task: string;
  complete: boolean;
  good: number;
  of: number;
  timeouts: number;
  infraErrors: number;
  dry: boolean;
}

/** Einzige Vollständigkeits-Aussage eines Laufs: complete = jeder Fall hat eine Modellantwort (good/bad/timeout). */
export function summarize(recs: readonly Record<string, unknown>[], ctx: RunContext & { model: string; task: string }): { summary: LabSummary; line: string } {
  const count = (o: Outcome) => recs.filter((r) => r.outcome === o).length;
  const infraErrors = count("infra");
  const summary: LabSummary = {
    summary: true, run: ctx.run, model: ctx.model, task: ctx.task,
    complete: infraErrors === 0 && recs.length > 0, good: count("good"), of: recs.length,
    timeouts: count("timeout"), infraErrors, dry: ctx.dry,
  };
  const line = summary.complete
    ? `COMPLETE ${ctx.task} ${ctx.model}: ${summary.good} of ${summary.of} (timeouts: ${summary.timeouts})`
    : `INCOMPLETE ${ctx.task} ${ctx.model} (infra errors: ${infraErrors}) — not measured`;
  return { summary, line };
}

export type LabEnv =
  | { active: false }
  | { active: true; ok: false; problems: string[] }
  | { active: true; ok: true; url: string; model: string; task: "create" | "refine"; out: string; dry: boolean; temperature: number };

/** Liest SHAPES_LAB_* streng: ist irgendeine Variable gesetzt, ist jeder falsche Wert ein Fehler (nie stilles Überspringen). */
export function readLabEnv(env: Record<string, string | undefined>): LabEnv {
  const keys = ["URL", "MODEL", "TASK", "OUT", "TEMPERATURE", "DRY"].map((k) => `SHAPES_LAB_${k}`);
  if (!keys.some((k) => env[k] !== undefined)) return { active: false };
  const problems: string[] = [];
  const dryRaw = env.SHAPES_LAB_DRY;
  if (dryRaw !== undefined && dryRaw !== "1" && dryRaw !== "0") problems.push(`SHAPES_LAB_DRY must be 1 or 0, got "${dryRaw}"`);
  const dry = dryRaw === "1";
  const url = env.SHAPES_LAB_URL ?? "";
  const model = env.SHAPES_LAB_MODEL ?? "";
  if (!dry && (url === "" || model === "")) problems.push("a real run needs both SHAPES_LAB_URL and SHAPES_LAB_MODEL");
  const task = env.SHAPES_LAB_TASK ?? "create";
  if (task !== "create" && task !== "refine") problems.push(`SHAPES_LAB_TASK must be exactly "create" or "refine", got "${task}"`);
  const tRaw = env.SHAPES_LAB_TEMPERATURE;
  const temperature = tRaw === undefined ? 0.2 : tRaw.trim() === "" ? NaN : Number(tRaw);
  if (!Number.isFinite(temperature) || temperature < 0) problems.push(`SHAPES_LAB_TEMPERATURE must be a number >= 0, got "${tRaw}"`);
  if (problems.length > 0) return { active: true, ok: false, problems };
  return { active: true, ok: true, url, model, task: task as "create" | "refine", out: env.SHAPES_LAB_OUT ?? "", dry, temperature };
}
