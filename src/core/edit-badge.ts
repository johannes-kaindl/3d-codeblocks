// Zeigt der Viewer gerade das Original, obwohl daneben schon eine `.edit.`-Datei
// liegt? Genau dieser Zustand hat im GUI-Smoke #5 verwirrt: nach "Save edits" und
// dem Verlassen des Edit-Modus steht wieder das unbearbeitete Modell da, und die
// Arbeit sieht verloren aus. Sie ist es nicht — die `.edit.`-Datei ist der
// AENDERUNGSWUNSCH, das Original bleibt die Wahrheit des Erzeugers (Spec
// `2026-07-26-geometry-edit-design.md` §4). Der Badge macht den Zustand sichtbar,
// ohne das Verhalten zu aendern; ein Overlay im Normal-Modus wuerde Original und
// Wunsch optisch verschmelzen und genau die Zweitwahrheit erzeugen, die §4 vermeidet.
//
// Pure: der Existenz-Check kommt als Funktion herein (`exists`), damit diese Datei
// ohne Obsidian testbar bleibt (check:pure).
import { t } from "../i18n/t";
import { editTargetPath } from "./edit-target";

export interface BadgeState {
  visible: boolean;
  label: string;
  /** Tooltip — erklaert den Zustand, den das kurze Label nur benennt. */
  title: string;
}

const hidden = (): BadgeState => ({ visible: false, label: t("badge.label"), title: "" });

export function editBadgeState(input: {
  /** Pfad des ANGEZEIGTEN Modells — `null`, solange nichts geladen ist. */
  modelPath: string | null;
  /** Laeuft der Edit-Modus? Dann zeigt der Viewer die Edits ohnehin. */
  editing: boolean;
  exists: (path: string) => boolean;
}): BadgeState {
  if (input.modelPath === null || input.editing) return hidden();

  const target = editTargetPath(input.modelPath);
  // `null` = kein editierbares Format (STL). `inPlace` = die betrachtete Datei IST
  // schon die Edit-Datei — dann sieht der Nutzer den Wunsch selbst, nicht das
  // Original, und ein "hier gibt es Edits woanders"-Hinweis waere schlicht falsch.
  if (target === null || target.inPlace) return hidden();
  if (!input.exists(target.path)) return hidden();

  return {
    visible: true,
    label: t("badge.label"),
    title: t("badge.title", target.path),
  };
}
