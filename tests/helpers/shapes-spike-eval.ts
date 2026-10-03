// Gemeinsamer Auswertungsweg für die Spike-A-Antworten (aus golden-spike.test.ts herausgezogen, unverändert):
// readPartsAnswer → partsFromLlm → formatShapes → convertShapesText → loadModel, Grenzen je Prompt.
import { readFileSync } from "node:fs";
import { Box3, Mesh, Vector3 } from "three";
import { convertShapesText } from "../../src/core/shapes/convert";
import { formatShapes, partsFromLlm } from "../../src/core/shapes/format";
import { readPartsAnswer } from "../../src/core/shapes/protocol";
import { loadModel } from "../../src/viewer/loaders";
import { CREATE_CASES } from "./shapes-cases";

// Eine Quelle: die Grenzen stammen aus den geteilten Fällen (Spike A, vorab festgelegt).
export const LIMITS: Record<string, { minParts: number; dims: [number, number][] }> = Object.fromEntries(
  CREATE_CASES.map((c) => [c.id, { minParts: c.minParts, dims: c.dims }]),
);

export interface Outcome { id: string; loaded: boolean; plausible: boolean }

export function readRecords(file: string): { id: string; answer?: string; error?: string }[] {
  const read = (f: string) => readFileSync(new URL(`../fixtures/shapes-spike/${f}`, import.meta.url), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l) as { id: string; answer?: string; error?: string });
  const records = read(file);
  // Ein Spike-Lauf hatte bei A04 einen Netzwerkfehler ("fetch failed"), keine Modellantwort. Der Spike
  // hat genau diesen Eintrag selbst wiederholt (*-rerun.jsonl); ein Fehlersatz ohne Antwort wird dadurch
  // ersetzt. Fehlt die Ersetzung, brechen wir ab, damit ein fehlender Satz nie als "geladen" durchgeht.
  const rerun = file === "a-q27-dsl.jsonl" ? read("a-q27-dsl-rerun.jsonl") : [];
  return records.map((rec) => {
    if (rec.error === undefined || rec.answer !== undefined) return rec;
    const repl = rerun.find((r) => r.id === rec.id && r.answer !== undefined);
    if (!repl) throw new Error(`Fehlersatz ohne Wiederholung in ${file}: ${rec.id}`);
    return repl;
  });
}

export async function evaluate(file: string): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const rec of readRecords(file)) {
    const id = rec.id.slice(0, 3);
    const answer = readPartsAnswer(rec.answer ?? "");
    if (!answer.ok) { out.push({ id, loaded: false, plausible: false }); continue; }
    const text = formatShapes({}, partsFromLlm(answer.parts).parts);
    const converted = convertShapesText(text);
    if (!converted.ok) { out.push({ id, loaded: false, plausible: false }); continue; }
    const bytes = new TextEncoder().encode(JSON.stringify(converted.gltf)).buffer as ArrayBuffer;
    const scene = (await loadModel(bytes, "gltf", "#888888")).object;
    scene.updateMatrixWorld(true);
    let parts = 0;
    scene.traverse((o) => { if ((o as Mesh).isMesh) parts += 1; });
    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    const dims = [size.x, size.y, size.z];
    const limit = LIMITS[id];
    const plausible = parts >= limit.minParts && dims.every((v, i) => v >= limit.dims[i][0] && v <= limit.dims[i][1]);
    out.push({ id, loaded: parts >= 1, plausible });
  }
  return out;
}

