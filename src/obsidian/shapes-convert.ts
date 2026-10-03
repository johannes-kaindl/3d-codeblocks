// Umwandeln ```shapes-Block <-> .shapes-Datei (Spec Modell per Prompt § 5.2). Beide Richtungen sind
// ein UMZUG, keine Kopie: hinterher gibt es den Text genau einmal. Datenschutz geht vor Komfort:
// jede Unsicherheit ist eine Ablehnung MIT Meldung, nie ein stilles Nichts und nie ein Schreibversuch.
//
// Block -> Datei: erst die Datei anlegen (nummerierter freier Pfad, nie ueberschreiben), dann den Zaun
//   ersetzen. Scheitert das Ersetzen, wird die eben angelegte Datei wieder entfernt.
// Datei -> Block: erst die Notiz aendern (replaceLines prueft den erwarteten Text), DANACH die Datei in
//   den Papierkorb. Scheitert das Ersetzen, bleibt die Datei unberuehrt; scheitert der Papierkorb, bleibt
//   die Datei stehen (nie ein Rollback durch Neuanlegen).
import { MarkdownView, TFile, type App } from "obsidian";
import { parseBlockConfig } from "../core/block-config";
import { findFenceAt, type Fence } from "../core/shapes/fence";
import { exportBaseName } from "../core/shapes/export";
import { parseShapes } from "../core/shapes/parse";
import {
  findModelReferences,
  referenceBlock,
  shapesBlock,
  unaccountedMentions,
  type AloneReason,
  type ModelReference,
  type NoteText,
} from "../core/shapes/references";
import { BlockChangedError, replaceLines, type WritePorts } from "./block-writer";
import { resolveModelPath } from "./file-source";
import { VIEW_TYPE_SHAPES } from "./shapes-file-view";

export interface ConvertEnv {
  app: App;
  ports: WritePorts;
  notice: (message: string) => void;
}

