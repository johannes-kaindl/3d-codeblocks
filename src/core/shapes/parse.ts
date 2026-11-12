// shapes-Text → Kopf, Teile, Fehler. Pure. Fehler gelten JE ZEILE: eine kaputte Zeile
// kostet nur ihr Teil, der Rest rendert (Spec § 3.3).
import { parseBlockLines } from "../../vendor/kit/block-lines";
import { normalizeHex } from "../../vendor/kit/css-color";
import { parseView, VIEW_NAMES } from "../view-spec";
import {
  KEYWORDS,
  SHAPE_KINDS,
  type Keyword,
  type LineIssue,
  type ParsedShapes,
  type ShapeKind,
  type ShapePart,
  type ShapesHeader,
  type Vec3,
} from "./types";
import { t } from "../../i18n/t";

const NAME = /^[\p{L}\p{N}_-]+$/u;
/** Warnungen „unbekanntes Wort“: `changes.ts` erkennt sie am Objekt, nicht am (übersetzten) Text. */
const UNKNOWN_WORD = new WeakSet<LineIssue>();
export const isUnknownWordWarning = (w: LineIssue): boolean => UNKNOWN_WORD.has(w);

const HEADER_KEYS = ["title", "height", "view"];

export function isValidName(name: string): boolean {
  return NAME.test(name) && !(KEYWORDS as readonly string[]).includes(name.toLowerCase());
}

/** `#rgb`/`#rrggbb` in beliebiger Schreibweise -> `#rrggbb` klein, sonst `null` (Kit `css-color`, code-kit 0.56.0; der Ursprung des Kit-Moduls ist diese Funktion). */
export function normalizeColor(value: string): string | null {
  return normalizeHex(value);
}

export function normalizeSize(kind: ShapeKind, values: number[]): number[] | string {
  let size: number[] | null = null;
  let arityMessage = "";
  if (kind === "box") {
    if (values.length === 1) size = [values[0], values[0], values[0]];
    else if (values.length === 3) size = [...values];
    arityMessage = t("core.parse.sizeBox");
  } else if (kind === "sphere") {
    if (values.length === 1) size = [...values];
    arityMessage = t("core.parse.sizeSphere");
  } else {
    if (values.length === 2) size = [...values];
    arityMessage = t("core.parse.sizeRound", kind);
  }
  if (size === null) return arityMessage;
  if (size.some((v) => !(v > 0))) return t("core.parse.sizePositive");
  return size;
}

function isKeyword(token: string): token is Keyword {
  return (KEYWORDS as readonly string[]).includes(token.toLowerCase());
}

type PartResult = { part: ShapePart; warnings: LineIssue[] } | { error: string };

function parsePartLine(line: string, lineNo: number): PartResult {
  const tokens = line.split(/\s+/);
  const kind = tokens[0].toLowerCase();
  if (!(SHAPE_KINDS as readonly string[]).includes(kind)) {
    return { error: t("core.parse.unknownShape", tokens[0]) };
  }
  const name = tokens[1];
  if (name === undefined || !isValidName(name)) {
    return { error: t("core.parse.needsName") };
  }

  const warnings: LineIssue[] = [];
  const seen = new Set<string>();
  let size: number[] | null = null;
  let at: Vec3 = [0, 0, 0];
  let rot: Vec3 = [0, 0, 0];
  let color: string | null = null;

  let i = 2;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!isKeyword(token)) {
      const warning: LineIssue = { line: lineNo, message: t("core.parse.unknownWord", token) };
      UNKNOWN_WORD.add(warning);
      warnings.push(warning);
      i += 1;
      continue;
    }
    const keyword = token.toLowerCase() as Keyword;
    if (seen.has(keyword)) return { error: `\`${keyword}\` given twice` };
    seen.add(keyword);
    i += 1;

    if (keyword === "color") {
      const value = tokens[i];
      const normalized = value === undefined || isKeyword(value) ? null : normalizeColor(value);
      if (normalized === null) return { error: "`color` needs a hex colour like #8b5a2b" };
      color = normalized;
      i += 1;
      continue;
    }

    // Zahlen einsammeln, bis etwas kommt, das keine Zahl ist.
    const numbers: number[] = [];
    while (i < tokens.length && tokens[i] !== "" && Number.isFinite(Number(tokens[i]))) {
      numbers.push(Number(tokens[i]));
      i += 1;
    }
    if (keyword === "size") {
      const normalized = normalizeSize(kind as ShapeKind, numbers);
      if (typeof normalized === "string") return { error: normalized };
      size = normalized;
    } else {
      if (numbers.length !== 3) return { error: `\`${keyword}\` needs 3 numbers` };
      const vec: Vec3 = [numbers[0], numbers[1], numbers[2]];
      if (keyword === "at") at = vec;
      else rot = vec;
    }
  }

  if (size === null) return { error: "`size` is missing" };
  return { part: { kind: kind as ShapeKind, name, size, at, rot, color, line: lineNo }, warnings };
}

function applyHeader(
  key: string,
  rawValue: string,
  lineNo: number,
  header: ShapesHeader,
  errors: LineIssue[],
  warnings: LineIssue[],
): void {
  const value = rawValue.trim();
  const lower = key.toLowerCase();
  if (lower === "file") {
    errors.push({ line: lineNo, message: t("core.parse.fileKey") });
    return;
  }
  if (!HEADER_KEYS.includes(lower)) {
    warnings.push({ line: lineNo, message: t("core.parse.unknownKey", key) });
    return;
  }
  if (lower === "title") {
    header.title = value;
  } else if (lower === "height") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      warnings.push({ line: lineNo, message: t("core.parse.height", value) });
    } else {
      header.height = parsed;
    }
  } else {
    const parsed = parseView(value);
    if (parsed === null) {
      warnings.push({
        line: lineNo,
        message: t("core.parse.view", value, VIEW_NAMES),
      });
    } else {
      header.view = parsed;
    }
  }
}

export function parseShapes(source: string): ParsedShapes {
  const header: ShapesHeader = {};
  const parts: ShapePart[] = [];
  const errors: LineIssue[] = [];
  const warnings: LineIssue[] = [];
  const names = new Set<string>();
  let seenPart = false;

  // Kopfzeilen (`key: value`) und Teile-Zeilen trennt das Kit (`block-lines`); hier laufen beide wieder in Quellreihenfolge,
  // weil eine Kopfzeile nach dem ersten Teil ein Fehler ist.
  const { entries, loose } = parseBlockLines(source);
  const lines = [
    ...entries.map((entry) => ({ lineNo: entry.line, entry, text: "" })),
    ...loose.map((l) => ({ lineNo: l.line, entry: null, text: l.text })),
  ].sort((x, y) => x.lineNo - y.lineNo);

  for (const item of lines) {
    const lineNo = item.lineNo;
    if (item.entry !== null) {
      if (seenPart) {
        errors.push({ line: lineNo, message: t("core.parse.headerOrder") });
        continue;
      }
      applyHeader(item.entry.rawKey, item.entry.rawValue, lineNo, header, errors, warnings);
      continue;
    }
    const line = item.text;

    seenPart = true;
    const result = parsePartLine(line, lineNo);
    if ("error" in result) {
      errors.push({ line: lineNo, message: result.error });
      continue;
    }
    warnings.push(...result.warnings);
    if (names.has(result.part.name)) {
      errors.push({ line: lineNo, message: t("core.parse.duplicate", result.part.name) });
      continue;
    }
    names.add(result.part.name);
    parts.push(result.part);
  }

  return { header, parts, errors, warnings };
}
