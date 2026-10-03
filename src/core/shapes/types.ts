// Gemeinsame Typen der shapes-DSL. Pure.
import type { ViewRef } from "../view-spec";

export type ShapeKind = "box" | "cylinder" | "sphere" | "cone";
export const SHAPE_KINDS: readonly ShapeKind[] = ["box", "cylinder", "sphere", "cone"];

/** Schlüsselwörter einer Teilzeile. Ein Teilname darf keins davon sein. */
export const KEYWORDS = ["size", "at", "rot", "color"] as const;
export type Keyword = (typeof KEYWORDS)[number];

export type Vec3 = [number, number, number];

/** Ein Teil ohne Herkunft — so erzeugt es der Formatierer aus LLM-JSON. */
export interface ShapeDraft {
  kind: ShapeKind;
  name: string;
  /** box: 3 Werte · cylinder/cone: Radius, Höhe · sphere: Radius. */
  size: number[];
  at: Vec3;
  rot: Vec3;
  /** `#rrggbb` klein, oder `null` = Default-Farbe. */
  color: string | null;
}

export interface ShapePart extends ShapeDraft {
  /** 1-basierte Zeilennummer im Quelltext. */
  line: number;
}

export interface ShapesHeader {
  title?: string;
  height?: number;
  view?: ViewRef;
}

export interface LineIssue {
  line: number;
  message: string;
}

export interface ParsedShapes {
  header: ShapesHeader;
  parts: ShapePart[];
  errors: LineIssue[];
  warnings: LineIssue[];
}

export const DEFAULT_COLOR = "#a0a0a0";
