// Settings-Typ, Defaults und Merge. Pure.
//
// `mergeSettings` prueft jedes Feld einzeln statt `{...DEFAULTS, ...loaded}` —
// ein Spread wuerde Muellwerte aus einer alten oder handgeschriebenen data.json
// unbesehen durchreichen.

export type ViewMode = "immediate" | "on-click";

export interface PluginSettings {
  viewMode: ViewMode;
  defaultHeight: number;
  autoRotate: boolean;
  showGrid: boolean;
  maxContexts: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  viewMode: "immediate",
  defaultHeight: 400,
  autoRotate: false,
  showGrid: false,
  maxContexts: 6,
};

export const MAX_CONTEXTS_LIMIT = 16;

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampContexts(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS.maxContexts;
  return Math.min(MAX_CONTEXTS_LIMIT, Math.max(1, Math.round(value)));
}

export function mergeSettings(loaded: unknown): PluginSettings {
  if (typeof loaded !== "object" || loaded === null) return { ...DEFAULT_SETTINGS };

  const raw = loaded as Partial<Record<keyof PluginSettings, unknown>>;

  return {
    viewMode:
      raw.viewMode === "immediate" || raw.viewMode === "on-click"
        ? raw.viewMode
        : DEFAULT_SETTINGS.viewMode,
    defaultHeight: positiveNumber(raw.defaultHeight, DEFAULT_SETTINGS.defaultHeight),
    autoRotate: boolean(raw.autoRotate, DEFAULT_SETTINGS.autoRotate),
    showGrid: boolean(raw.showGrid, DEFAULT_SETTINGS.showGrid),
    // Anders als `defaultHeight`: eine vorhandene Zahl wird geklemmt, nicht verworfen —
    // wer 0 oder 999 eintraegt, meint "so wenig/viel wie moeglich".
    maxContexts: clampContexts(raw.maxContexts),
  };
}