/** Schlusszeile passend zum Oeffner: gleiches Zeichen, mindestens so lang (`~~~` schliesst keinen Backtick-Zaun). */
function closesFence(openLine: string, closeLine: string): boolean {
  const open = /^\s*(`{3,}|~{3,})/.exec(openLine.replace(/^\uFEFF/, ""));
  if (!open) return false;
  const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(closeLine);
  return close !== null && close[1][0] === open[1][0] && close[1].length >= open[1].length;
}

function sourceEditor(app: App): { view: MarkdownView; file: TFile } | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.file || view.getMode() !== "source") return null;
  return { view, file: view.file };
}

/** Der ```shapes-Block unter dem Cursor, oder der Grund, warum er nicht umgezogen werden kann. */
function shapesFenceAtCursor(src: { view: MarkdownView }): { fence: Fence; lines: string[] } | { problem: string } | null {
  const text = src.view.editor.getValue();
  const fence = findFenceAt(text, src.view.editor.getCursor().line);
  if (fence?.lang !== "shapes") return null;
  const lines = text.split(/\r?\n/);
  // BOM auf Zeile 0 gehoert nicht zur Einrueckung.
  const open = lines[fence.openLine].replace(/^\uFEFF/, "");
  if (/^\s/.test(open)) {
    return { problem: "The ```shapes block is indented (probably inside a list or quote). A file reference cannot replace it there without breaking the structure — nothing was changed." };
  }
  if (fence.closeLine <= fence.openLine || !closesFence(lines[fence.openLine], lines[fence.closeLine])) {
    return { problem: "The ```shapes block has no closing fence — close it first. Nothing was changed." };
  }
  if (fence.body.trim() === "") {
    return { problem: "The ```shapes block is empty — there is nothing to move into a file." };
  }
  return { fence, lines };
}

/** Billig und ohne Nebenwirkung: steht der Cursor in einem ```shapes-Block (im Quellmodus)? */
export function canConvertBlockToFile(app: App): boolean {
  const src = sourceEditor(app);
  return src !== null && shapesFenceAtCursor(src) !== null;
}

export async function convertBlockToFile(env: ConvertEnv): Promise<boolean> {
  const { app, ports, notice } = env;
  const src = sourceEditor(app);
  const found = src ? shapesFenceAtCursor(src) : null;
  if (!src || !found) {
    notice("Place the cursor in a ```shapes block (editing view) to move it into a .shapes file.");
    return false;
  }
  if ("problem" in found) {
    notice(found.problem);
    return false;
  }
  const { fence, lines } = found;
  const expected = lines.slice(fence.openLine, fence.closeLine + 1).join("\n");

  let created: TFile | null = null;
  let path = "";
  try {
    const name = `${exportBaseName(parseShapes(fence.body).header, src.file.basename)}.shapes`;
    path = await app.fileManager.getAvailablePathForAttachment(name, src.file.path);
    // Nie ueberschreiben, auch nicht bei einer Schreibweise, die die Pfadvergabe uebersieht.
    // Zweiter Gurt: die Schreibweisen-Regeln (Gross/Klein) kennt der Adapter, nicht wir.
    if (app.vault.getAbstractFileByPath(path) || (await app.vault.adapter.exists(path))) {
      notice(`${path} already exists — nothing was changed.`);
      return false;
    }
    // Die Datei endet mit genau einem Zeilenumbruch, LF.
    created = await app.vault.create(path, `${fence.body}\n`);
  } catch (error) {
    notice(`Could not create the file${path ? ` ${path}` : ""}: ${errorText(error)} — nothing was changed.`);
    return false;
  }

  try {
    const linktext = app.metadataCache.fileToLinktext(created, src.file.path, false);
    await replaceLines(ports, src.file.path, fence.openLine, fence.closeLine, expected, referenceBlock(linktext));
  } catch (error) {
    const why = error instanceof BlockChangedError ? "The note changed while converting" : `Could not update the note (${errorText(error)})`;
    try {
      await app.fileManager.trashFile(created);
      notice(`${why} — nothing was changed (the new file was removed again).`);
    } catch (removeError) {
      notice(`${why} — the note is unchanged, but the new file ${path} could not be removed (${errorText(removeError)}). Delete it by hand.`);
    }
    return false;
  }
  notice(`Moved the block to ${path}.`);
  return true;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Welche .shapes-Datei ist gemeint? Cursor auf ```3d-Block oder Embed-Zeile, sonst die aktive Datei. */
function targetFile(app: App): TFile | null {
  const src = sourceEditor(app);
  if (src) {
    const text = src.view.editor.getValue();
    const line = src.view.editor.getCursor().line;
    const fence = findFenceAt(text, line);
    if (fence?.lang === "3d") {
      const link = parseBlockConfig(fence.body).config?.file;
      const file = link ? resolveModelPath(app, link, src.file.path) : null;
      if (file?.extension === "shapes") return file;
    }
    const embed = /!\[\[([^\]|#^]+)/.exec(text.split(/\r?\n/)[line] ?? "");
    if (embed) {
      const file = resolveModelPath(app, embed[1].trim(), src.file.path);
      if (file?.extension === "shapes") return file;
    }
  }
  const active = app.workspace.getActiveFile();
  return active instanceof TFile && active.extension === "shapes" ? active : null;
}

export function canConvertFileToBlock(app: App): boolean {
  return targetFile(app) !== null;
}

interface OpenShapesView {
  file: TFile | null;
  save(): Promise<void>;
  getViewData(): string;
}

const SCANNED_EXTENSIONS = new Set(["md", "canvas", "base"]);

const REASON_TEXT: Record<AloneReason, string> = {
  list: "sits in a list item",
  quote: "sits in a quote or callout",
  indent: "is indented",
  inline: "is in the middle of a sentence (a code block cannot split a sentence)",
  table: "sits in a table",
  continuation: "continues a paragraph",
  "markdown-embed": "is a Markdown-style embed — change it to ![[…]] first",
};

const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:/;

/** Schluessel (oder Zeilentext) jeder Zeile des ```3d-Blocks ausser der EINEN Datei-Zeile, dazu ob `#`-Kommentare
 *  darin stehen (sie gingen mit dem Block verloren). Leerzeilen zaehlen nicht, eine unbekannte Schluesselzeile schon. */
function extraBlockKeys(blockText: string): { keys: string[]; comments: boolean } {
  const lines = blockText.split(/\r?\n/);
  const body = lines.slice(1, /^\s*(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1] ?? "") ? -1 : undefined);
  const extras: string[] = [];
  let fileSeen = false;
  let comments = false;
  for (const raw of body) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      comments = true;
      continue;
    }
    const key = KEY_LINE.exec(line)?.[1].toLowerCase();
    if (key === "file" || key === undefined) {
      // `key === undefined` ist die Pfad-Kurzform; die erste Datei-Zeile ist der Verweis selbst.
      if (!fileSeen) {
        fileSeen = true;
        continue;
      }
      extras.push(key ?? line);
    } else extras.push(key);
  }
  return { keys: [...new Set(extras)], comments };
}

