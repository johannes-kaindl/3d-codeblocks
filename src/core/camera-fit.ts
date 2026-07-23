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
}

/** Blick leicht von oben-vorn, damit Grundrisse lesbar sind. */
const DIRECTION: Vec3 = { x: 1, y: 0.8, z: 1 };
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
  };
}
