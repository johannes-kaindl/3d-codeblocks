// UI-Texte, die nicht an einer einzelnen Zeile haengen (UI-STANDARD §10). Das Plugin ist
// englisch; die Hilfe-Zeile nimmt die Kit-Vorgabe unveraendert.
import { HELP_SETTING_TEXTS_EN, type HelpSettingTexts } from "../vendor/kit-obsidian/help-setting";
import { isManagerErrorCode, LLM_CONNECTION_STRINGS_EN, managerErrorText } from "../vendor/kit-obsidian/llm-connection-strings";

export const HELP_TEXTS: HelpSettingTexts = HELP_SETTING_TEXTS_EN;

/** Texte des Prompt-Panels (Plan 3b, Task 6). Die LLM-Einstellungen tragen die Kit-Texte. */
export const PANEL_TEXTS = {
  title: "Model by prompt",
  tabPrompt: "Prompt",
  tabVersions: "Versions",
  targetNew: "New model",
  targetEdit: (label: string) => `Edit: ${label}`,
  targetKept: (label: string) => `Target kept: ${label} — discard to switch`,
  newButton: "New",
  placeholderCreate: "Describe the model, e.g. “A table: top 1.2 × 0.7 m, four legs, 0.75 m high.”",
  placeholderRefine: "What should change? e.g. “Make the top 20 cm higher.”",
  create: "Create",
  refine: "Change",
  abort: "Stop",
  accept: "Apply",
  discard: "Discard",
  rounds: "Rounds",
  reasoning: "Thinking…",
  running: (model: string) => `Asking ${model}… this can take several minutes.`,
  done: "Done — check the preview, then apply or change further.",
  doneCreate: "Done — check the preview, then apply or change further, or press New to start another model.",
  aborted: "Stopped.",
  noEndpoint: "No language model is set up yet.",
  openSettings: "Open settings",
  emptyCreate: "Describe a model in words. Examples: “A snowman from three spheres with a cone nose.” · “A bookshelf with three shelves, 1.8 m high.”",
  versionsEmpty: "No saved versions yet.",
  versionsOnlyFiles: "Versions are kept for .shapes files only.",
  unsupported: (label: string) => `${label} can't be changed by prompt.`,
  discardConfirm: (n: number) => `Discard ${n} unapplied round(s)?`,
  acceptAsTitle: "Apply the new model as …",
  acceptAsBlock: "Code block at the cursor",
  acceptAsFile: "File in the attachment folder",
  noNoteOpen: "Open a note to insert a code block.",
  noteInReadingView: "The open note is in reading view — switch to editing view to insert a code block.",
  modelLabel: "Prompt",
  thinkingOff: "Thinking: off",
  thinkingOn: (level: string) => `Thinking: ${level}`,
  thinkingLevel: (level: string) => `Thinking: ${level}`,
  thinkingPicker: "Thinking level",
  promptLabel: "Your instruction",
  previewLabel: "Preview",
  previewOf: (n: number) => `Preview of round ${n}`,
  diffHeading: "Changes in this round",
  modelGone: "The model to change is gone.",
  blockGone: "The block changed or moved — click it again (toolbar button).",
  answerChangesNothing: "The answer changes nothing.",
  cutOff: "The answer was cut off (length limit).",
  targetChanged: "The target changed while the model was answering — nothing was added.",
  noUsableParts: "the answer holds no usable part",
  // Ein Code des LLM Endpoint Managers bekommt seinen Text (jeder nennt die Stelle, an der es behoben wird); alles andere
  // (etwa eine Konfigurationsmeldung) bleibt als „Reason“ stehen.
  noEndpointDetail: (detail: string, sourceKind?: string) => (sourceKind === "manager" && isManagerErrorCode(detail) ? managerErrorText(LLM_CONNECTION_STRINGS_EN, detail) : `Reason: ${detail}`),
} as const;
