// Teile-Diff zweier Stände, als Anzeigezeilen (Spec § 6.1, Runden UND Versionen). Pure.
//
// Regeln (der Diff entscheidet, was die Nutzerin annimmt, er muss wahrhaftig sein):
// - Paarung über den EXAKTEN Teilnamen. Doppelte Namen (der Parser lehnt sie ab, die Funktion
//   darf trotzdem nicht fallen) werden der Reihe nach gepaart: erstes mit erstem, zweites mit
//   zweitem; Übriggebliebene sind added bzw. removed.
// - Gleichheit entscheidet auf den ROHEN Zahlen (elementweise, NaN gleich NaN, -0 gleich 0). Der
//   Parser behält jede Dezimalstelle, 0.12344 und 0.12341 sind verschiedene Werte.
// - Angezeigt wird über formatNumber (4 Nachkommastellen). Sind die Rohwerte verschieden, die
//   gedruckten Texte aber gleich, wird das Feld beidseitig mit voller Genauigkeit (String(n))
//   gedruckt, damit eine Änderung nie wie eine leere Änderung aussieht.
// - Reine Umordnung wird nicht gezeigt: die Textreihenfolge der Teile ist keine Geometrie.
// - Gleicher Name, andere Form: ein "changed"-Eintrag mit Feld `shape`, kein removed+added.
// - Reihenfolge der Ausgabe: `after`, danach entfernte Teile in `before`-Reihenfolge.
import { formatNumber, isZero } from "./format";
import type { ShapeDraft } from "./types";

export type Field = "shape" | "size" | "at" | "rot" | "color";

export type PartDiff =
  | { name: string; change: "removed" }
  | { name: string; change: "added"; detail: string }
  | { name: string; change: "changed"; fields: { field: Field; from: string; to: string }[] };

const nums = (v: readonly number[]): string => v.map(formatNumber).join(" ");
const same = (a: number, b: number): boolean => a === b || (Number.isNaN(a) && Number.isNaN(b));
const vecEqual = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => same(x, b[i] ?? NaN));
const full = (v: readonly number[]): string => v.map(String).join(" ");

/** Feld-Eintrag, wenn die Rohwerte verschieden sind; sonst null. */
function vecField(field: Field, b: readonly number[], p: readonly number[]): { field: Field; from: string; to: string } | null {
  if (vecEqual(b, p)) return null;
  if (nums(b) === nums(p)) return { field, from: full(b), to: full(p) };
  return { field, from: nums(b), to: nums(p) };
}

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
    const sizeField = vecField("size", b.size, p.size);
    if (sizeField) fields.push(sizeField);
    const atField = vecField("at", b.at, p.at);
    if (atField) fields.push(atField);
    const rotField = vecField("rot", b.rot, p.rot);
    if (rotField) fields.push(rotField);
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
