// Uebernehmen im Prompt-Panel (Spec Modell per Prompt § 6.3/§ 5): schreibt Nutzernotizen und legt Dateien an,
// deshalb gilt Datenschutz vor Komfort. Jede Unsicherheit ist eine Ablehnung MIT Meldung und ohne Schreibversuch;
// `acceptPanel` wirft nie. Meldungen sind ganze Saetze; das Panel zeigt sie unveraendert.
// Ein BLOCK wird nur geschrieben, wenn sein Text noch der ist, den der Nutzer angeklickt hat (`target.body`):
// Pfad und Zeilen allein koennen nach einer Aenderung darueber einen ANDEREN shapes-Block treffen. Eine .shapes-
// DATEI hat eine Identitaet (den Pfad): dort wird die Kette auf den aktuellen Text angewendet, Handaenderungen
// bleiben erhalten. Alles oder nichts (`acceptText`).
import { Modal, TFile, type App, type MarkdownView } from "obsidian";
import { findFenceAt, type Fence } from "../core/shapes/fence";
import { exportBaseName } from "../core/shapes/export";
import { acceptText, chainOf, normBody, type PanelState, type PanelTarget } from "../core/shapes/panel-state";
import { parseShapes } from "../core/shapes/parse";
import { referenceBlock, shapesBlock } from "../core/shapes/references";
import type { PluginSettings } from "../core/settings-types";
import { PANEL_TEXTS } from "../i18n/strings";
import { BlockChangedError, writeBlockBody, type WritePorts } from "./block-writer";
import { locateShapesFence } from "./shapes-convert";
import { VIEW_TYPE_SHAPES } from "./shapes-file-view";

export interface AcceptEnv {
  app: App;
  ports: WritePorts;
  settings: () => PluginSettings;
  lastEditor: () => MarkdownView | null;
  choose?: () => Promise<"block" | "file" | null>;
}

/** `retarget`: nach einem erfolgreichen Block-Apply das neue Ziel (geschriebener Rumpf, neue Schlusszeile), damit das
 *  Panel weiterarbeiten kann, ohne den Block neu anzuklicken. */
export type AcceptOutcome = { ok: boolean; message: string; retarget?: PanelTarget };

type BlockTarget = Extract<PanelTarget, { kind: "shapes-block" }>;

const NEW_CANNOT_REPLACE = "A new model can't replace an existing one — use New. Nothing was applied.";
const UNCHANGED = "The model already looks like this — nothing to change.";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Notiztext aus derselben Quelle wie der Schreiber (`writeBlockBody`): offener Quell-Editor, sonst Vault. */
async function readNoteText(ports: WritePorts, path: string): Promise<string> {
  return ports.editorFor(path)?.getValue() ?? (await ports.vault.read(path));
}

/** Offene Ansichten einer .shapes-Datei (wie `convertFileToBlock`): ihr Puffer kann neuer sein als die Platte. */
interface OpenShapesView {
  file: TFile | null;
  save(): Promise<void>;
  getViewData(): string;
}

function openShapesViews(app: App, path: string): OpenShapesView[] {
  return app.workspace
    .getLeavesOfType(VIEW_TYPE_SHAPES)
    .map((l) => l.view as unknown as OpenShapesView)
    .filter((v) => v.file?.path === path);
}

type Located = { fence: Fence; text: string } | { problem: "moved" | "changed" };

/** Zaun des Blocks finden UND pruefen, dass es noch der Block ist, den der Nutzer angeklickt hat. Zeilennummern
 *  allein tragen nicht: nach dem Loeschen eines Blocks darueber trifft eine veraltete Position einen ANDEREN. */
async function locateBlock(env: AcceptEnv, t: BlockTarget): Promise<Located> {
  const text = await readNoteText(env.ports, t.path);
  const fence = locateShapesFence(text, t.lineStart, t.lineEnd);
  if (!fence) return { problem: "moved" };
  if (normBody(fence.body) !== normBody(t.body)) return { problem: "changed" };
  return { fence, text };
}

/** Aktueller Text des Ziels fuers Panel; `null` = Datei/Block nicht (mehr) auffindbar oder veraendert. Ein Block
 *  wird ueber dieselbe Regel gefunden wie in `convertBlockAt` (`locateShapesFence`) und gegen `t.body` geprueft. */
export async function readTargetText(env: AcceptEnv, t: PanelTarget): Promise<string | null> {
  if (t.kind !== "shapes-file" && t.kind !== "shapes-block") return null;
  const file = env.app.vault.getAbstractFileByPath(t.path);
  if (!(file instanceof TFile)) return null;
  if (t.kind === "shapes-file") {
    // Ungespeichertes Tippen in einer offenen Ansicht steht nur im Puffer: der ist der aktuelle Text.
    const view = openShapesViews(env.app, t.path)[0];
    return view ? view.getViewData() : await env.app.vault.read(file);
  }
  const found = await locateBlock(env, t);
  // `listFences` zerlegt an \r?\n und fuegt mit \n zusammen: der Rumpf ist LF-normalisiert.
  return "fence" in found ? found.fence.body : null;
}