function refusal(file: TFile, refs: ModelReference[]): string | null {
  const name = file.name;
  const where = (list: ModelReference[]) => [...new Set(list.map((r) => r.notePath))].join(", ");
  if (refs.length === 0) return `${name} is not used in any note — nothing to turn into a block.`;
  if (refs.length > 1) {
    return `${name} is used in ${refs.length} places (${where(refs)}). Turning it into one block would leave the others without a model — nothing was changed.`;
  }
  const ref = refs[0];
  const at = `${ref.notePath}, line ${ref.from + 1}`;
  if (ref.kind === "link") {
    return `${name} is only linked ([[…]] without !) at ${at}. A link cannot become a code block, and it would break once the file is gone — nothing was changed.`;
  }
  if (ref.kind === "block" && ref.nested) {
    return `The \`\`\`3d block that uses ${name} (${at}) sits inside a quote, callout or list. Replacing it would break that structure — nothing was changed.`;
  }
  if (ref.kind === "block") {
    const extras = extraBlockKeys(ref.text);
    if (extras.keys.length > 0) {
      return `The \`\`\`3d block that uses ${name} (${at}) has other settings (${extras.keys.join(", ")}) that a code block of the shapes language cannot keep — remove them or move the file by hand — nothing was changed.`;
    }
    if (extras.comments) {
      return `The \`\`\`3d block that uses ${name} (${at}) has comment lines that would be lost — remove them or move the file by hand — nothing was changed.`;
    }
  }
  if (ref.kind === "embed" && !ref.alone) {
    if (ref.aloneReason === "markdown-embed") {
      return `The embed of ${name} at ${at} ${REASON_TEXT["markdown-embed"]} — nothing was changed.`;
    }
    const reason = ref.aloneReason ? REASON_TEXT[ref.aloneReason] : "is not on its own line";
    return `The embed of ${name} at ${at} ${reason}. Move it onto its own line at the top level first — nothing was changed.`;
  }
  if (ref.kind === "embed" && ref.options) {
    return `The embed of ${name} at ${at} has display options (${ref.options}) that a code block cannot keep — remove them first — nothing was changed.`;
  }
  return null;
}

export async function convertFileToBlock(env: ConvertEnv): Promise<boolean> {
  const { app, ports, notice } = env;
  const file = targetFile(app);
  if (!file) {
    notice("Place the cursor on a reference to a .shapes file, or open one, to turn it into a code block.");
    return false;
  }
  try {
    return await run(app, ports, notice, file);
  } catch (error) {
    notice(`Could not convert ${file.name}: ${errorText(error)} — nothing was changed.`);
    return false;
  }
}

function mentionNotice(file: TFile, mentions: { notePath: string; line: number }[]): string {
  const list = mentions.slice(0, 3).map((m) => `${m.notePath}, line ${m.line + 1}`).join("; ");
  const more = mentions.length > 3 ? ` (and ${mentions.length - 3} more)` : "";
  return `${file.name} has another mention: ${list}${more}. A mention by file name alone (in text, in a canvas or base file, or a differently located file of the same name) blocks the conversion, because deleting the file could break it — nothing was changed.`;
}

