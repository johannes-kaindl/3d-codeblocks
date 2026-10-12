// Prompts und Antwortleser für shapes. Pure. Der System-Prompt fürs Erzeugen ist WÖRTLICH
// der aus Spike A (2026-10-01) — er trägt die gemessenen 9/10. Jede Änderung (auch Whitespace)
// braucht einen neuen Messlauf; der Test pinnt ihn per SHA-256.
import { extractJsonCandidates } from "../../vendor/kit/llm-json";
import { parseShapes } from "./parse";

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

export const CREATE_SYSTEM = `Du baust 3D-Modelle aus einfachen Primitiven. Koordinaten in Metern, Y zeigt nach oben, X nach rechts, Z zum Betrachter. Antworte NUR mit JSON, ohne Erklärung:
{"parts":[{"name":"...","shape":"box|cylinder|sphere|cone","position":[x,y,z],"size":[...],"rotation_deg":[rx,ry,rz],"color":"#rrggbb"}]}
position = Mittelpunkt des Teils. size: box=[Breite X,Höhe Y,Tiefe Z] · cylinder/cone=[Radius,Höhe] (Achse entlang Y) · sphere=[Radius]. rotation_deg ist optional. Stelle das Objekt so, dass es auf y=0 steht. Löcher und Aussparungen baust du aus mehreren Teilen rund um die Lücke.`;

// ACHTUNG: wie CREATE_SYSTEM gemessen (Lab 2026-10-03, docs/LAB.md). Jede Änderung (auch Whitespace) an
// REFINE_SYSTEM oder an der Nutzer-Nachricht in buildRefineMessages braucht einen neuen Messlauf und eine
// neue Tabellenzeile; der Test pinnt beides per SHA-256, und `promptSha` der Tabellenzeile muss passen.
export const REFINE_SYSTEM = `Du änderst ein bestehendes 3D-Modell aus einfachen Primitiven. Koordinaten in Metern, Y zeigt nach oben, X nach rechts, Z zum Betrachter. position = Mittelpunkt des Teils. size: box=[Breite X,Höhe Y,Tiefe Z] · cylinder/cone=[Radius,Höhe] (Achse entlang Y) · sphere=[Radius].
Du bekommst die Teile als JSON und einen Änderungswunsch. Antworte NUR mit JSON, ohne Erklärung, und nenne NUR die Teile, die sich ändern:
{"changes":[{"op":"change","name":"<vorhandener Name>","shape":"box|cylinder|sphere|cone","position":[x,y,z],"size":[...],"rotation_deg":[rx,ry,rz],"color":"#rrggbb"},{"op":"add","name":"...","shape":"box|cylinder|sphere|cone","position":[x,y,z],"size":[...],"color":"#rrggbb"},{"op":"remove","name":"<vorhandener Name>"}]}
Bei "change" lässt du Felder weg, die gleich bleiben. Wechselst du die Form ("shape"), gib "size" für die neue Form mit.`;

export function buildCreateMessages(prompt: string): PromptMessage[] {
  return [
    { role: "system", content: CREATE_SYSTEM },
    { role: "user", content: prompt },
  ];
}

// ACHTUNG: Die Nutzer-Nachricht unten ist Teil des gemessenen Prompts (Vorlage `Teile:\n…\n\nÄnderung: …`).
// Eine Änderung braucht einen neuen Messlauf und eine neue Tabellenzeile (siehe REFINE_SYSTEM).
export function buildRefineMessages(currentText: string, instruction: string): PromptMessage[] {
  const parts = parseShapes(currentText).parts.map((p) => ({
    name: p.name,
    shape: p.kind,
    position: p.at,
    size: p.size,
    ...(p.rot.some((v) => v !== 0) ? { rotation_deg: p.rot } : {}),
    ...(p.color ? { color: p.color } : {}),
  }));
  return [
    { role: "system", content: REFINE_SYSTEM },
    { role: "user", content: `Teile:\n${JSON.stringify({ parts })}\n\nÄnderung: ${instruction}` },
  ];
}

type Extracted = { ok: true; values: unknown[]; truncated: boolean } | { ok: false; reason: string };

/** Alle lesbaren JSON-Kandidaten einer Antwort, in Lesereihenfolge: erst Zaun-Blöcke, dann der ganze Text.
 *  Der Scan ist das Kit-Modul `llm-json` (hier steht seine Referenz-Fassung seit Welle 18 nicht mehr); ein nie
 *  geschlossenes <think> verwirft den Rest, das Arbeitsbudget je Quelle hält degenerierte Antworten linear. */
function extractJson(text: string): Extracted {
  const found = extractJsonCandidates(text);
  if (found.ok) return found;
  return { ok: false, reason: found.reason === "no-json" ? "no JSON in the answer" : "the JSON is incomplete or broken" };
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
  | { op: "change"; name: string; shape?: string; at?: number[]; size?: number[]; rot?: number[]; color?: string }
  | { op: "add"; part: unknown }
  | { op: "remove"; name: string };

const numbers = (v: unknown): number[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : undefined;

const CHANGE_KEYS: ReadonlySet<string> = new Set(["op", "name", "shape", "position", "size", "rotation_deg", "color"]);
const ADD_KEYS: ReadonlySet<string> = new Set(["op", "name", "shape", "position", "size", "rotation_deg", "color"]);

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
      // `add` ist so streng wie `change`: ein unbekannter Schlüssel (`at`, `colour`, …) lässt den Eintrag scheitern.
      const unknownAddKey = Object.keys(item).find((k) => !ADD_KEYS.has(k));
      if (unknownAddKey !== undefined) return drop(`\`add\` has an unknown key \`${unknownAddKey}\``);
      changes.push({ op: "add", part: item });
    } else if (op === "remove" || op === "change") {
      if (name === "") return drop(`\`${op}\` needs a name`);
      if (op === "remove") {
        changes.push({ op: "remove", name });
        return;
      }
      // Jeder Schlüssel außerhalb der bekannten Felder lässt den Eintrag scheitern, statt still ignoriert
      // zu werden (sonst „gelingt“ ein vertipptes `colour` als Nichtstun).
      const unknownKey = Object.keys(item).find((k) => !CHANGE_KEYS.has(k));
      if (unknownKey !== undefined) return drop(`\`change\` has an unknown key \`${unknownKey}\``);
      const change: Extract<RawChange, { op: "change" }> = { op: "change", name };
      if (item.shape !== undefined) {
        if (typeof item.shape !== "string") return drop("`shape` must be text");
        change.shape = item.shape;
      }
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
      if (change.shape === undefined && change.at === undefined && change.size === undefined && change.rot === undefined && change.color === undefined) {
        return drop("`change` changes nothing");
      }
      changes.push(change);
    } else {
      drop(`unknown op \`${String(item.op)}\``);
    }
  });
  return { ok: true, changes, dropped };
}
