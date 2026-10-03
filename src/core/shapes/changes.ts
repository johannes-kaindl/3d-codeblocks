// Änderungsliste auf shapes-Text anwenden (Spec § 4.1). Pure.
// - Nur Zeilen genannter Teile werden ersetzt/entfernt; alles andere bleibt BYTE-GLEICH
//   (Zeilenenden je Zeile erhalten, auch gemischte; Schluss-Umbruch bleibt oder fehlt wie vorher).
// - Auffüll-Adapter: fehlt einem `change` ein Feld, gilt der Bestand.
// - Round-Trip-Wächter: der erzeugte Text wird neu geparst; `after` stammt aus diesem Parse, und
//   verlorene oder verschobene Werte (mehr als 4 Nachkommastellen) lassen die Liste scheitern.
// - Alles oder nichts: ein Problem → nichts geändert, Liste der Probleme zurück.
// - Eine Zeile mit unbekannten Wörtern (Parse-Warnung) wird NIE umgeschrieben: das Umformatieren
//   würde die Wörter stillschweigend löschen. Stattdessen scheitert die ganze Liste.
// - Einziger Einstieg für Modellantworten: `applyChangesAnswer` (nimmt das GANZE Leser-Ergebnis).
import { formatNumber, formatPartLine, partsFromLlm } from "./format";
import { normalizeColor, normalizeSize, parseShapes } from "./parse";
import type { RawChange, readChangesAnswer } from "./protocol";
import { SHAPE_KINDS, type ShapeDraft, type ShapeKind, type ShapePart, type Vec3 } from "./types";

export type ApplyResult =
  | { ok: true; text: string; before: ShapeDraft[]; after: ShapeDraft[] }
  | { ok: false; problems: string[] };

const toDraft = (p: ShapePart): ShapeDraft => ({
  kind: p.kind,
  name: p.name,
  size: [...p.size],
  at: [...p.at],
  rot: [...p.rot],
  color: p.color,
});

/** NFC + klein, ohne Leerraum/Bindestrich/Unterstrich. */
const fold = (name: string): string => name.normalize("NFC").toLowerCase().replace(/[\s_-]+/g, "");

export type Match = { kind: "found"; name: string } | { kind: "none" } | { kind: "ambiguous"; candidates: string[] };

/** Gefaltet vergleichen (Groß/Klein, Leerraum, `-`, `_`, NFC). Mehr als ein Treffer — auch mit einem
 *  exakten darunter — ist mehrdeutig; ein leerer gefalteter Name trifft nie. */
export function matchPart(names: readonly string[], wanted: string): Match {
  const key = fold(wanted);
  if (key === "") return { kind: "none" };
  const hits = names.filter((n) => fold(n) === key);
  if (hits.length === 1) return { kind: "found", name: hits[0] };
  return hits.length === 0 ? { kind: "none" } : { kind: "ambiguous", candidates: hits };
}

/** Wert so, wie `formatNumber` ihn schreibt — damit Zustand, Text und Re-Parse dasselbe meinen. */
const printed = (n: number): number => Number(formatNumber(n));
const printedVec = (v: Vec3): Vec3 => [printed(v[0]), printed(v[1]), printed(v[2])];

function vec(name: string, field: string, v: number[] | undefined, fallback: Vec3, problems: string[]): Vec3 {
  if (v === undefined) return fallback;
  if (v.length !== 3 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    problems.push(`\`${name}\`: \`${field}\` needs 3 numbers`);
    return fallback;
  }
  return printedVec([v[0], v[1], v[2]]);
}

/** `add` ist so streng wie `change`: ein vorhandener, aber kaputter Wert wird nie zum Standardwert. */
function addFaults(part: unknown): string[] {
  if (typeof part !== "object" || part === null || Array.isArray(part)) return [];
  const rec = part as Record<string, unknown>;
  const label = typeof rec.name === "string" && rec.name.trim() !== "" ? `\`${rec.name.trim()}\`` : "unnamed part";
  const out: string[] = [];
  if (rec.shape === undefined) out.push(`${label}: \`add\` needs a \`shape\``);
  for (const field of ["position", "rotation_deg"]) {
    const v = rec[field];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
      out.push(`${label}: \`${field}\` needs 3 numbers`);
    }
  }
  if (rec.color !== undefined && (typeof rec.color !== "string" || normalizeColor(rec.color) === null)) {
    out.push(`${label}: \`color\` needs a hex colour like #8b5a2b`);
  }
  return out;
}

interface Entry {
  text: string;
  /** Zeilenende hinter dieser Zeile, wie im Original ("" = letzte Zeile). */
  sep: string;
  removed?: boolean;
}

interface State {
  draft: ShapeDraft;
  /** 0-basierte Ursprungszeile, -1 = neu. */
  line: number;
}

