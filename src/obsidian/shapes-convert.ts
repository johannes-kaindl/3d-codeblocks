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

export interface ConvertEnv {
  app: App;
  ports: WritePorts;
  notice: (message: string) => void;
}

const CLOSE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

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
  if (fence.closeLine <= fence.openLine || !CLOSE_FENCE.test(lines[fence.closeLine])) {
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
    if (app.vault.getAbstractFileByPath(path)) {
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

const SCANNED_EXTENSIONS = new Set(["md", "canvas", "base"]);

const REASON_TEXT: Record<AloneReason, string> = {
  list: "sits in a list item",
  quote: "sits in a quote or callout",
  indent: "is indented",
  inline: "is in the middle of a sentence (a code block cannot split a sentence)",
  table: "sits in a table",
  continuation: "continues a paragraph",
};

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
  if (ref.kind === "embed" && !ref.alone) {
    const reason = ref.aloneReason ? REASON_TEXT[ref.aloneReason] : "is not on its own line";
    return `The embed of ${name} at ${at} ${reason}. Move it onto its own line at the top level first — nothing was changed.`;
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

async function run(app: App, ports: WritePorts, notice: (m: string) => void, file: TFile): Promise<boolean> {
  // Markdown UND Canvas/Base: eine Canvas-Datei oder eine Base kann die Datei einbetten. Gelesen wird
  // von der Platte (read), nicht aus dem Cache: ein veralteter Cache liesse einen Verweis verschwinden.
  const scanned = app.vault.getFiles().filter((f) => SCANNED_EXTENSIONS.has(f.extension.toLowerCase()));
  const notes: NoteText[] = await Promise.all(scanned.map(async (f) => ({ path: f.path, text: await app.vault.read(f) })));
  const markdown = notes.filter((n) => /\.md$/i.test(n.path));
  const refs = findModelReferences(markdown, file.path, (link, sourcePath) => resolveModelPath(app, link, sourcePath)?.path ?? null);

  const refused = refusal(file, refs);
  if (refused) {
    notice(refused);
    return false;
  }
  const ref = refs[0];

  // Sicherheitsnetz: jede Erwaehnung des Dateinamens, die kein gefundener Verweis ist (Text, gleichnamige
  // Datei woanders, Canvas, Base). Im Zweifel bleibt die Datei, wo sie ist.
  const mentions = unaccountedMentions(notes, file.path, refs);
  if (mentions.length > 0) {
    const list = mentions.slice(0, 3).map((m) => `${m.notePath}, line ${m.line + 1}`).join("; ");
    const more = mentions.length > 3 ? ` (and ${mentions.length - 3} more)` : "";
    notice(
      `${file.name} has another mention: ${list}${more}. A mention by file name alone (in text, in a canvas or base file, or a differently located file of the same name) blocks the conversion, because deleting the file could break it — nothing was changed.`,
    );
    return false;
  }

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
    if ((await app.vault.read(file)) !== text) {
      notice(`${file.name} is now a code block in ${ref.notePath}, but the file changed meanwhile, so it was left in place at ${file.path}.`);
      return true;
    }
    await app.fileManager.trashFile(file);
  } catch (error) {
    notice(`${file.name} is now a code block in ${ref.notePath}, but the file could not be moved to the trash (${errorText(error)}). It is still at ${file.path}.`);
    return true;
  }
  notice(`${file.name} is now a code block in ${ref.notePath}. The file went to the trash — restore it from the system trash or the .trash folder if you need it.`);
  return true;
}
