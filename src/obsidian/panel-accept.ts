// Uebernehmen im Prompt-Panel (Spec Modell per Prompt § 6.3/§ 5): schreibt Nutzernotizen und legt Dateien an,
// deshalb gilt Datenschutz vor Komfort. Jede Unsicherheit ist eine Ablehnung MIT Meldung und ohne Schreibversuch;
// `acceptPanel` wirft nie. Geschrieben wird nie der gespeicherte Rundentext, sondern die Aenderungskette der
// aktiven Runde auf den AKTUELLEN Text (Handaenderungen bleiben); alles oder nichts (`acceptText`).
import { Modal, TFile, type App, type MarkdownView } from "obsidian";
import { exportBaseName } from "../core/shapes/export";
import { acceptText, chainOf, type PanelState, type PanelTarget } from "../core/shapes/panel-state";
import { parseShapes } from "../core/shapes/parse";
import { referenceBlock, shapesBlock } from "../core/shapes/references";
import type { PluginSettings } from "../core/settings-types";
import { PANEL_TEXTS } from "../i18n/strings";
import { BlockChangedError, writeBlockBody, type WritePorts } from "./block-writer";
import { locateShapesFence } from "./shapes-convert";

export interface AcceptEnv {
  app: App;
  ports: WritePorts;
  settings: () => PluginSettings;
  lastEditor: () => MarkdownView | null;
  choose?: () => Promise<"block" | "file" | null>;
}

export type AcceptOutcome = { ok: boolean; message: string };

const NEW_CANNOT_REPLACE = "a new model can't replace an existing one — use New";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Notiztext aus derselben Quelle wie der Schreiber (`writeBlockBody`): offener Quell-Editor, sonst Vault. */
async function readNoteText(ports: WritePorts, path: string): Promise<string> {
  return ports.editorFor(path)?.getValue() ?? (await ports.vault.read(path));
}

/** Aktueller Text des Ziels fuers Panel; `null` = Datei/Block nicht (mehr) auffindbar. Ein Block wird ueber
 *  dieselbe Regel gefunden wie in `convertBlockAt` (Zaun genau an lineStart, Sprache shapes, Schluss an lineEnd). */
export async function readTargetText(env: AcceptEnv, t: PanelTarget): Promise<string | null> {
  if (t.kind === "shapes-file") {
    const file = env.app.vault.getAbstractFileByPath(t.path);
    return file instanceof TFile ? await env.app.vault.read(file) : null;
  }
  if (t.kind !== "shapes-block") return null;
  const file = env.app.vault.getAbstractFileByPath(t.path);
  if (!(file instanceof TFile)) return null;
  const text = await readNoteText(env.ports, t.path);
  // `listFences` zerlegt an \r?\n und fuegt mit \n zusammen: der Rumpf ist LF-normalisiert.
  return locateShapesFence(text, t.lineStart, t.lineEnd)?.body ?? null;
}

/** Eine Zeile, die den Zaun des Blocks vorzeitig schliessen wuerde (Rumpf eines BESTEHENDEN Blocks). */
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})\s*$/m;

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
    return { ok: false, message: `${NEW_CANNOT_REPLACE} — nothing was applied.` };
  }
  if (t.kind === "shapes-block") return acceptIntoBlock(env, state, t);
  if (t.kind === "shapes-file") return acceptIntoFile(env, state, t);
  return acceptAsNew(env, state);
}

async function acceptIntoBlock(env: AcceptEnv, state: PanelState, t: Extract<PanelTarget, { kind: "shapes-block" }>): Promise<AcceptOutcome> {
  const { ports } = env;
  const text = await readNoteText(ports, t.path);
  const fence = locateShapesFence(text, t.lineStart, t.lineEnd);
  if (!fence) return { ok: false, message: "the block moved — nothing was applied" };
  const result = acceptText(state.rounds, fence.body);
  if (!result.ok) return { ok: false, message: `${result.problems.join("; ")} — nothing was applied.` };
  if (result.unchanged) return { ok: true, message: "The model already looks like this — nothing to change." };
  if (FENCE_LINE.test(result.text)) return { ok: false, message: "The new text contains a line that would close the code block — nothing was applied." };
  try {
    // `fence.body` ist der Text, gegen den der Schreiber vor dem Schreiben prueft (Rumpf unveraendert).
    await writeBlockBody(ports, { path: t.path, lineStart: fence.openLine, lineEnd: fence.closeLine, fence: "shapes" }, fence.body, result.text);
  } catch (error) {
    if (error instanceof BlockChangedError) return { ok: false, message: "the note changed — nothing was applied" };
    throw error;
  }
  return { ok: true, message: `Applied to ${t.label}.` };
}

async function acceptIntoFile(env: AcceptEnv, state: PanelState, t: Extract<PanelTarget, { kind: "shapes-file" }>): Promise<AcceptOutcome> {
  const file = env.app.vault.getAbstractFileByPath(t.path);
  if (!(file instanceof TFile)) return { ok: false, message: `${t.path} is gone — nothing was applied.` };
  let problems: string[] | null = null;
  let unchanged = false;
  try {
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
  return unchanged ? { ok: true, message: "The model already looks like this — nothing to change." } : { ok: true, message: `Applied to ${t.label}.` };
}

function sourceView(env: AcceptEnv): MarkdownView | null {
  const view = env.lastEditor();
  return view?.file && view.getMode() === "source" ? view : null;
}

async function acceptAsNew(env: AcceptEnv, state: PanelState): Promise<AcceptOutcome> {
  const result = acceptText(state.rounds, null);
  if (!result.ok) return { ok: false, message: `${result.problems.join("; ")} — nothing was applied.` };
  let where: "block" | "file" | null = env.settings().acceptAs === "ask" ? null : (env.settings().acceptAs as "block" | "file");
  if (env.settings().acceptAs === "ask") {
    where = (await env.choose?.()) ?? null;
    if (where === null) return { ok: false, message: "Cancelled — nothing was applied." };
  }
  return where === "block" ? insertAsBlock(env, result.text) : createAsFile(env, result.text);
}

function insertAsBlock(env: AcceptEnv, text: string): AcceptOutcome {
  const view = sourceView(env);
  if (!view) return { ok: false, message: PANEL_TEXTS.noNoteOpen };
  view.editor.replaceSelection(`\n${shapesBlock(text)}\n`);
  return { ok: true, message: "Inserted the model as a code block at the cursor." };
}

async function createAsFile(env: AcceptEnv, text: string): Promise<AcceptOutcome> {
  const { app } = env;
  const view = sourceView(env);
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
  if (!view) return { ok: true, message: `Saved ${path}. No note is open, so no reference was inserted.` };
  try {
    view.editor.replaceSelection(`\n${referenceBlock(app.metadataCache.fileToLinktext(created, notePath, false))}\n`);
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