export function applyChanges(text: string, changes: readonly RawChange[]): ApplyResult {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const pieces = text.split(/(\r\n|\n)/);
  const entries: Entry[] = [];
  for (let i = 0; i < pieces.length; i += 2) entries.push({ text: pieces[i], sep: pieces[i + 1] ?? "" });

  const parsed = parseShapes(text);
  const before: ShapeDraft[] = parsed.parts.map(toDraft);
  const unknownWords = new Set(parsed.warnings.filter((w) => w.message.startsWith("Unknown word")).map((w) => w.line));

  const state = new Map<string, State>();
  const order: string[] = [];
  for (const p of parsed.parts) {
    state.set(p.name, { draft: toDraft(p), line: p.line - 1 });
    order.push(p.name);
  }
  const problems: string[] = [];
  const touched = new Set<string>();
  // Namen von Teilzeilen, die der Parser mit Fehler verworfen hat (z. B. doppelter Name).
  const errorNames = new Set<string>();
  for (const err of parsed.errors) {
    const toks = (entries[err.line - 1]?.text ?? "").trim().split(/\s+/);
    if ((SHAPE_KINDS as readonly string[]).includes((toks[0] ?? "").toLowerCase()) && toks[1] !== undefined) errorNames.add(fold(toks[1]));
  }

  changes.forEach((change, ci) => {
    const label = `change ${ci + 1}`;
    if (change.op === "add") {
      const faults = addFaults(change.part);
      if (faults.length > 0) {
        problems.push(...faults.map((f) => `${label} (add): ${f}`));
        return;
      }
      // Namenlose Teile nummerieren über die ganze Liste (laufende Teilezahl), nicht je Eintrag ab 1.
      const { parts, dropped } = partsFromLlm([change.part], state.size);
      const draft = parts[0];
      if (dropped.length > 0 || draft === undefined) {
        problems.push(`${label} (add): ${dropped[0]?.reason ?? "unreadable"}`);
        return;
      }
      draft.size = draft.size.map(printed);
      draft.at = printedVec(draft.at);
      draft.rot = printedVec(draft.rot);
      const clash = [...state.keys()].filter((n) => fold(n) === fold(draft.name));
      if (clash.length > 0) {
        problems.push(`${label} (add): a part named \`${clash[0]}\` already exists — remove it first or pick another name`);
        return;
      }
      state.set(draft.name, { draft, line: -1 });
      order.push(draft.name);
      return;
    }

    const names = [...state.keys()];
    const m = matchPart(names, change.name);
    if (m.kind === "none") {
      problems.push(`${label}: no part named \`${change.name}\` (available: ${names.join(", ") || "none"})`);
      return;
    }
    if (m.kind === "ambiguous") {
      problems.push(`${label}: \`${change.name}\` matches more than one part: ${m.candidates.join(", ")}`);
      return;
    }
    const found = m.name;
    if (errorNames.has(fold(found))) {
      problems.push(`${label}: \`${found}\` appears on a line with an error — fix the text first`);
      return;
    }
    touched.add(found);
    const entry = state.get(found) as State;

    if (change.op === "remove") {
      if (entry.line >= 0) (entries[entry.line]).removed = true;
      state.delete(found);
      order.splice(order.indexOf(found), 1);
      return;
    }

    const d = entry.draft;
    const own: string[] = [];
    // Formwechsel: `shape` (Groß/Klein und Leerraum wie bei den Formwörtern im Parser) bestimmt die Art, nach der
    // `size` geprüft wird. Gleiche Art ist ein Nichtstun; eine andere Art braucht eine `size` für die neue Form.
    let kind: ShapeKind = d.kind;
    if (change.shape !== undefined) {
      const wanted = change.shape.trim().toLowerCase();
      if (!(SHAPE_KINDS as readonly string[]).includes(wanted)) {
        problems.push(`${label}: \`${found}\`: unknown shape \`${change.shape}\``);
        return;
      }
      kind = wanted as ShapeKind;
      if (kind !== d.kind && change.size === undefined) {
        problems.push(`${label}: \`${found}\`: changing the shape needs a \`size\` for a ${kind}`);
        return;
      }
    }
    let size = d.size;
    if (change.size !== undefined) {
      const raw = change.size;
      const normalized =
        raw.every((v) => typeof v === "number" && Number.isFinite(v)) ? normalizeSize(kind, raw) : "`size` values must be finite numbers";
      if (typeof normalized === "string") own.push(`\`${found}\`: ${normalized}`);
      else if (normalized.some((v) => formatNumber(v) === "0")) own.push(`\`${found}\`: \`size\` values must be at least 0.0001`);
      else size = normalized.map(printed);
    }
    let color = d.color;
    if (change.color !== undefined) {
      const normalized = normalizeColor(change.color);
      if (normalized === null) own.push(`\`${found}\`: \`color\` needs a hex colour like #8b5a2b`);
      else color = normalized;
    }
    const at = vec(found, "at", change.at, d.at, own);
    const rot = vec(found, "rot", change.rot, d.rot, own);
    if (own.length > 0) {
      problems.push(...own.map((m) => `${label}: ${m}`));
      return;
    }
    entry.draft = { ...d, kind, size, color, at, rot };
  });

  if (problems.length > 0) return { ok: false, problems };

  // Geänderte vorhandene Teile an ihrer Zeile neu schreiben — nur wenn sich etwas änderte.
  for (const p of parsed.parts) {
    const s = state.get(p.name);
    if (!s || s.line < 0) continue;
    if (JSON.stringify(s.draft) === JSON.stringify(toDraft(p))) continue;
    if (unknownWords.has(p.line)) {
      problems.push(`line ${p.line} has unrecognised words — fix it by hand first`);
      continue;
    }
    const e = entries[p.line - 1];
    const indent = /^\s*/.exec(e.text)?.[0] ?? "";
    e.text = indent + formatPartLine(s.draft);
  }
  if (problems.length > 0) return { ok: false, problems };

  // Neue Teile hinter die letzte ursprüngliche Teilzeile (sonst ans Ende, vor den Schluss-Umbruch).
  const added = order.filter((n) => (state.get(n) as State).line < 0).map((n) => formatPartLine((state.get(n) as State).draft));
  if (added.length > 0) {
    const lastPartIdx = Math.max(-1, ...parsed.parts.map((p) => p.line - 1));
    const fresh: Entry[] = added.map((t) => ({ text: t, sep: eol }));
    const needSep = (e: Entry | undefined): void => {
      if (e && e.sep === "") e.sep = eol;
    };
    if (lastPartIdx >= 0) {
      needSep(entries[lastPartIdx]);
      entries.splice(lastPartIdx + 1, 0, ...fresh);
    } else if (entries.length === 1 && (entries[0]).text === "") {
      entries.splice(0, 1, ...fresh);
    } else {
      const trailingBlank = entries.length > 1 && (entries[entries.length - 1]).text === "";
      if (!trailingBlank) needSep(entries[entries.length - 1]);
      entries.splice(trailingBlank ? entries.length - 1 : entries.length, 0, ...fresh);
    }
  }

  const kept = entries.filter((e) => !e.removed);
  // Das Original endete ohne Zeilenende-Zeichen hinter der letzten Zeile; das bleibt so.
  const last = kept[kept.length - 1];
  if (last) last.sep = "";
  const out = kept.map((e) => e.text + e.sep).join("");
  const expected = order.map((n) => (state.get(n) as State).draft);

  // Round-Trip-Wächter: Text neu lesen, Zustand, Text und `after` dürfen nicht auseinanderlaufen.
  const re = parseShapes(out);
  const reDrafts = re.parts.map(toDraft);
  const guard: string[] = [];
  if (re.errors.length > parsed.errors.length) guard.push("the result would contain a line the parser rejects");
  for (const want of expected) {
    const got = reDrafts.find((d) => d.name === want.name);
    if (!got || JSON.stringify(got) !== JSON.stringify(want)) {
      guard.push(`\`${want.name}\`: its values need more than 4 decimals — edit this part by hand`);
    }
  }
  for (const b of before) {
    if (touched.has(b.name)) continue;
    const got = reDrafts.find((d) => d.name === b.name);
    if (!got || JSON.stringify(got) !== JSON.stringify(b)) guard.push(`\`${b.name}\`: would be changed by the rewrite — nothing applied`);
  }
  if (reDrafts.length !== expected.length && guard.length === 0) guard.push("the result has a different number of parts than expected");
  if (guard.length > 0) return { ok: false, problems: [...new Set(guard)] };
  return { ok: true, text: out, before, after: reDrafts };
}

/** Der EINE Einstieg für eine Modellantwort: nimmt das ganze Ergebnis von `readChangesAnswer`. */
export function applyChangesAnswer(text: string, answer: ReturnType<typeof readChangesAnswer>): ApplyResult {
  if (!answer.ok) return { ok: false, problems: [answer.reason] };
  if (answer.dropped.length > 0) {
    return {
      ok: false,
      problems: answer.dropped.map((d) => `item ${d.index + 1} was not usable (${d.reason}) — nothing applied`),
    };
  }
  const r = applyChanges(text, answer.changes);
  // „ok, aber nichts geändert“ ist kein Erfolg: leere Liste oder ein Diff, der den Bestand nicht berührt.
  if (r.ok && JSON.stringify(r.before) === JSON.stringify(r.after)) return { ok: false, problems: ["the answer changed nothing"] };
  return r;
}
