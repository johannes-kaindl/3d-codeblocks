// Teile → kanonischer shapes-Text, und LLM-JSON → Teile. Pure.
// Das LLM antwortet in JSON (so ist es gemessen, Spike A); gespeichert wird Zeilentext.
import { isValidName, normalizeColor, normalizeSize } from "./parse";
import { SHAPE_KINDS, type ShapeDraft, type ShapeKind, type Vec3 } from "./types";

export function formatNumber(n: number): string {
  const rounded = Number(n.toFixed(4));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

const isZero = (v: readonly number[]): boolean => v.every((x) => x === 0);
const nums = (v: readonly number[]): string => v.map(formatNumber).join(" ");

export function formatPartLine(part: ShapeDraft): string {
  let line = `${part.kind} ${part.name} size ${nums(part.size)}`;
  if (!isZero(part.at)) line += ` at ${nums(part.at)}`;
  if (!isZero(part.rot)) line += ` rot ${nums(part.rot)}`;
  if (part.color !== null) line += ` color ${part.color}`;
  return line;
}

export function formatShapes(header: { title?: string; height?: number }, parts: readonly ShapeDraft[]): string {
  const lines: string[] = [];
  if (header.title !== undefined && header.title !== "") lines.push(`title: ${header.title}`);
  if (header.height !== undefined) lines.push(`height: ${formatNumber(header.height)}`);
  for (const part of parts) lines.push(formatPartLine(part));
  return lines.join("\n");
}

function vec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return [value[0] as number, value[1] as number, value[2] as number];
}

function cleanName(raw: unknown, kind: ShapeKind, index: number): string {
  const base = typeof raw === "string" ? raw.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "") : "";
  if (base === "") return `${kind}-${index + 1}`;
  return isValidName(base) ? base : `${base}-part`;
}

export function partsFromLlm(raw: readonly unknown[]): {
  parts: ShapeDraft[];
  dropped: { index: number; reason: string }[];
} {
  const parts: ShapeDraft[] = [];
  const dropped: { index: number; reason: string }[] = [];
  const taken = new Set<string>();

  raw.forEach((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped.push({ index, reason: "not an object" });
      return;
    }
    const rec = item as Record<string, unknown>;
    const kind = typeof rec.shape === "string" ? rec.shape.trim().toLowerCase() : "";
    if (!(SHAPE_KINDS as readonly string[]).includes(kind)) {
      dropped.push({ index, reason: `unknown shape \`${String(rec.shape)}\`` });
      return;
    }
    // Coerce size strictly: only accept typeof v === "number"
    const sizeRaw = Array.isArray(rec.size) ? rec.size : null;
    if (sizeRaw === null) {
      dropped.push({ index, reason: "`size` is missing" });
      return;
    }
    const sizeValues = sizeRaw.filter((v) => typeof v === "number");
    if (sizeValues.length !== sizeRaw.length) {
      dropped.push({ index, reason: "`size` must contain only numbers" });
      return;
    }
    // Check that all size values are finite
    if (!sizeValues.every(Number.isFinite)) {
      dropped.push({ index, reason: "`size` values must be finite" });
      return;
    }
    const size = normalizeSize(kind as ShapeKind, sizeValues);
    if (typeof size === "string") {
      dropped.push({ index, reason: size });
      return;
    }
    // Check that no size value rounds to zero
    if (size.some((v) => formatNumber(v) === "0")) {
      dropped.push({ index, reason: "`size` values must be at least 0.0001" });
      return;
    }

    let name = cleanName(rec.name, kind as ShapeKind, index);
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name}-${n}`)) n += 1;
      name = `${name}-${n}`;
    }
    taken.add(name);

    parts.push({
      kind: kind as ShapeKind,
      name,
      size,
      at: vec3(rec.position) ?? [0, 0, 0],
      rot: vec3(rec.rotation_deg) ?? [0, 0, 0],
      color: typeof rec.color === "string" ? normalizeColor(rec.color) : null,
    });
  });

  return { parts, dropped };
}