/** Schliesst eine Zeile des neuen Rumpfs den TATSAECHLICHEN Oeffnungszaun des Blocks (gleiches Zeichen, Laenge >=)? */
function closesOpenFence(noteText: string, fence: Fence, newBody: string): boolean {
  const open = /^\s{0,3}(`{3,}|~{3,})/.exec((noteText.split(/\r?\n/)[fence.openLine] ?? "").replace(/^\uFEFF/, ""));
  if (!open) return false;
  const close = new RegExp(`^ {0,3}${open[1][0] === "`" ? "`" : "~"}{${open[1].length},}\\s*$`, "m");
  return close.test(newBody);
}

export async function acceptPanel(env: AcceptEnv, state: PanelState): Promise<AcceptOutcome> {
  try {
    return await accept(env, state);
  } catch (error) {
    return { ok: false, message: `Could not apply: ${errorText(error)} — nothing was applied.` };
  }
}

async function accept(env: AcceptEnv, state: PanelState): Promise<AcceptOutcome> {
  const t = state.target;
  if (t.kind === "other") return { ok: false, message: PANEL_TEXTS.unsupported(t.label) };
  // Ein `create` baut aus dem Nichts: auf einem bestehenden Modell wuerde es dessen Inhalt kommentarlos ersetzen.
  if ((t.kind === "shapes-block" || t.kind === "shapes-file") && chainOf(state.rounds)[0]?.kind === "create") {
    return { ok: false, message: NEW_CANNOT_REPLACE };
  }
  if (t.kind === "shapes-block") return acceptIntoBlock(env, state, t);
  if (t.kind === "shapes-file") return acceptIntoFile(env, state, t);
  return acceptAsNew(env, state);
}

async function acceptIntoBlock(env: AcceptEnv, state: PanelState, t: BlockTarget): Promise<AcceptOutcome> {
  const found = await locateBlock(env, t);
  if ("problem" in found) {
    return {
      ok: false,
      message: found.problem === "moved" ? "The block moved — nothing was applied." : "The block changed — nothing was applied.",
    };
  }
  const { fence, text } = found;
  const result = acceptText(state.rounds, fence.body);
  if (!result.ok) return { ok: false, message: `${result.problems.join("; ")} — nothing was applied.` };
  if (result.unchanged) return { ok: true, message: UNCHANGED };
  if (closesOpenFence(text, fence, result.text)) {
    return { ok: false, message: "The new text contains a line that would close the code block — nothing was applied." };
  }
  try {
    // `fence.body` ist der Text, gegen den der Schreiber vor dem Schreiben prueft (Rumpf unveraendert).
    await writeBlockBody(env.ports, { path: t.path, lineStart: fence.openLine, lineEnd: fence.closeLine, fence: "shapes" }, fence.body, result.text);
  } catch (error) {
    if (error instanceof BlockChangedError) return { ok: false, message: "The note changed — nothing was applied." };
    throw error;
  }
  // Zeilen des geschriebenen Rumpfs: Schlusszeile = Oeffnungszeile + Rumpfzeilen + 1 (wie beim Lesen: Zeilen dazwischen).
  const lineEnd = fence.openLine + result.text.split("\n").length + 1;
  return { ok: true, message: `Applied to ${t.label}.`, retarget: { ...t, lineStart: fence.openLine, lineEnd, body: result.text } };
}

async function acceptIntoFile(env: AcceptEnv, state: PanelState, t: Extract<PanelTarget, { kind: "shapes-file" }>): Promise<AcceptOutcome> {
  const file = env.app.vault.getAbstractFileByPath(t.path);
  if (!(file instanceof TFile)) return { ok: false, message: `${t.path} is gone or was renamed — nothing was applied.` };
  let problems: string[] | null = null;
  let unchanged = false;
  try {
    // Ungespeichertes Tippen einer offenen Ansicht zuerst auf die Platte (wie convertFileToBlock): sonst wuerde
    // die Kette auf den veralteten Plattentext angewendet und der Puffer die Datei danach wieder ueberschreiben.
    for (const view of openShapesViews(env.app, t.path)) await view.save();
    // Atomar: lesen, Kette anwenden, schreiben in einem Schritt; ein Wurf im Callback schreibt nichts.
    await env.app.vault.process(file, (current) => {
      const r = acceptText(state.rounds, current);
      if (!r.ok) {
        problems = r.problems;
        throw new Error(r.problems.join("; "));
      }
      unchanged = r.unchanged;
      return r.unchanged ? current : r.text;
    });
  } catch (error) {
    return { ok: false, message: `${problems ? (problems as string[]).join("; ") : errorText(error)} — nothing was applied.` };
  }
  return unchanged ? { ok: true, message: UNCHANGED } : { ok: true, message: `Applied to ${t.label}.` };
}

/** Die zuletzt bediente Notiz im Quellmodus; sonst der Grund (keine Notiz / Lesemodus) als Meldung. */
function sourceView(env: AcceptEnv): { view: MarkdownView } | { message: string; reading: boolean } {
  const view = env.lastEditor();
  if (!view?.file) return { message: PANEL_TEXTS.noNoteOpen, reading: false };
  return view.getMode() === "source" ? { view } : { message: PANEL_TEXTS.noteInReadingView, reading: true };
}

/** Einfuegen ohne Nutzerinhalt zu zerstoeren: eine Auswahl bleibt (Einfuegung an ihrem Ende), ein Cursor INNERHALB
 *  eines Zauns fuegt hinter dem Zaun ein (sonst entstuende ein Block im Block). Der Standardfall ist unveraendert. */
function insertText(view: MarkdownView, text: string): string {
  const editor = view.editor;
  if (editor.somethingSelected()) {
    editor.replaceRange(text, editor.getCursor("to"));
    return "after the selection";
  }
  const lines = editor.getValue().split(/\r?\n/);
  const fence = findFenceAt(editor.getValue(), editor.getCursor().line);
  if (fence) {
    editor.replaceRange(`\n${text}`, { line: fence.closeLine, ch: (lines[fence.closeLine] ?? "").length });
    return "after the code block at the cursor";
  }
  editor.replaceSelection(text);
  return "at the cursor";
}

async function acceptAsNew(env: AcceptEnv, state: PanelState): Promise<AcceptOutcome> {
  const result = acceptText(state.rounds, null);
  if (!result.ok) return { ok: false, message: `${result.problems.join("; ")} — nothing was applied.` };
  const setting = env.settings().acceptAs;
  let where: "block" | "file" | null = setting === "ask" ? null : setting;
  if (setting === "ask") {
    where = (await env.choose?.()) ?? null;
    if (where === null) return { ok: false, message: "Cancelled — nothing was applied." };
  }
  return where === "block" ? insertAsBlock(env, result.text) : createAsFile(env, result.text);
}

function insertAsBlock(env: AcceptEnv, text: string): AcceptOutcome {
  const src = sourceView(env);
  if ("message" in src) return { ok: false, message: src.message };
  const where = insertText(src.view, `\n${shapesBlock(text)}\n`);
  return { ok: true, message: `Applied to the open note as a code block ${where}.` };
}

async function createAsFile(env: AcceptEnv, text: string): Promise<AcceptOutcome> {
  const { app } = env;
  const src = sourceView(env);
  const view = "view" in src ? src.view : null;
  const notePath = view?.file?.path ?? "";
  const name = `${exportBaseName(parseShapes(text).header, "model")}.shapes`;
  let path = "";
  let created: TFile;
  try {
    path = await app.fileManager.getAvailablePathForAttachment(name, notePath);
    // Nie ueberschreiben — auch nicht bei einer Schreibweise, die die Pfadvergabe uebersieht (wie convertBlockAt).
    if (app.vault.getAbstractFileByPath(path) || (await app.vault.adapter.exists(path))) {
      return { ok: false, message: `${path} already exists — nothing was written.` };
    }
    // Die Datei endet mit genau einem Zeilenumbruch, LF, ohne BOM (wie `shapesBlock`).
    created = await app.vault.create(path, `${text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`);
  } catch (error) {
    return { ok: false, message: `Could not create the file${path ? ` ${path}` : ""}: ${errorText(error)} — nothing was written.` };
  }
  if (!view) return { ok: true, message: `Saved ${path}. No reference was inserted because ${"reading" in src && src.reading ? "the open note is in reading view" : "no note is open for editing"}.` };
  try {
    insertText(view, `\n${referenceBlock(app.metadataCache.fileToLinktext(created, notePath, false))}\n`);
  } catch (error) {
    return { ok: true, message: `Saved ${path}, but the reference could not be inserted (${errorText(error)}). The file exists.` };
  }
  return { ok: true, message: `Saved ${path} and inserted a reference.` };
}

/** Zwei-Wege-Wahl fuer „Ask each time". Kein Kit-Baustein: der Kit-Confirm ist Ja/Nein und kennt kein
 *  „Schliessen = keins von beiden". `done` wird genau einmal gerufen (Klick + nachlaufendes onClose). */
export class AcceptAsModal extends Modal {
  private done: ((choice: "block" | "file" | null) => void) | null;

  constructor(app: App, done: (choice: "block" | "file" | null) => void) {
    super(app);
    this.done = done;
  }

  onOpen(): void {
    this.titleEl.setText(PANEL_TEXTS.acceptAsTitle);
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    const block = row.createEl("button", { text: PANEL_TEXTS.acceptAsBlock, cls: "mod-cta" });
    block.addEventListener("click", () => this.finish("block"));
    const file = row.createEl("button", { text: PANEL_TEXTS.acceptAsFile });
    file.addEventListener("click", () => this.finish("file"));
    block.focus();
  }

  onClose(): void {
    this.finish(null);
    this.contentEl.empty();
  }

  private finish(choice: "block" | "file" | null): void {
    if (!this.done) return;
    const cb = this.done;
    this.done = null;
    cb(choice);
    this.close();
  }
}
