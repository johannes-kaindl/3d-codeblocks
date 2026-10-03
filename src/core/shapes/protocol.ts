// Prompts und Antwortleser für shapes. Pure. Der System-Prompt fürs Erzeugen ist WÖRTLICH
// der aus Spike A (2026-10-01) — er trägt die gemessenen 9/10. Jede Änderung (auch Whitespace)
// braucht einen neuen Messlauf; der Test pinnt ihn per SHA-256.
import { fenceFor } from "./fence";
import { parseShapes } from "./parse";

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

export const CREATE_SYSTEM = `Du baust 3D-Modelle aus einfachen Primitiven. Koordinaten in Metern, Y zeigt nach oben, X nach rechts, Z zum Betrachter. Antworte NUR mit JSON, ohne Erklärung:
{"parts":[{"name":"...","shape":"box|cylinder|sphere|cone","position":[x,y,z],"size":[...],"rotation_deg":[rx,ry,rz],"color":"#rrggbb"}]}
position = Mittelpunkt des Teils. size: box=[Breite X,Höhe Y,Tiefe Z] · cylinder/cone=[Radius,Höhe] (Achse entlang Y) · sphere=[Radius]. rotation_deg ist optional. Stelle das Objekt so, dass es auf y=0 steht. Löcher und Aussparungen baust du aus mehreren Teilen rund um die Lücke.`;

export const REFINE_SYSTEM = `Du änderst ein bestehendes 3D-Modell aus einfachen Primitiven. Koordinaten in Metern, Y zeigt nach oben, X nach rechts, Z zum Betrachter. position = Mittelpunkt des Teils. size: box=[Breite X,Höhe Y,Tiefe Z] · cylinder/cone=[Radius,Höhe] (Achse entlang Y) · sphere=[Radius].
Du bekommst die Teile als JSON und einen Änderungswunsch. Antworte NUR mit JSON, ohne Erklärung, und nenne NUR die Teile, die sich ändern:
{"changes":[{"op":"change","name":"<vorhandener Name>","position":[x,y,z],"size":[...],"rotation_deg":[rx,ry,rz],"color":"#rrggbb"},{"op":"add","name":"...","shape":"box|cylinder|sphere|cone","position":[x,y,z],"size":[...],"color":"#rrggbb"},{"op":"remove","name":"<vorhandener Name>"}]}
Bei "change" lässt du Felder weg, die gleich bleiben. Die Form eines Teils änderst du, indem du es entfernst und unter demselben Namen neu hinzufügst.`;

export function buildCreateMessages(prompt: string): PromptMessage[] {
  return [
    { role: "system", content: CREATE_SYSTEM },
    { role: "user", content: prompt },
  ];
}

export function buildRefineMessages(currentText: string, instruction: string): PromptMessage[] {
  const parts = parseShapes(currentText).parts.map((p) => ({
    name: p.name,
    shape: p.kind,
    position: p.at,
    size: p.size,
    ...(p.rot.some((v) => v !== 0) ? { rotation_deg: p.rot } : {}),
    ...(p.color ? { color: p.color } : {}),
  }));
  // Der Quelltext steht unverändert in einem Zaun, den er selbst nicht schließen kann (länger als
  // jeder Backtick-Lauf darin); der Wunsch steht danach und kann den Zaun nicht verwechseln.
  const fence = fenceFor(currentText);
  return [
    { role: "system", content: REFINE_SYSTEM },
    {
      role: "user",
      content: `Teile:\n${JSON.stringify({ parts })}\n\nQuelltext (unverändert):\n${fence}shapes\n${currentText}\n${fence}\n\nÄnderung: ${instruction}`,
    },
  ];
}

/** Ab dem Zeichen `start` (`[` oder `{`) bis zur passenden Klammer, Strings beachtet; null wenn offen. */
function balancedEnd(s: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return null;
    }
  }
  return null;
}

type Extracted = { ok: true; values: unknown[]; truncated: boolean } | { ok: false; reason: string };