/** Was mit der Datei passiert, sagt die Obsidian-Einstellung "Deleted files" (trashOption), nicht wir. */
function trashOutcome(app: App): string {
  const option = (app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig?.("trashOption");
  if (option === "local") return "The file was moved to the .trash folder of the vault — restore it from there if you need it.";
  if (option === "system") return "The file was moved to the system trash — restore it from there if you need it.";
  return "The file was removed according to your Deleted files setting (it is not recoverable if that is set to permanently delete).";
}

async function run(app: App, ports: WritePorts, notice: (m: string) => void, file: TFile): Promise<boolean> {
  // Markdown UND Canvas/Base: eine Canvas-Datei oder eine Base kann die Datei einbetten. Gelesen wird
  // von der Platte (read), nicht aus dem Cache: ein veralteter Cache liesse einen Verweis verschwinden.
  const scanned = app.vault.getFiles().filter((f) => SCANNED_EXTENSIONS.has(f.extension.toLowerCase()));
  if (scanned.length > 300) notice(`Checking ${scanned.length} notes…`);
  // Ungespeichertes Tippen in einer offenen Notiz steht nur im Editor-Puffer, nicht auf der Platte.
  const notes: NoteText[] = await Promise.all(
    scanned.map(async (f) => ({ path: f.path, text: ports.editorFor(f.path)?.getValue() ?? (await app.vault.read(f)) })),
  );
  const markdown = notes.filter((n) => /\.md$/i.test(n.path));
  const refs = findModelReferences(markdown, file.path, (link, sourcePath) => resolveModelPath(app, link, sourcePath)?.path ?? null);

  const mentions = unaccountedMentions(notes, file.path, refs);
  // Ohne strukturierten Verweis, aber mit einer Erwaehnung (Canvas, Base, Text): "nicht verwendet" waere falsch.
  const refused = refs.length === 0 && mentions.length > 0 ? mentionNotice(file, mentions) : refusal(file, refs);
  if (refused) {
    notice(refused);
    return false;
  }
  const ref = refs[0];

  // Sicherheitsnetz: jede Erwaehnung des Dateinamens, die kein gefundener Verweis ist (Text, gleichnamige
  // Datei woanders, Canvas, Base). Im Zweifel bleibt die Datei, wo sie ist.
  if (mentions.length > 0) {
    notice(mentionNotice(file, mentions));
    return false;
  }

  // Offene Ansichten der Datei: ungespeicherte Eingaben zuerst auf die Platte (save), sonst zoege der
  // Umzug den veralteten Plattentext in die Notiz und die Eingaben gingen mit dem Papierkorb verloren.
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_SHAPES).filter((l) => (l.view as unknown as OpenShapesView).file?.path === file.path);
  const views = leaves.map((l) => l.view as unknown as OpenShapesView);
  for (const view of views) await view.save();
  const text = await app.vault.read(file);
  // Unmittelbar vor dem Schreiben: hat sich die Datei seit dem Lesen geaendert, wuerde der Umzug
  // fremde Aenderungen verlieren.
  if ((await app.vault.read(file)) !== text) {
    notice(`${file.name} changed while converting — nothing was changed.`);
    return false;
  }
  try {
    await replaceLines(ports, ref.notePath, ref.from, ref.to, ref.text, shapesBlock(text));
  } catch (error) {
    if (error instanceof BlockChangedError) {
      notice(`${ref.notePath} changed while converting — nothing was changed and ${file.name} was kept.`);
      return false;
    }
    throw error;
  }

  // Die Notiz traegt den Block. Aenderte sich die Datei seit dem Lesen, bleibt sie stehen (sonst gingen
  // die Aenderungen mit dem Papierkorb verloren).
  try {
    // Auch Tippen waehrend des Umzugs zaehlt: der Ansichtspuffer muss noch dem gelesenen Text entsprechen.
    if ((await app.vault.read(file)) !== text || views.some((v) => v.getViewData() !== text)) {
      notice(`${file.name} is now a code block in ${ref.notePath}, but the file changed meanwhile, so it was left in place at ${file.path}.`);
      return true;
    }
    // Offene Ansicht schliessen, solange die Datei noch existiert: ihr Schlusssichern schreibt dann
    // denselben Text, und kein veralteter Puffer kann die Datei nach dem Papierkorb neu anlegen.
    for (const leaf of leaves) leaf.detach();
    // Die Notiz mit dem neuen Block muss auf der Platte stehen, bevor die Datei geht (ein offener Editor
    // sichert verzoegert). Scheitert das Sichern, bleibt die Datei.
    try {
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view as unknown as { file?: TFile | null; save?: () => Promise<void> };
        if (view.file?.path === ref.notePath) await view.save?.();
      }
    } catch (error) {
      notice(`${file.name} is now a code block in ${ref.notePath}, but the note could not be saved yet (${errorText(error)}), so the file was left in place at ${file.path}.`);
      return true;
    }
    await app.fileManager.trashFile(file);
  } catch (error) {
    notice(`${file.name} is now a code block in ${ref.notePath}, but the file could not be moved to the trash (${errorText(error)}). It is still at ${file.path}.`);
    return true;
  }
  notice(`${file.name} is now a code block in ${ref.notePath}. ${trashOutcome(app)}`);
  return true;
}
