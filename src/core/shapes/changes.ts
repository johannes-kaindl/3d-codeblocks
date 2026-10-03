// Änderungsliste auf shapes-Text anwenden (Spec § 4.1). Pure.
// - Nur Zeilen genannter Teile werden ersetzt/entfernt; alles andere bleibt BYTE-GLEICH
//   (Zeilenenden je Zeile erhalten, auch gemischte; Schluss-Umbruch bleibt oder fehlt wie vorher).
// - Auffüll-Adapter: fehlt einem `change` ein Feld, gilt der Bestand (Spike B: 13/20 → 20/20).
// - Alles oder nichts: ein Problem → nichts geändert, Liste der Probleme zurück.
// - Eine Zeile mit unbekannten Wörtern (Parse-Warnung) wird NIE umgeschrieben: das Umformatieren
//   würde die Wörter stillschweigend löschen. Stattdessen scheitert die ganze Liste.
// - Einziger Einstieg für Modellantworten: `applyChangesAnswer` (nimmt das GANZE Leser-Ergebnis).
import { formatNumber, formatPartLine, partsFromLlm } from "./format";
import { normalizeColor, normalizeSize, parseShapes } from "./parse";
import type { RawChange, readChangesAnswer } from "./protocol";
import type { ShapeDraft, ShapePart, Vec3 } from "./types";

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

type Match = { found: string } | { none: true } | { ambiguous: string[] };

/** Exakter Treffer gewinnt; sonst gefaltet. Mehr als ein gefalteter Treffer → mehrdeutig. */
function matchPart(names: readonly string[], wanted: string): Match {
  if (names.includes(wanted)) return { found: wanted };
  const key = fold(wanted);
  if (key === "") return { none: true };
  const hits = names.filter((n) => fold(n) === key);
  if (hits.length === 1) return { found: hits[0] };
  return hits.length === 0 ? { none: true } : { ambiguous: hits };
}

/** String-Fassung von `matchPart`: Name, null (kein Treffer) oder "ambiguous". Ein Teil, das selbst
 *  "ambiguous" heißt, ist davon nicht zu unterscheiden — der Anwender-Pfad nutzt deshalb `matchPart`. */
export function findPartName(names: readonly string[], wanted: string): string | null {
  const m = matchPart(names, wanted);
  if ("found" in m) return m.found;
  return "none" in m ? null : "ambiguous";
}

function vec(name: string, field: string, v: number[] | undefined, fallback: Vec3, problems: string[]): Vec3 {
  if (v === undefined) return fallback;
  if (v.length !== 3 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    problems.push(`\`${name}\`: \`${field}\` needs 3 numbers`);
    return fallback;
  }
  return [v[0], v[1], v[2]];
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

  changes.forEach((change, ci) => {
    const label = `change ${ci + 1}`;
    if (change.op === "add") {
      const { parts, dropped } = partsFromLlm([change.part]);
      const draft = parts[0];
      if (dropped.length > 0 || draft === undefined) {
        problems.push(`${label} (add): ${dropped[0]?.reason ?? "unreadable"}`);
        return;
      }
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
    if ("none" in m) {
      problems.push(`${label}: no part named \`${change.name}\` (available: ${names.join(", ") || "none"})`);
      return;
    }
    if ("ambiguous" in m) {
      problems.push(`${label}: \`${change.name}\` matches more than one part: ${m.ambiguous.join(", ")}`);
      return;
    }
    const found = m.found;
    const entry = state.get(found) as State;

    if (change.op === "remove") {
      if (entry.line >= 0) (entries[entry.line]).removed = true;
      state.delete(found);
      order.splice(order.indexOf(found), 1);
      return;
    }

    const d = entry.draft;
    const own: string[] = [];
    let size = d.size;
    if (change.size !== undefined) {
      const raw = change.size;
      const normalized =
        raw.every((v) => typeof v === "number" && Number.isFinite(v)) ? normalizeSize(d.kind, raw) : "`size` values must be finite numbers";
      if (typeof normalized === "string") own.push(`\`${found}\`: ${normalized}`);
      else if (normalized.some((v) => formatNumber(v) === "0")) own.push(`\`${found}\`: \`size\` values must be at least 0.0001`);
      else size = normalized;
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
    entry.draft = { ...d, size, color, at, rot };
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
  const after = order.map((n) => (state.get(n) as State).draft);
  return { ok: true, text: out, before, after };
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
  return applyChanges(text, answer.changes);
}
