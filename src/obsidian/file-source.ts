// Pfadaufloesung und Binaerlesen.
//
// Aufgeloest wird ueber `metadataCache.getFirstLinkpathDest` — also mit exakt der
// Semantik eines Wikilinks (relativ zur Notiz, vault-absolut, Kurzform). Ein eigener
// Aufloesungsweg wuerde sich vom Rest des Vaults unterscheiden und Nutzer ueberraschen.
import { type App, TFile, normalizePath } from "obsidian";

export interface ResolvedModel {
  file: TFile;
  data: ArrayBuffer;
  mtime: number;
}

export function resolveModelPath(app: App, path: string, sourcePath: string): TFile | null {
  const cleaned = stripDecoration(path);
  if (cleaned === "") return null;

  const found = app.metadataCache.getFirstLinkpathDest(normalizePath(cleaned), sourcePath);
  return found instanceof TFile ? found : null;
}

export async function readModel(app: App, file: TFile): Promise<ResolvedModel> {
  const data = await app.vault.readBinary(file);
  return { file, data, mtime: file.stat.mtime };
}

function stripDecoration(path: string): string {
  let value = path.trim();
  if (value.startsWith("[[") && value.endsWith("]]")) value = value.slice(2, -2).trim();
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  if (quoted && value.length >= 2) value = value.slice(1, -1).trim();
  return value;
}
