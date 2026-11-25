// UI-Texte, die nicht an einer einzelnen Zeile hängen (UI-STANDARD §10), und die Brücke zu den Kit-Bausteinen, die ihre Texte als Bündel nehmen.
// Die Wörterbücher stehen in `texts-en.ts`/`texts-de.ts`, die Engine in `t.ts`. `PANEL_TEXTS` liest die Sprache bei jedem Zugriff, `acceptStrings()` bei jedem Aufruf
// (Getter): die Sprache wird erst im `onload` gesetzt, die Module sind da längst geladen.
import type { AcceptStrings } from "../vendor/kit-obsidian/panel-accept";
import { resolveAcceptStrings } from "../vendor/kit-obsidian/panel-accept-strings";
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

/** Meldungen des Übernehmens (Kit `panel-accept`, `AcceptStrings`): die Standardtexte des Kits (obsidian-kit 0.111.0, `resolveAcceptStrings`), überlagert nur
 *  mit den Sätzen, die fachlich diesem Plugin gehören (MIGRATION § 0.111.0 Punkt 4: „ein neues Modell“, „das Modell sieht schon so aus“). Eine Funktion,
 *  weil die Sprache erst im `onload` feststeht; `buildAcceptEnv` ruft sie dann. */
export function acceptStrings(): AcceptStrings {
  return resolveAcceptStrings({
    lang: getLang() === "de" ? "de" : "en",
    unchanged: t("accept.unchanged"),
    cannotReplace: t("accept.cannotReplace"),
    blockMoved: t("accept.blockMoved"),
    appliedTo: (label) => t("accept.appliedTo", label),
  });
}