/** Alle lesbaren JSON-Kandidaten einer Antwort, in Lesereihenfolge: erst Zaun-Blöcke, dann der ganze Text. */
function extractJson(text: string): Extracted {
  let clean = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const strayClose = clean.lastIndexOf("</think>");
  if (strayClose >= 0) clean = clean.slice(strayClose + "</think>".length);
  const unterminated = clean.indexOf("<think>");
  if (unterminated >= 0) clean = clean.slice(0, unterminated);

  const sources = [...[...clean.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? ""), clean];
  const values: unknown[] = [];
  let sawStart = false;
  let truncated = false; // eine Klammer wurde geöffnet und nie geschlossen: die Antwort ist abgeschnitten
  for (const src of sources) {
    for (let i = 0; i < src.length; i++) {
      if (src[i] !== "[" && src[i] !== "{") continue;
      sawStart = true;
      const end = balancedEnd(src, i);
      if (end === null) {
        truncated = true;
        continue;
      }
      try {
        values.push(JSON.parse(src.slice(i, end + 1)));
        i = end; // nichts Verschachteltes noch einmal als eigener Kandidat
      } catch {
        // kein JSON (Prosa mit Klammern): weitersuchen
      }
    }
  }
  if (values.length > 0) return { ok: true, values, truncated };
  return sawStart ? { ok: false, reason: "the JSON is incomplete or broken" } : { ok: false, reason: "no JSON in the answer" };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Erste Liste unter `key` (Objekt) oder nackte Liste aus Objekten; sonst Begründung. */
function pickList(
  json: { values: unknown[]; truncated: boolean },
  key: string,
): { ok: true; list: unknown[] } | { ok: false; reason: string } {
  for (const v of json.values) {
    if (isRecord(v) && Array.isArray(v[key])) return { ok: true, list: v[key] as unknown[] };
    if (Array.isArray(v) && v.every(isRecord)) return { ok: true, list: v };
  }
  if (json.truncated) return { ok: false, reason: "the JSON is incomplete or broken" };
  return { ok: false, reason: `the JSON has no \`${key}\` list` };
}

export function readPartsAnswer(text: string): { ok: true; parts: unknown[] } | { ok: false; reason: string } {
  const json = extractJson(text);
  if (!json.ok) return json;
  const picked = pickList(json, "parts");
  return picked.ok ? { ok: true, parts: picked.list } : picked;
}

export type RawChange =
  | { op: "change"; name: string; at?: number[]; size?: number[]; rot?: number[]; color?: string }
  | { op: "add"; part: unknown }
  | { op: "remove"; name: string };

const numbers = (v: unknown): number[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : undefined;

export function readChangesAnswer(
  text: string,
): { ok: true; changes: RawChange[]; dropped: { index: number; reason: string }[] } | { ok: false; reason: string } {
  const json = extractJson(text);
  if (!json.ok) return json;
  const picked = pickList(json, "changes");
  if (!picked.ok) return picked;

  const changes: RawChange[] = [];
  const dropped: { index: number; reason: string }[] = [];
  picked.list.forEach((item, index) => {
    const drop = (reason: string): void => void dropped.push({ index, reason });
    if (!isRecord(item)) return drop("not an object");
    const op = typeof item.op === "string" ? item.op.trim().toLowerCase() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (op === "add") {
      changes.push({ op: "add", part: item });
    } else if (op === "remove" || op === "change") {
      if (name === "") return drop(`\`${op}\` needs a name`);
      if (op === "remove") {
        changes.push({ op: "remove", name });
        return;
      }
      const change: Extract<RawChange, { op: "change" }> = { op: "change", name };
      if (item.position !== undefined) {
        const at = numbers(item.position);
        if (!at || at.length !== 3) return drop("`position` must be three numbers");
        change.at = at;
      }
      if (item.size !== undefined) {
        const size = numbers(item.size);
        if (!size) return drop("`size` must be a list of numbers");
        change.size = size;
      }
      if (item.rotation_deg !== undefined) {
        const rot = numbers(item.rotation_deg);
        if (!rot || rot.length !== 3) return drop("`rotation_deg` must be three numbers");
        change.rot = rot;
      }
      if (item.color !== undefined) {
        if (typeof item.color !== "string") return drop("`color` must be text");
        change.color = item.color;
      }
      if (change.at === undefined && change.size === undefined && change.rot === undefined && change.color === undefined) {
        return drop("`change` changes nothing");
      }
      changes.push(change);
    } else {
      drop(`unknown op \`${String(item.op)}\``);
    }
  });
  return { ok: true, changes, dropped };
}
