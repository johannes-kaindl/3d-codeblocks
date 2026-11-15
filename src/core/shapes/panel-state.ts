// Zustand des Prompt-Panels, pure (Spec § 6.3, § 4.1). Runden über das Kit-Rundenmodell
// (code-kit `rounds`): Verfeinern baut auf der AKTIVEN Runde auf, Rückwahl verwirft nichts.
// Übernehmen schreibt nie den gespeicherten Text, sondern wendet die Änderungskette der aktiven
// Runde auf den AKTUELLEN Text an — Handänderungen dazwischen bleiben erhalten. Alles oder nichts:
// scheitert ein Schritt, kommt KEIN Text zurück. Keine Uhr, keine Mutation, wirft nie.
import { applyChanges } from "./changes";
import type { RawChange } from "./protocol";
import { acceptChain, baseTextForRefine as kitBaseTextForRefine, chainOf as kitChainOf, followTarget as kitFollowTarget, sameTarget, type ChainIssue, type Target } from "../../vendor/kit/panel-session";
import { EMPTY_ROUNDS, type Rounds } from "../../vendor/kit/rounds";
import { t } from "../../i18n/t";

/** Das Ziel des Panels ist der Kit-Typ (code-kit `panel-session`): `block` = ein ```shapes-Block einer Notiz, `file` = eine .shapes-Datei. */
export type PanelTarget = Target;

export type ShapesRound =
  | { kind: "create"; instruction: string; text: string; model: string; at: number }
  | { kind: "refine"; instruction: string; changes: RawChange[]; basedOn: number | null; text: string; diff: string[]; model: string; at: number };

export interface PanelState {
  target: PanelTarget;
  rounds: Rounds<ShapesRound>;
}

export const INITIAL_PANEL: PanelState = { target: { kind: "new" }, rounds: EMPTY_ROUNDS };

/** Strukturell gleich? Das Kit (`panel-session`) entscheidet: Block = Pfad + Zeilen + Blocktext (die Beschriftung zählt nicht; ein anderer Text ist ein
 *  frischer Fingerabdruck, also ein ANDERES Ziel). */
export { sameTarget };

/** Solange Runden offen sind, bleibt das Ziel; `kept` meldet, dass ein ANDERES Ziel angeboten wurde. */
export function followTarget(s: PanelState, t: PanelTarget): { state: PanelState; kept: boolean } {
  const state = kitFollowTarget(s, t);
  // Das Kit gibt dasselbe Objekt zurück, wenn das Ziel bleibt (Runden offen); nur dann zählt ein ANDERES Angebot als zurückgehalten.
  return { state, kept: state === s && !sameTarget(s.target, t) };
}

/** Die Meldung zu einem Fehler der Kette, in der Sprache des Plugins (das Kit liefert den Code mit den Listennummern, `issue.code`). */
function chainMessage(issue: ChainIssue): string {
  switch (issue.code) {
    case "missing-round": return t("core.rounds.missing", issue.round);
    case "missing-ref": return t("core.rounds.refers", issue.round, issue.ref);
    case "self-ref": return t("core.rounds.self", issue.round);
    case "forward-ref": return t("core.rounds.forward", issue.round, issue.ref);
    case "nothing-to-apply": return t("core.rounds.nothing");
    case "round-failed": return issue.problem;
  }
}

const basedOnOf = (r: ShapesRound): number | null => (r.kind === "refine" ? r.basedOn : null);

/** Runden von der Wurzel bis zur aktiven, entlang `basedOn` (Kit `chainOf`). Ein `refine` mit `basedOn === null` verfeinert
 *  den Ziel-Text und beendet die Kette; bei einer kaputten Kette kommt eine leere Liste (`acceptText` nennt den Grund). */
export function chainOf(rounds: Rounds<ShapesRound>): ShapesRound[] {
  const r = kitChainOf(rounds, basedOnOf);
  return r.ok ? r.chain.map((i) => rounds.rounds[i]) : [];
}

export type AcceptResult = { ok: true; text: string; unchanged: boolean } | { ok: false; problems: string[] };

/** Text, der beim Übernehmen geschrieben würde. Beginnt die Kette mit `create` (Ziel „neu"), ist deren Text
 *  der Ausgangspunkt und `currentTargetText` wird ignoriert; eine reine Verfeinerungskette braucht den
 *  aktuellen Zieltext (`null` = das Modell ist weg). Die Kette und ihre Fehler kommen vom Kit (`acceptChain`).
 *  `applyChanges` statt `applyChangesAnswer`: die Verwerfungsliste des Lesers und „Antwort ändert nichts"
 *  wurden beim Anlegen der Runde geprüft; hier gilt dieselbe Strenge (Round-Trip-Wächter, strenge Werte,
 *  Mehrdeutigkeit), aber „ändert nichts" ist kein Fehler, sondern `unchanged: true`. */
export function acceptText(rounds: Rounds<ShapesRound>, currentTargetText: string | null): AcceptResult {
  // Die Probleme einer scheiternden Runde kommen als Liste (mehrere Änderungen können scheitern); das Kit trägt nur einen Text, die Liste bleibt hier.
  let failed: string[] | null = null;
  const chain = kitChainOf(rounds, basedOnOf);
  if (!chain.ok) return { ok: false, problems: [chainMessage(chain.issue)] };
  const rootIndex = chain.chain[0];
  const root = rootIndex === undefined ? undefined : rounds.rounds[rootIndex];
  if (root?.kind === "refine" && currentTargetText === null) return { ok: false, problems: [t("core.rounds.gone")] };
  const r = acceptChain(rounds, currentTargetText, {
    basedOnOf,
    applyRound: (text, round, index) => {
      if (round.kind === "create") return { ok: true, text: round.text };
      // Listennummer wie im Panel, nicht die Position in der Kette.
      const label = t("core.rounds.label", index + 1);
      let applied;
      try {
        applied = applyChanges(text ?? "", round.changes);
      } catch {
        failed = [t("core.rounds.unreadable", label)];
        return { ok: false, problem: "unreadable" };
      }
      if (!applied.ok) {
        failed = applied.problems.map((p) => `${label}: ${p}`);
        return { ok: false, problem: applied.problems.join("; ") };
      }
      return { ok: true, text: applied.text };
    },
  });
  if (!r.ok) return { ok: false, problems: failed ?? [chainMessage(r.issue)] };
  return { ok: true, text: r.text, unchanged: currentTargetText !== null && r.text === currentTargetText };
}

/** Grundlage der nächsten Verfeinerung: der Text der aktiven Runde (das, was der Nutzer sieht), sonst der
 *  aktuelle Zieltext; für Ziel „neu" ohne Runden gibt es nichts zu verfeinern (`null`). */
export function baseTextForRefine(s: PanelState, currentTargetText: string | null): string | null {
  return kitBaseTextForRefine(s, currentTargetText, { textOf: (r) => r.text });
}
