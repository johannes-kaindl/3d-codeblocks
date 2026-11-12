// Codeblock-Quelltext → Konfiguration. Pure: kein obsidian-, kein three-Import.
//
// Zwei Zeilenformen:
//   `key: value`  — nur wenn die Zeile `^[A-Za-z][A-Za-z0-9_-]*\s*:` erfuellt
//   alles andere  — Pfad-Kurzform (deshalb ueberlebt `some folder/odd:name.glb`)

import { parseBlockLines, unquote } from "../vendor/kit/block-lines";
import { VIEW_NAMES, parseView, type ViewRef } from "./view-spec";
import { t } from "../i18n/t";

export interface BlockConfig {
  file: string;
  height?: number;
  title?: string;
  view?: ViewRef;
}

export interface ParseResult {
  /** `null`, wenn nicht gerendert werden kann (siehe `errors`). */
  config: BlockConfig | null;
  /** Blockieren das Rendering. */
  errors: string[];
  /** Erscheinen als Hinweiszeile unter dem Viewport, blocken nicht. */
  warnings: string[];
}

const KNOWN_KEYS = ["file", "height", "title", "view"] as const;

export function parseBlockConfig(source: string): ParseResult {
  const warnings: string[] = [];
  let file: string | undefined;
  let height: number | undefined;
  let title: string | undefined;
  let view: ViewRef | undefined;
  let fileSeen = 0;

  // Zeilen, Kommentare, Anfuehrungszeichen und das `key: value`-Muster liest das Kit (`block-lines`); was die Schluessel
  // bedeuten und die Pfad-Kurzform (eine Zeile ohne Schluessel ist `file:`) bleibt hier. Beides in Quellreihenfolge,
  // damit bei zwei Pfaden der letzte gewinnt.
  const { entries, loose } = parseBlockLines(source);
  const lines = [
    ...entries.map((entry) => ({ line: entry.line, entry })),
    ...loose.map((l) => ({ line: l.line, entry: null, text: l.text })),
  ].sort((x, y) => x.line - y.line);

  for (const item of lines) {
    if (item.entry === null) {
      // Pfad-Kurzform.
      file = unquote(item.text);
      fileSeen += 1;
      continue;
    }

    const key = item.entry.key;
    const value = item.entry.value;

    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      warnings.push(t("core.parse.unknownKey", item.entry.rawKey));
      continue;
    }

    if (key === "file") {
      file = value;
      fileSeen += 1;
    } else if (key === "title") {
      title = value;
    } else if (key === "view") {
      const parsed = parseView(value);
      if (parsed === null) {
        warnings.push(
          t("core.cfg.view", value, VIEW_NAMES),
        );
      } else {
        view = parsed;
      }
    } else {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        warnings.push(t("core.parse.height", value));
      } else {
        height = parsed;
      }
    }
  }

  if (fileSeen > 1) {
    warnings.push(t("core.cfg.fileTwice"));
  }

  if (file === undefined || file === "") {
    return { config: null, errors: [t("core.cfg.noFile")], warnings };
  }

  return { config: { file, height, title, view }, errors: [], warnings };
}
