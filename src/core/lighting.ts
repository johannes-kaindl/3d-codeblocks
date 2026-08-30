// Beleuchtungs-Entscheidung: zwei Einstellungen + eine Modell-Eigenschaft → Render-Plan.
// Pure (kein three, kein obsidian) — die Anwendung des Plans passiert in `viewer/viewport.ts`.
//
// Die beiden Achsen kreuzen sich bewusst NICHT: `lighting` bestimmt Umgebung und Kurve,
// `modelLights` allein die Fuelllichter. Deshalb genuegen 3 + 4 statt 3 x 2 x 2 Faelle,
// um die Funktion festzunageln — und deshalb loescht `off` die Fuelllichter nicht mit:
// ein Modell mit eigener Beleuchtung waere sonst bei "off" unsichtbar.

/** Wie stark das Plugin die Szene aufbereitet. UI-Namen s. `obsidian/settings.ts`. */
export type LightingMode = "off" | "faithful" | "contrast";

/** Was mit `KHR_lights_punctual`-Lichtern aus der Datei geschieht. */
export type ModelLightsMode = "prefer" | "ignore";

/** Interne Kurvennamen — erscheinen NIE in der UI (Spec E2). */
export type ToneMapping = "none" | "neutral" | "aces";

export interface LightingPlan {
  /** `RoomEnvironment` als `scene.environment` — ohne sie wird Metall schwarz. */
  environment: boolean;
  toneMapping: ToneMapping;
  /** Die plugin-eigenen Hemisphere- und Directional-Lichter. */
  fillLights: boolean;
}

export function decideLighting(
  lighting: LightingMode,
  modelLights: ModelLightsMode,
  modelHasOwnLights: boolean,
): LightingPlan {
  const toneMapping: ToneMapping =
    lighting === "contrast" ? "aces" : lighting === "faithful" ? "neutral" : "none";

  return {
    environment: lighting !== "off",
    toneMapping,
    fillLights: !(modelHasOwnLights && modelLights === "prefer"),
  };
}
