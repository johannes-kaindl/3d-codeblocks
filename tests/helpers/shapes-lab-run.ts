// Ablauf eines Messlauf-Falls, geteilt von Messlauf (echtes Modell) und Trockenlauf-Test im Gate.
// `chat` wird eingespeist: der Messlauf ruft HTTP, der Trockenlauf liefert Fixture-Antworten.
// Derselbe Produktionsweg wie im Panel: Prompt → Antwort lesen → Text → Konverter → loadModel.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { applyChangesAnswer } from "../../src/core/shapes/changes";
import { buildCreateMessages, buildRefineMessages, readChangesAnswer, type PromptMessage } from "../../src/core/shapes/protocol";
import { promptSha } from "./prompt-sha";
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
  /** Länge (nicht Text) des Denkprotokolls eines Reasoning-Modells, falls mitgeliefert. */
  reasoningChars?: number;
}
export type Chat = (messages: PromptMessage[]) => Promise<ChatResult>;
export interface RunContext { run: string; dry: boolean }

const msg = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300);

/** POST mit node:http(s). Bewusst KEIN fetch: gemessen 2026-10-03 scheiterte ein Verfeinern-Fall, der länger als
 *  300 s generierte, mit UND_ERR_HEADERS_TIMEOUT, weil fetch/undici das Warten auf die Antwort-Header auf 300 s
 *  begrenzt (bei stream:false kommen die Header erst nach der ganzen Generierung). node:http hat diese Grenze nicht;
 *  das einzige Zeitlimit ist das Signal des Falls (kein `timeout`-Option, kein Keep-Alive-Agent). */
function post(url: string, body: string, signal: AbortSignal): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const request = u.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(u, {
      method: "POST",
      agent: false,
      signal,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
      res.on("close", () => { if (!res.complete) reject(Object.assign(new Error("connection closed before the response was complete"), { code: "ECONNRESET" })); });
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** HTTP-Chat gegen einen OpenAI-kompatiblen Endpunkt. Wirft nie; ein Fehler steht im Ergebnis. */
export function httpChat(url: string, model: string, temperature: number, timeoutMs: number = CASE_TIMEOUT_MS): Chat {
  return async (messages) => {
    const t0 = Date.now();
    const ms = () => Date.now() - t0;
    try {
      const res = await post(url, JSON.stringify({ model, temperature, max_tokens: 14000, stream: false, messages }), AbortSignal.timeout(timeoutMs));
      if (res.status !== 200) return { text: "", ms: ms(), status: res.status, error: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
      let json: { choices?: { message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: unknown }[]; usage?: unknown };
      try {
        json = JSON.parse(res.body) as typeof json;
      } catch {
        return { text: "", ms: ms(), status: res.status, error: "invalid JSON body" };
      }
      const choice = json?.choices?.[0];
      const content = choice?.message?.content;
      const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;
      const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
      const meta = {
        status: res.status,
        finishReason,
        usage: json?.usage,
        ...(typeof reasoning === "string" ? { reasoningChars: reasoning.length } : {}),
      };
      if (typeof content === "string") return { text: content, ms: ms(), ...meta };
      // Ein Reasoning-Modell, das sein Token-Budget im Denken verbraucht hat: content null/fehlt, aber
      // finish_reason "length" — das ist das Versagen des Modells (bad), kein Transportfehler.
      if (!Array.isArray(content) && finishReason === "length") return { text: "", ms: ms(), ...meta };
      const why = Array.isArray(content) ? "content is an array of parts, not text" : "response has no choices[0].message.content text";
      return { text: "", ms: ms(), ...meta, error: why };
    } catch (e) {
      const err = e as { name?: string; code?: unknown; cause?: { code?: unknown; message?: unknown } };
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError" || err?.code === "ABORT_ERR";
      const code = err?.code ?? err?.cause?.code ?? err?.cause?.message;
      const detail = code !== undefined && code !== "" ? ` (${String(code).slice(0, 120)})` : "";
      return { text: "", ms: ms(), timedOut, error: timedOut ? `timeout after ${timeoutMs / 1000} s` : `${msg(e)}${detail}` };
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
  if (r.reasoningChars !== undefined) rec.reasoningChars = r.reasoningChars;
  rec.answer = r.text.slice(0, 6000);
  if (r.text.length > 6000) rec.answerTruncated = true;
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

function finish(rec: Record<string, unknown>, ctx: RunContext, task: "create" | "refine"): Record<string, unknown> {
  rec.outcome ??= rec.good === true ? "good" : "bad";
  rec.good = rec.outcome === "good";
  return { ...rec, run: ctx.run, dry: ctx.dry, promptSha: promptSha(task) };
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
  return finish(rec, ctx, "create");
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
  return finish(rec, ctx, "refine");
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
  /** Prompt-Fingerabdruck (Regel: tests/helpers/prompt-sha.ts). */
  promptSha: string;
}

/** Einzige Vollständigkeits-Aussage eines Laufs: complete = jeder Fall hat eine Modellantwort (good/bad/timeout). */
export function summarize(recs: readonly Record<string, unknown>[], ctx: RunContext & { model: string; task: string }): { summary: LabSummary; line: string } {
  const count = (o: Outcome) => recs.filter((r) => r.outcome === o).length;
  const infraErrors = count("infra");
  const summary: LabSummary = {
    summary: true, run: ctx.run, model: ctx.model, task: ctx.task,
    complete: infraErrors === 0 && recs.length > 0, good: count("good"), of: recs.length,
    timeouts: count("timeout"), infraErrors, dry: ctx.dry,
    promptSha: promptSha(ctx.task === "refine" ? "refine" : "create"),
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
  const url = (env.SHAPES_LAB_URL ?? "").trim();
  const model = (env.SHAPES_LAB_MODEL ?? "").trim();
  if (!dry && (url === "" || model === "")) problems.push("a real run needs both SHAPES_LAB_URL and SHAPES_LAB_MODEL");
  else if (url !== "" && !/^https?:\/\/\S+$/.test(url)) problems.push(`SHAPES_LAB_URL must start with http:// or https://, got "${url}"`);
  const task = env.SHAPES_LAB_TASK ?? "create";
  if (task !== "create" && task !== "refine") problems.push(`SHAPES_LAB_TASK must be exactly "create" or "refine", got "${task}"`);
  const tRaw = env.SHAPES_LAB_TEMPERATURE;
  const plain = tRaw === undefined || /^\d+(\.\d+)?$/.test(tRaw.trim());
  const temperature = tRaw === undefined ? 0.2 : plain ? Number(tRaw.trim()) : NaN;
  if (!plain || temperature > 2) problems.push(`SHAPES_LAB_TEMPERATURE must be a plain decimal between 0 and 2, got "${tRaw}"`);
  if (problems.length > 0) return { active: true, ok: false, problems };
  return { active: true, ok: true, url, model, task: task as "create" | "refine", out: env.SHAPES_LAB_OUT ?? "", dry, temperature };
}
