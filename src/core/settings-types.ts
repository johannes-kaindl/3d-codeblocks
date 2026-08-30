// Settings-Typ, Defaults und der validierende Merge. Pure.
//
// `validateSettings` prueft jedes Feld einzeln statt `{...DEFAULTS, ...loaded}` —
// ein Spread wuerde Muellwerte aus einer alten oder handgeschriebenen data.json
// unbesehen durchreichen. Die Mechanik dafuer kommt seit Kit 0.27.0 aus
// `../vendor/kit/settings_schema` (dorthin extrahiert aus fuenf Fassungen, eine
// davon war die hiesige); hier bleiben nur noch Typen, Defaults und das
// plugin-eigene Feld-Schema.
//
// Namenswechsel gegenueber frueher: die Funktion hiess `mergeSettings`, meint aber
// die GESCHLOSSENE Welt (unbekannte Keys fliegen raus). Im Kit heisst genau das
// `validateSettings`; `mergeSettings` ist dort die offene Welt.

import type { PanelPlacement } from "./panel-target";
import {
  check,
  oneOf,
  validateSettings as validateAgainstSchema,
  type FieldCheck,
  type SettingsSchema,
} from "../vendor/kit/settings_schema";

export type ViewMode = "immediate" | "on-click";

export interface PluginSettings {
  viewMode: ViewMode;
  defaultHeight: number;
  autoRotate: boolean;
  showGrid: boolean;
  maxContexts: number;
  panelPlacement: PanelPlacement;
  lockedNodePrefixes: string;
  /** `.gltf`-Nebendateien duerfen von http(s) kommen. Aus: nur der eigene Vault. */
  allowExternalResources: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  viewMode: "immediate",
  defaultHeight: 400,
  autoRotate: false,
  showGrid: false,
  maxContexts: 6,
  panelPlacement: "auto",
  lockedNodePrefixes: "env__",
  allowExternalResources: false,
};

export const MAX_CONTEXTS_LIMIT = 12;

/** "env__, sky__" → ["env__", "sky__"] — leere Eintraege und Raender verworfen. */
export function parseLockedPrefixes(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

// Bewusst NICHT `clampIntField(0, MAX_CONTEXTS_LIMIT)`: das Kit-Feld klemmt einen
// negativen Wert auf `min`, also auf 0 — und 0 heisst hier "Limit aus". Eine kaputte
// data.json wuerde damit still das Kontext-Limit abschalten statt auf den Default
// zurueckzufallen. Ausserdem rundet die hiesige Fassung (6.7 → 7), waehrend
// `clampInt` trunct, und sie verwirft Zahl-Strings, statt sie zu parsen.
const clampContexts: FieldCheck<number> = (raw, fallback) => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const rounded = Math.round(raw);
  // 0 = off (unbegrenzt); negativ ist unsinnig → Default. Sonst auf 0..12 klemmen.
  if (rounded < 0) return fallback;
  return Math.min(MAX_CONTEXTS_LIMIT, rounded);
};

// Felder ohne Eintrag (`autoRotate`, `showGrid`, `lockedNodePrefixes`) bekommen die
// generische Bauform-Pruefung des Kit gegen ihren Default. Fuer `lockedNodePrefixes`
// ist das Absicht und keine Luecke: "" ist hier ein gueltiger Wert ("nichts sperren"),
// `nonEmptyString` wuerde ihn auf `env__` zurueckwerfen.
const SETTINGS_SCHEMA: SettingsSchema<PluginSettings> = {
  viewMode: oneOf(["immediate", "on-click"] as const),
  panelPlacement: oneOf(["auto", "sidebar", "toolbar"] as const),
  // Die generische Zahl-Pruefung nimmt jede endliche Zahl, also auch 0 und -1 —
  // eine Hoehe von 0 ist aber kein Wunsch, sondern ein kaputter Wert.
  defaultHeight: check((v) => typeof v === "number" && Number.isFinite(v) && v > 0),
  // Anders als `defaultHeight`: eine vorhandene Zahl wird geklemmt, nicht verworfen —
  // wer 0 oder 999 eintraegt, meint "so wenig/viel wie moeglich".
  maxContexts: clampContexts,
};

export function validateSettings(loaded: unknown): PluginSettings {
  return validateAgainstSchema(DEFAULT_SETTINGS, loaded, SETTINGS_SCHEMA);
}
