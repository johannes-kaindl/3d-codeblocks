// Codeblock-Quelltext → Konfiguration. Pure: kein obsidian-, kein three-Import.
//
// Zwei Zeilenformen:
//   `key: value`  — nur wenn die Zeile `^[A-Za-z][A-Za-z0-9_-]*\s*:` erfuellt
//   alles andere  — Pfad-Kurzform (deshalb ueberlebt `some folder/odd:name.glb`)

import { VIEW_NAMES, parseView, type ViewSpec } from "./view-spec";

export interface BlockConfig {
  file: string;
  height?: number;
  title?: string;
  view?: ViewSpec;
}

export interface ParseResult {
  /** `null`, wenn nicht gerendert werden kann (siehe `errors`). */
  config: BlockConfig | null;
  /** Blockieren das Rendering. */
  errors: string[];
  /** Erscheinen als Hinweiszeile unter dem Viewport, blocken nicht. */
  warnings: string[];
}

const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(.*)$/;
const KNOWN_KEYS = ["file", "height", "title", "view"] as const;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted && trimmed.length >= 2 ? trimmed.slice(1, -1).trim() : trimmed;
}

export function parseBlockConfig(source: string): ParseResult {
  const warnings: string[] = [];
  let file: string | undefined;
  let height: number | undefined;
  let title: string | undefined;
  let view: ViewSpec | undefined;
  let fileSeen = 0;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = KEY_LINE.exec(line);
    if (!match) {
      // Pfad-Kurzform.
      file = stripQuotes(line);
      fileSeen += 1;
      continue;
    }

    const key = match[1].toLowerCase();
    const value = stripQuotes(match[2]);

    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      warnings.push(`Unknown key: \`${match[1]}\``);
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
          `\`view\`: unknown view \`${value}\` — use ${VIEW_NAMES} or three numbers (azimuth,elevation,distance)`,
        );
      } else {
        view = parsed;
      }
    } else {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        warnings.push(`\`height\` must be a number: \`${value}\``);
      } else {
        height = parsed;
      }
    }
  }

  if (fileSeen > 1) {
    warnings.push("`file` given more than once — using the last one.");
  }

  if (file === undefined || file === "") {
    return { config: null, errors: ["No `file:` given."], warnings };
  }

  return { config: { file, height, title, view }, errors: [], warnings };
}
