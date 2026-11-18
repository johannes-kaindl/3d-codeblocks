// UI-Texte, die nicht an einer einzelnen Zeile hängen (UI-STANDARD §10), und die Brücke zu den Kit-Bausteinen, die ihre Texte als Bündel nehmen.
// Die Wörterbücher stehen in `texts-en.ts`/`texts-de.ts`, die Engine in `t.ts`. `PANEL_TEXTS` und `ACCEPT_STRINGS` lesen die Sprache bei jedem Zugriff
// (Getter): die Sprache wird erst im `onload` gesetzt, die Module sind da längst geladen.
import type { AcceptStrings, InsertWhere } from "../vendor/kit-obsidian/panel-accept";
import { HELP_SETTING_TEXTS_DE, HELP_SETTING_TEXTS_EN, type HelpSettingTexts } from "../vendor/kit-obsidian/help-setting";
import {
  isManagerErrorCode,
  LLM_CONNECTION_STRINGS_DE,
  LLM_CONNECTION_STRINGS_EN,
  managerErrorText,
} from "../vendor/kit-obsidian/llm-connection-strings";
import { getLang, t } from "./t";

/** Die Hilfe-Zeile der Einstellungen in der Sprache des Plugins (Kit-Vorgabe, kein eigener Text). */
export function helpTexts(): HelpSettingTexts {
  return getLang() === "de" ? HELP_SETTING_TEXTS_DE : HELP_SETTING_TEXTS_EN;
}

/** Texte des Prompt-Panels (Plan 3b, Task 6). Die LLM-Einstellungen tragen die Kit-Texte. */
export const PANEL_TEXTS = {
  get title() { return t("panel.title"); },
  get targetNew() { return t("panel.targetNew"); },
  get placeholderCreate() { return t("panel.placeholderCreate"); },
  get placeholderRefine() { return t("panel.placeholderRefine"); },
  get accept() { return t("panel.accept"); },
  get done() { return t("panel.done"); },
  get doneCreate() { return t("panel.doneCreate"); },
  unsupported: (label: string) => t("panel.unsupported", label),
  get emptyText() { return t("panel.emptyText"); },
  get example1() { return t("panel.example1"); },
  get example2() { return t("panel.example2"); },
  get acceptBlock() { return t("panel.acceptBlock"); },
  get acceptFile() { return t("panel.acceptFile"); },
  get noNoteOpen() { return t("panel.noNoteOpen"); },
  get noteInReadingView() { return t("panel.noteInReadingView"); },
  get diffHeading() { return t("panel.diffHeading"); },
  get modelGone() { return t("panel.modelGone"); },
  get blockGone() { return t("panel.blockGone"); },
  get answerChangesNothing() { return t("panel.answerChangesNothing"); },
  get cutOff() { return t("panel.cutOff"); },
  get noUsableParts() { return t("panel.noUsableParts"); },
  get roundNew() { return t("panel.roundNew"); },
  roundChanges: (n: number) => t("panel.roundChanges", n),
  get settingsFallback() { return t("panel.settingsFallback"); },
  get unavailable() { return t("panel.unavailable"); },
  // Ein Code des LLM Endpoint Managers bekommt seinen Text (jeder nennt die Stelle, an der es behoben wird); alles andere
  // (etwa eine Konfigurationsmeldung) bleibt als „Grund“ stehen.
  noEndpointDetail: (detail: string, sourceKind?: string) =>
    sourceKind === "manager" && isManagerErrorCode(detail)
      ? managerErrorText(getLang() === "de" ? LLM_CONNECTION_STRINGS_DE : LLM_CONNECTION_STRINGS_EN, detail)
      : t("panel.reason", detail),
};

/** Meldungen des Übernehmens (Kit `panel-accept`, `AcceptStrings`): ganze Sätze, das Panel zeigt sie unverändert. */
export const ACCEPT_STRINGS: AcceptStrings = {
  unsupported: (label) => PANEL_TEXTS.unsupported(label),
  notApplied: (problem) => t("accept.notApplied", problem),
  get unchanged() { return t("accept.unchanged"); },
  get cannotReplace() { return t("accept.cannotReplace"); },
  get blockMoved() { return t("accept.blockMoved"); },
  get blockChanged() { return t("accept.blockChanged"); },
  get noteChanged() { return t("accept.noteChanged"); },
  get closesFence() { return t("accept.closesFence"); },
  get cancelled() { return t("accept.cancelled"); },
  get noNoteOpen() { return PANEL_TEXTS.noNoteOpen; },
  get noteInReadingView() { return PANEL_TEXTS.noteInReadingView; },
  appliedTo: (label) => t("accept.appliedTo", label),
  appliedAsBlock: (where: InsertWhere) => t("accept.appliedAsBlock", t(`accept.where.${where}`)),
  get appendedToNote() { return t("accept.appendedToNote"); },
  fileGone: (path) => t("accept.fileGone", path),
  fileExists: (path) => t("accept.fileExists", path),
  couldNotCreate: (path, reason) => (path ? t("accept.couldNotCreate", path, reason) : t("accept.couldNotCreateAnon", reason)),
  savedFileWithReference: (path) => t("accept.savedWithReference", path),
  savedFileNoReference: (path, why) => t("accept.savedNoReference", path, t(`accept.noRef.${why}`)),
  savedFileAppended: (path) => t("accept.savedAppended", path),
  savedFileReferenceFailed: (path, reason) => t("accept.savedReferenceFailed", path, reason),
  unclosedFence: (selected) => t(selected ? "accept.unclosedFence.selection" : "accept.unclosedFence.cursor"),
  nestedFence: (selected) => t(selected ? "accept.nestedFence.selection" : "accept.nestedFence.cursor"),
  couldNotApply: (reason) => t("accept.couldNotApply", reason),
};
