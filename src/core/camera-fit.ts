// Bounding-Box → Kameraposition/-ziel. Pure, ohne three-Typen.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraFit {
  position: Vec3;
  target: Vec3;
  near: number;
  far: number;
  /** Abstand Kamera→Ziel dieses Einpassens — Bezugsgroesse fuer `ViewSpec.distance`. */
  distance: number;
  /** Halbe Raumdiagonale der Bounding-Box. */
  radius: number;
}

/**
 * Einheitsvektor aus Azimut/Hoehe (Grad, Y-up).
 * Azimut 0 = +Z (von vorn), 90 = +X (von rechts); Hoehe 90 = +Y (von oben).
 */
export function directionFromAngles(azimuthDeg: number, elevationDeg: number): Vec3 {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const elevation = (elevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return {
    x: horizontal * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: horizontal * Math.cos(azimuth),
  };
}

/**
 * Blick leicht von oben-vorn, damit Grundrisse lesbar sind — identisch mit
 * `NAMED_VIEWS.iso` in `view-spec.ts`. Die Gleichheit sichert ein Test ab
 * ("matches the automatic fit for `iso`"); die Zahlen stehen hier erneut, weil
 * ein Import aus `view-spec.ts` einen Zirkel erzeugen wuerde.
 */
const ISO_AZIMUTH = 45;
const ISO_ELEVATION = 30;
const DIRECTION: Vec3 = directionFromAngles(ISO_AZIMUTH, ISO_ELEVATION);
const MARGIN = 1.2;
/** Untergrenze je Achse — verhindert Division durch null bei flacher/leerer Box. */
const MIN_EXTENT = 1e-3;

export function fitCamera(min: Vec3, max: Vec3, fovDeg: number, aspect: number): CameraFit {
  const target: Vec3 = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };

  const ex = Math.max(max.x - min.x, MIN_EXTENT);
  const ey = Math.max(max.y - min.y, MIN_EXTENT);
  const ez = Math.max(max.z - min.z, MIN_EXTENT);
  const radius = Math.hypot(ex, ey, ez) / 2;

  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, MIN_EXTENT));
  // Der engere der beiden Halbwinkel bestimmt, wie weit die Kamera zurueck muss —
  // bei schmalem Viewport (aspect < 1) ist das der horizontale.
  const limiting = Math.min(vHalf, hHalf);
  const distance = (radius / Math.sin(limiting)) * MARGIN;

  const dirLength = Math.hypot(DIRECTION.x, DIRECTION.y, DIRECTION.z);
  const position: Vec3 = {
    x: target.x + (DIRECTION.x / dirLength) * distance,
    y: target.y + (DIRECTION.y / dirLength) * distance,
    z: target.z + (DIRECTION.z / dirLength) * distance,
  };

  return {
    position,
    target,
    near: Math.max(distance / 1000, MIN_EXTENT),
    far: distance + radius * 10,
    distance,
    radius,
  };
}
