// Welche Pillen, was sichtbar? Pure — die View zeichnet nur, was hier entschieden wird.
export type ShapesMode = "model" | "text" | "split";

/** Ab dieser Breite passen Text und Modell nebeneinander (Spec § 5.1). */
export const SPLIT_MIN_WIDTH = 700;
/** Tipp-Pause, nach der das Modell neu gerendert wird (Spec § 5.1). */
export const RERENDER_DELAY_MS = 300;

export function initialMode(width: number): ShapesMode {
  return width >= SPLIT_MIN_WIDTH ? "split" : "model";
}

export function layoutFor(
  mode: ShapesMode,
  width: number,
): { pills: ShapesMode[]; active: ShapesMode; showModel: boolean; showText: boolean } {
  const wide = width >= SPLIT_MIN_WIDTH;
  const pills: ShapesMode[] = wide ? ["model", "text", "split"] : ["model", "text"];
  const active: ShapesMode = !wide && mode === "split" ? "model" : mode;
  return { pills, active, showModel: active !== "text", showText: active !== "model" };
}
