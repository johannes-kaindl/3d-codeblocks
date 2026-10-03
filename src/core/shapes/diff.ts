// Teile-Diff zweier Stände, als Anzeigezeilen (Spec § 6.1, Runden UND Versionen). Pure.
//
// Regeln (der Diff entscheidet, was die Nutzerin annimmt, er muss wahrhaftig sein):
// - Paarung über den EXAKTEN Teilnamen. Doppelte Namen (der Parser lehnt sie ab, die Funktion
//   darf trotzdem nicht fallen) werden der Reihe nach gepaart: erstes mit erstem, zweites mit
//   zweitem; Übriggebliebene sind added bzw. removed.
// - Zahlen gelten als gleich, wenn sie GEDRUCKT gleich sind (formatNumber). Rundungsunterschiede,
//   die im Text unsichtbar sind, erscheinen nicht als Änderung.
// - Reine Umordnung wird nicht gezeigt: die Textreihenfolge der Teile ist keine Geometrie.
// - Gleicher Name, andere Form: ein "changed"-Eintrag mit Feld `shape`, kein removed+added.
// - Reihenfolge der Ausgabe: `after`, danach entfernte Teile in `before`-Reihenfolge.
import { formatNumber } from "./format";
import type { ShapeDraft } from "./types";

type Field = "shape" | "size" | "at" | "rot" | "color";

export type PartDiff =
  | { name: string; change: "removed" }
  | { name: string; change: "added"; detail: string }
  | { name: string; change: "changed"; fields: { field: Field; from: string; to: string }[] };

const nums = (v: readonly number[]): string => v.map(formatNumber).join(" ");
const isZero = (v: readonly number[]): boolean => v.every((x) => formatNumber(x) === "0");

function describe(p: ShapeDraft): string {
  const bits = [p.kind, `size ${nums(p.size)}`];
  if (!isZero(p.at)) bits.push(`at ${nums(p.at)}`);
  if (!isZero(p.rot)) bits.push(`rot ${nums(p.rot)}`);
  if (p.color !== null) bits.push(`color ${p.color}`);
  return bits.join(", ");
}

export function diffParts(before: readonly ShapeDraft[], after: readonly ShapeDraft[]): PartDiff[] {
  const pending = new Map<string, ShapeDraft[]>();
  for (const p of before) {
    const list = pending.get(p.name);
    if (list) list.push(p);
    else pending.set(p.name, [p]);
  }
  const out: PartDiff[] = [];
  const cursor = new Map<string, number>();
  for (const p of after) {
    const i = cursor.get(p.name) ?? 0;
    const b = pending.get(p.name)?.[i];
    if (!b) {
      out.push({ name: p.name, change: "added", detail: describe(p) });
      continue;
    }
    cursor.set(p.name, i + 1);
    const fields: { field: Field; from: string; to: string }[] = [];
    if (b.kind !== p.kind) fields.push({ field: "shape", from: b.kind, to: p.kind });
    if (nums(b.size) !== nums(p.size)) fields.push({ field: "size", from: nums(b.size), to: nums(p.size) });
    if (nums(b.at) !== nums(p.at)) fields.push({ field: "at", from: nums(b.at), to: nums(p.at) });
    if (nums(b.rot) !== nums(p.rot)) fields.push({ field: "rot", from: nums(b.rot), to: nums(p.rot) });
    if (b.color !== p.color) fields.push({ field: "color", from: b.color ?? "default", to: p.color ?? "default" });
    if (fields.length > 0) out.push({ name: p.name, change: "changed", fields });
  }
  // Entfernt = je Name alle `before`-Teile ab dem Zähler (nach Index, nicht nach Objektidentität).
  const seen = new Map<string, number>();
  for (const p of before) {
    const k = seen.get(p.name) ?? 0;
    seen.set(p.name, k + 1);
    if (k >= (cursor.get(p.name) ?? 0)) out.push({ name: p.name, change: "removed" });
  }
  return out;
}

export function formatDiff(entry: PartDiff): string {
  if (entry.change === "removed") return `${entry.name}: removed`;
  if (entry.change === "added") return `${entry.name}: added (${entry.detail})`;
  return `${entry.name}: ${entry.fields.map((f) => `${f.field} ${f.from} → ${f.to}`).join("; ")}`;
}
