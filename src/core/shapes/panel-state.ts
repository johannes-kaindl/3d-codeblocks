// Zustand des Prompt-Panels, pure (Spec § 6.3, § 4.1). Runden über das Kit-Rundenmodell
// (code-kit `rounds`): Verfeinern baut auf der AKTIVEN Runde auf, Rückwahl verwirft nichts.
// Übernehmen schreibt nie den gespeicherten Text, sondern wendet die Änderungskette der aktiven
// Runde auf den AKTUELLEN Text an — Handänderungen dazwischen bleiben erhalten. Alles oder nichts:
// scheitert ein Schritt, kommt KEIN Text zurück. Keine Uhr, keine Mutation, wirft nie.
import { applyChanges } from "./changes";
import type { RawChange } from "./protocol";
import { activeRound, EMPTY_ROUNDS, type Rounds } from "../../vendor/kit/rounds";

export type PanelTarget =
  | { kind: "new" }
  | { kind: "shapes-block"; path: string; lineStart: number; lineEnd: number; label: string }
  | { kind: "shapes-file"; path: string; label: string }
  | { kind: "other"; label: string };

export type ShapesRound =
  | { kind: "create"; instruction: string; text: string; model: string; at: number }
  | { kind: "refine"; instruction: string; changes: RawChange[]; basedOn: number | null; text: string; diff: string[]; model: string; at: number };

export interface PanelState {
  target: PanelTarget;
  rounds: Rounds<ShapesRound>;
}

export const INITIAL_PANEL: PanelState = { target: { kind: "new" }, rounds: EMPTY_ROUNDS };

/** Strukturell gleich? Block: Pfad + Zeilen (die Beschriftung zählt nicht). Ein Block, dessen Zeilen
 *  sich verschoben haben, ist bei offenen Runden ein ANDERES Ziel: das Panel bekommt bei jedem Klick ein
 *  frisches Ziel, und der Schreiber (Task 7) findet den Zaun über die Zeilennummer wieder und verweigert,
 *  wenn der Block gewandert ist. */
export function sameTarget(a: PanelTarget, b: PanelTarget): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "new":
      return true;
    case "shapes-block": {
      const o = b as typeof a;
      return a.path === o.path && a.lineStart === o.lineStart && a.lineEnd === o.lineEnd;
    }
    case "shapes-file":
      return a.path === (b as typeof a).path;
    case "other":
      return a.label === (b as typeof a).label;
  }
}

/** Solange Runden offen sind, bleibt das Ziel; `kept` meldet, dass ein ANDERES Ziel angeboten wurde. */
export function followTarget(s: PanelState, t: PanelTarget): { state: PanelState; kept: boolean } {
  if (s.rounds.rounds.length > 0) return { state: s, kept: !sameTarget(s.target, t) };
  return { state: { ...s, target: t }, kept: false };
}

interface Resolved {
  /** Wurzel zuerst; `index` ist der Listenindex (das Panel zeigt `index + 1`). */
  chain: { round: ShapesRound; index: number }[];
  /** Gesetzt, wenn die Kette nicht sauber zur Wurzel führt (nicht vorhanden, auf sich selbst, nach vorn). */
  broken: string | null;
}

function resolveChain(rounds: Rounds<ShapesRound>): Resolved {
  const chain: Resolved["chain"] = [];
  if (rounds.active < 0) return { chain, broken: null };
  let index = rounds.active;
  const first = Number.isInteger(index) ? rounds.rounds[index] : undefined;
  if (!first) return { chain, broken: `the round chain is broken (round ${String(index + 1)} does not exist)` };
  // Eine Runde baut nur auf eine FRÜHERE auf (basedOn < eigener Index); damit gibt es keine Zyklen, und die
  // Schleife endet nach höchstens `active + 1` Schritten.
  for (;;) {
    const r: ShapesRound = rounds.rounds[index];
    chain.unshift({ round: r, index });
    if (r.kind !== "refine" || r.basedOn === null) break;
    const n = index + 1;
    const m = r.basedOn + 1;
    if (!Number.isInteger(r.basedOn) || r.basedOn < 0 || r.basedOn >= rounds.rounds.length) {
      return { chain, broken: `the round chain is broken (round ${n} refers to round ${String(m)} which does not exist)` };
    }
    if (r.basedOn === index) return { chain, broken: `the round chain is broken (round ${n} points to itself)` };
    if (r.basedOn > index) return { chain, broken: `the round chain is broken (round ${n} points forward to round ${m})` };
    index = r.basedOn;
  }
  return { chain, broken: null };
}

/** Runden von der Wurzel bis zur aktiven, entlang `basedOn`. Ein `refine` mit `basedOn === null` verfeinert
 *  den Ziel-Text und beendet die Kette; bei einer kaputten Kette kommt, was bis dahin gelesen wurde. */
export function chainOf(rounds: Rounds<ShapesRound>): ShapesRound[] {
  return resolveChain(rounds).chain.map((c) => c.round);
}

export type AcceptResult = { ok: true; text: string; unchanged: boolean } | { ok: false; problems: string[] };

/** Text, der beim Übernehmen geschrieben würde. Beginnt die Kette mit `create` (Ziel „neu"), ist deren Text
 *  der Ausgangspunkt und `currentTargetText` wird ignoriert; eine reine Verfeinerungskette braucht den
 *  aktuellen Zieltext (`null` = das Modell ist weg).
 *  `applyChanges` statt `applyChangesAnswer`: die Verwerfungsliste des Lesers und „Antwort ändert nichts"
 *  wurden beim Anlegen der Runde geprüft; hier gilt dieselbe Strenge (Round-Trip-Wächter, strenge Werte,
 *  Mehrdeutigkeit), aber „ändert nichts" ist kein Fehler, sondern `unchanged: true`. */
export function acceptText(rounds: Rounds<ShapesRound>, currentTargetText: string | null): AcceptResult {
  const { chain, broken } = resolveChain(rounds);
  if (broken !== null) return { ok: false, problems: [broken] };
  if (chain.length === 0) return { ok: false, problems: ["nothing to apply"] };
  let text: string;
  let rest = chain;
  const root = chain[0].round;
  if (root.kind === "create") {
    text = root.text;
    rest = chain.slice(1);
  } else {
    if (currentTargetText === null) return { ok: false, problems: ["the model to change is gone"] };
    text = currentTargetText;
  }
  // Nach dem Wurzelschritt kann nur noch `refine` folgen: die Kette endet an der ersten `create`-Runde.
  for (const { round, index } of rest) {
    const label = `round ${index + 1}`;
    const r = round as Extract<ShapesRound, { kind: "refine" }>;
    let applied;
    try {
      applied = applyChanges(text, r.changes);
    } catch {
      return { ok: false, problems: [`${label}: its stored changes are unreadable`] };
    }
    // Listennummer wie im Panel, nicht die Position in der Kette.
    if (!applied.ok) return { ok: false, problems: applied.problems.map((p) => `${label}: ${p}`) };
    text = applied.text;
  }
  return { ok: true, text, unchanged: currentTargetText !== null && text === currentTargetText };
}

/** Grundlage der nächsten Verfeinerung: der Text der aktiven Runde (das, was der Nutzer sieht), sonst der
 *  aktuelle Zieltext; für Ziel „neu" ohne Runden gibt es nichts zu verfeinern (`null`). */
export function baseTextForRefine(s: PanelState, currentTargetText: string | null): string | null {
  const active = activeRound(s.rounds);
  if (active !== null) return active.text;
  return s.target.kind === "new" ? null : currentTargetText;
}
