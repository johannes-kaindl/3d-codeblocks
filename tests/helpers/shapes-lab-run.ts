// Ablauf eines Messlauf-Falls, geteilt von Messlauf (echtes Modell) und Trockenlauf-Test im Gate.
// `chat` wird eingespeist: der Messlauf ruft HTTP, der Trockenlauf liefert Fixture-Antworten.
// Derselbe Produktionsweg wie im Panel: Prompt → Antwort lesen → Text → Konverter → loadModel.
import { Box3, Mesh, Vector3 } from "three";
import { applyChangesAnswer } from "../../src/core/shapes/changes";
import { convertShapesText } from "../../src/core/shapes/convert";
import { formatShapes, partsFromLlm } from "../../src/core/shapes/format";
import { buildCreateMessages, buildRefineMessages, readChangesAnswer, readPartsAnswer, type PromptMessage } from "../../src/core/shapes/protocol";
import { loadModel } from "../../src/viewer/loaders";
import { CREATE_CASES, REFINE_BASE, REFINE_CASES } from "./shapes-cases";
import { REFINE_CORRECT, changesAsAnswerText } from "./shapes-refine-answers";
import { readRecords } from "./shapes-spike-eval";

export interface ChatResult { text: string; ms: number; status?: number; error?: string }
export type Chat = (messages: PromptMessage[]) => Promise<ChatResult>;

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
        signal: AbortSignal.timeout(900_000),
      });
      if (!res.ok) return { text: "", ms: Date.now() - t0, status: res.status, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") return { text: "", ms: Date.now() - t0, status: res.status, error: "response has no choices[0].message.content" };
      return { text: content, ms: Date.now() - t0, status: res.status };
    } catch (e) {
      return { text: "", ms: Date.now() - t0, error: msg(e) };
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

export async function runCreateCase(c: (typeof CREATE_CASES)[number], chat: Chat): Promise<Record<string, unknown>> {
  const rec: Record<string, unknown> = { id: c.id };
  try {
    const r = await chat(buildCreateMessages(c.prompt));
    rec.ms = r.ms;
    if (r.status !== undefined) rec.status = r.status;
    rec.answer = r.text.slice(0, 6000);
    if (r.error) throw new Error(r.error);
    const answer = readPartsAnswer(r.text);
    if (!answer.ok) throw new Error(answer.reason);
    const converted = convertShapesText(formatShapes({}, partsFromLlm(answer.parts).parts));
    if (!converted.ok) throw new Error(converted.messages.join(" "));
    const scene = (await loadModel(new TextEncoder().encode(JSON.stringify(converted.gltf)).buffer as ArrayBuffer, "gltf", "#888888")).object;
    scene.updateMatrixWorld(true);
    let parts = 0;
    scene.traverse((o) => { if ((o as Mesh).isMesh) parts += 1; });
    const s = new Box3().setFromObject(scene).getSize(new Vector3());
    const dims = [s.x, s.y, s.z];
    rec.parts = parts;
    rec.size = dims.map((v) => +v.toFixed(3));
    rec.good = parts >= c.minParts && dims.every((v, i) => v >= c.dims[i][0] && v <= c.dims[i][1]);
  } catch (e) {
    rec.good = false;
    rec.error = msg(e);
  }
  return rec;
}

export async function runRefineCase(c: (typeof REFINE_CASES)[number], chat: Chat): Promise<Record<string, unknown>> {
  const rec: Record<string, unknown> = { id: c.id };
  try {
    const r = await chat(buildRefineMessages(REFINE_BASE, c.instruction));
    rec.ms = r.ms;
    if (r.status !== undefined) rec.status = r.status;
    rec.answer = r.text.slice(0, 6000);
    if (r.error) throw new Error(r.error);
    const answer = readChangesAnswer(r.text);
    if (answer.ok) rec.dropped = answer.dropped;
    // Alles oder nichts: ein verworfener Eintrag lässt den Fall scheitern (Gründe stehen in problems).
    const applied = applyChangesAnswer(REFINE_BASE, answer);
    if (!applied.ok) {
      rec.problems = applied.problems;
      throw new Error(applied.problems.join("; "));
    }
    rec.good = c.check(applied.after);
  } catch (e) {
    rec.good = false;
    rec.error = msg(e);
  }
  return rec;
}
