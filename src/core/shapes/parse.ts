// shapes-Text → Kopf, Teile, Fehler. Pure. Fehler gelten JE ZEILE: eine kaputte Zeile
// kostet nur ihr Teil, der Rest rendert (Spec § 3.3).
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

// Dasselbe Muster wie `block-config.ts` — eine Kopfzeile sieht hier aus wie dort.
const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(.*)$/;
const NAME = /^[\p{L}\p{N}_-]+$/u;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HEADER_KEYS = ["title", "height", "view"];

export function isValidName(name: string): boolean {
  return NAME.test(name) && !(KEYWORDS as readonly string[]).includes(name.toLowerCase());
}

export function normalizeColor(value: string): string | null {
  const m = HEX.exec(value);
  if (!m) return null;
  const hex = m[1].toLowerCase();
  return hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex}`;
}

export function normalizeSize(kind: ShapeKind, values: number[]): number[] | string {
  let size: number[] | null = null;
  let arityMessage = "";
  if (kind === "box") {
    if (values.length === 1) size = [values[0], values[0], values[0]];
    else if (values.length === 3) size = [...values];
    arityMessage = "`size` of a box needs 1 or 3 numbers";
  } else if (kind === "sphere") {
    if (values.length === 1) size = [...values];
    arityMessage = "`size` of a sphere needs 1 number (radius)";
  } else {
    if (values.length === 2) size = [...values];
    arityMessage = `\`size\` of a ${kind} needs 2 numbers (radius, height)`;
  }
  if (size === null) return arityMessage;
  if (size.some((v) => !(v > 0))) return "`size` values must be greater than 0";
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
    return { error: `Unknown shape \`${tokens[0]}\` — use box, cylinder, sphere or cone` };
  }
  const name = tokens[1];
  if (name === undefined || !isValidName(name)) {
    return { error: "Every part needs a name after the shape (letters, digits, `-`, `_`)" };
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
      warnings.push({ line: lineNo, message: `Unknown word \`${token}\` ignored` });
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
    errors.push({ line: lineNo, message: "`file:` belongs in a `3d` block — a shapes block holds the parts itself" });
    return;
  }
  if (!HEADER_KEYS.includes(lower)) {
    warnings.push({ line: lineNo, message: `Unknown key: \`${key}\`` });
    return;
  }
  if (lower === "title") {
    header.title = value;
  } else if (lower === "height") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      warnings.push({ line: lineNo, message: `\`height\` must be a number: \`${value}\`` });
    } else {
      header.height = parsed;
    }
  } else {
    const parsed = parseView(value);
    if (parsed === null) {
      warnings.push({
        line: lineNo,
        message: `\`view\`: unknown view \`${value}\` — use ${VIEW_NAMES} or three numbers (azimuth,elevation,distance)`,
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

  source.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;

    const key = KEY_LINE.exec(line);
    if (key) {
      if (seenPart) {
        errors.push({ line: lineNo, message: "Header lines (`key: value`) must come before the first part" });
        return;
      }
      applyHeader(key[1], key[2], lineNo, header, errors, warnings);
      return;
    }

    seenPart = true;
    const result = parsePartLine(line, lineNo);
    if ("error" in result) {
      errors.push({ line: lineNo, message: result.error });
      return;
    }
    warnings.push(...result.warnings);
    if (names.has(result.part.name)) {
      errors.push({ line: lineNo, message: `Duplicate name \`${result.part.name}\`` });
      return;
    }
    names.add(result.part.name);
    parts.push(result.part);
  });

  return { header, parts, errors, warnings };
}
