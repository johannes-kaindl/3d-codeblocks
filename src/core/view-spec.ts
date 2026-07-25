// Die gespeicherte Ansicht eines Modells. Pure: kein obsidian-, kein three-Import.
//
// Bewusst orbit-relativ statt in Weltkoordinaten: `distance` ist ein Vielfaches der
// automatischen Einpass-Distanz, deshalb bleibt eine gespeicherte Ansicht sinnvoll,
// wenn dasselbe Modell in anderer Groesse neu generiert wird.

import { directionFromAngles, fitCamera, type CameraFit, type Vec3 } from "./camera-fit";

export interface ViewSpec {
  /** Drehung um die Hochachse, 0..359. 0 = von vorn (+Z), wachsend nach rechts. */
  azimuth: number;
  /** Hoehe in Grad, -89..89. 0 = auf Augenhoehe, 89 = von oben. */
  elevation: number;
  /** Vielfaches der Einpass-Distanz. 1 = wie ohne `view:`. */
  distance: number;
}

/** Bei exakt 90 Grad kippt der Aufwaertsvektor von OrbitControls um. */
export const MAX_ELEVATION = 89;

export const NAMED_VIEWS: Record<string, ViewSpec> = {
  front: { azimuth: 0, elevation: 0, distance: 1 },
  back: { azimuth: 180, elevation: 0, distance: 1 },
  left: { azimuth: 270, elevation: 0, distance: 1 },
  right: { azimuth: 90, elevation: 0, distance: 1 },
  top: { azimuth: 0, elevation: MAX_ELEVATION, distance: 1 },
  bottom: { azimuth: 0, elevation: -MAX_ELEVATION, distance: 1 },
  iso: { azimuth: 45, elevation: 30, distance: 1 },
};

export const VIEW_NAMES = Object.keys(NAMED_VIEWS).join(", ");

/** Toleranz, innerhalb derer `formatView` lieber den Namen als Zahlen schreibt. */
const NAME_ANGLE_TOLERANCE = 2;
const NAME_DISTANCE_TOLERANCE = 0.05;

function wrapAzimuth(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function clampElevation(value: number): number {
  return Math.min(MAX_ELEVATION, Math.max(-MAX_ELEVATION, Math.round(value)));
}

/** `null` = unlesbar; der Aufrufer macht daraus eine Warnung, keinen Fehler. */
export function parseView(text: string): ViewSpec | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "") return null;

  const named = NAMED_VIEWS[trimmed];
  if (named) return { ...named };

  const parts = trimmed.split(",").map((part) => part.trim());
  if (parts.length !== 3) return null;

  const numbers = parts.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) return null;

  const [azimuth, elevation, distance] = numbers;

  const roundedDistance = round2(distance);
  if (roundedDistance <= 0) return null;

  return {
    azimuth: wrapAzimuth(azimuth),
    elevation: clampElevation(elevation),
    distance: roundedDistance,
  };
}

/** Kuerzeste lesbare Schreibweise — Name, wenn er nah genug passt, sonst drei Zahlen. */
export function formatView(spec: ViewSpec): string {
  const azimuth = wrapAzimuth(spec.azimuth);
  const elevation = clampElevation(spec.elevation);
  const distance = round2(spec.distance);

  for (const [name, candidate] of Object.entries(NAMED_VIEWS)) {
    const azimuthOff = Math.abs(angleDelta(azimuth, candidate.azimuth));
    const elevationOff = Math.abs(elevation - candidate.elevation);
    const distanceOff = Math.abs(distance - candidate.distance);
    if (
      azimuthOff <= NAME_ANGLE_TOLERANCE &&
      elevationOff <= NAME_ANGLE_TOLERANCE &&
      distanceOff <= NAME_DISTANCE_TOLERANCE
    ) {
      return name;
    }
  }

  return `${azimuth},${elevation},${distance}`;
}

/** Kuerzester Weg zwischen zwei Winkeln — sonst gaelten 359 und 1 als 358 Grad entfernt. */
function angleDelta(a: number, b: number): number {
  const diff = ((a - b + 540) % 360) - 180;
  return diff;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** ViewSpec → Kameraposition. Ziel und Basisdistanz kommen aus dem Einpassen. */
export function viewToCamera(
  spec: ViewSpec,
  min: Vec3,
  max: Vec3,
  fovDeg: number,
  aspect: number,
): CameraFit {
  const fit = fitCamera(min, max, fovDeg, aspect);
  const distance = fit.distance * spec.distance;
  const dir = directionFromAngles(spec.azimuth, spec.elevation);

  return {
    position: {
      x: fit.target.x + dir.x * distance,
      y: fit.target.y + dir.y * distance,
      z: fit.target.z + dir.z * distance,
    },
    target: fit.target,
    near: Math.max(distance / 1000, 1e-3),
    far: distance + fit.radius * 10,
    distance,
    radius: fit.radius,
  };
}

/** Ist-Kamera → ViewSpec. `baseDistance` ist `fitCamera(...).distance` desselben Modells. */
export function cameraToView(position: Vec3, target: Vec3, baseDistance: number): ViewSpec {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const length = Math.hypot(dx, dy, dz);

  // Kamera exakt auf dem Ziel: keine Richtung ableitbar → Auto-Blick zurueckgeben.
  if (length < 1e-6 || baseDistance <= 0) return { ...NAMED_VIEWS.iso };

  const azimuth = (Math.atan2(dx, dz) * 180) / Math.PI;
  const elevation = (Math.asin(dy / length) * 180) / Math.PI;

  return {
    azimuth: wrapAzimuth(azimuth),
    elevation: clampElevation(elevation),
    distance: Math.max(round2(length / baseDistance), 0.01),
  };
}
