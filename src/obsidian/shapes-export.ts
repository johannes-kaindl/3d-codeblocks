// Befehl "Export shapes model as glTF": Quelle ist der ```shapes-Block unter dem Cursor
// oder die aktive .shapes-Datei. Ziel ist der Attachment-Ordner; eine vorhandene Datei
// wird nur nach Rückfrage überschrieben — nie still, und nie als "Tisch 1.gltf"-Kette.
import { MarkdownView, Notice, TFile, type App } from "obsidian";
import { buildGltfExport, exportBaseName } from "../core/shapes/export";
import { findFenceAt } from "../core/shapes/fence";

interface Source {
  text: string;
  fallbackName: string;
  sourcePath: string;
  generatedFrom: string;
}

async function findSource(app: App): Promise<Source | null> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (view?.file && view.getMode() === "source") {
    const fence = findFenceAt(view.editor.getValue(), view.editor.getCursor().line);
    if (fence?.lang === "shapes") {
      return {
        text: fence.body,
        fallbackName: view.file.basename,
        sourcePath: view.file.path,
        generatedFrom: `${view.file.path} (shapes code block)`,
      };
    }
  }
  const file = app.workspace.getActiveFile();
  if (file instanceof TFile && file.extension === "shapes") {
    return { text: await app.vault.read(file), fallbackName: file.basename, sourcePath: file.path, generatedFrom: file.path };
  }
  return null;
}

export async function exportShapesAsGltf(app: App, confirm: (message: string) => Promise<boolean>): Promise<void> {
  try {
    await runExport(app, confirm);
  } catch (error) {
    new Notice(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runExport(app: App, confirm: (message: string) => Promise<boolean>): Promise<void> {
  const source = await findSource(app);
  if (!source) {
    new Notice("Place the cursor in a ```shapes block or open a .shapes file to export it.");
    return;
  }
  const built = buildGltfExport(source.text, source.generatedFrom);
  if (!built.ok) {
    new Notice(`Nothing to export: ${built.messages.join(" ")}`);
    return;
  }

  const fileName = `${exportBaseName({ title: built.title }, source.fallbackName)}.gltf`;
  const freePath = await app.fileManager.getAvailablePathForAttachment(fileName, source.sourcePath);
  const slash = freePath.lastIndexOf("/");
  const wanted = slash >= 0 ? `${freePath.slice(0, slash)}/${fileName}` : fileName;
  let target = app.vault.getAbstractFileByPath(wanted);

  if (target && !(target instanceof TFile)) {
    new Notice(`Cannot export: ${wanted} is a folder.`);
    return;
  }
  // freePath ist nummeriert, wenn der Name belegt ist. Findet der exakte Pfad nichts (Groß-/
  // Kleinschreibung auf macOS), wird der Treffer ohne Rücksicht auf die Schreibweise gesucht.
  if (!target && freePath !== wanted) {
    const lower = wanted.toLowerCase();
    target = app.vault.getFiles().find((f) => f.path.toLowerCase() === lower) ?? null;
    if (!target) {
      new Notice(`Cannot export: ${wanted} is taken but could not be found.`);
      return;
    }
  }

  if (target instanceof TFile) {
    if (!(await confirm(`Overwrite ${target.path}?`))) return;
    await app.vault.modify(target, built.json);
    new Notice(`Exported to ${target.path}`);
    return;
  }
  await app.vault.create(wanted, built.json);
  new Notice(`Exported to ${wanted}`);
}
