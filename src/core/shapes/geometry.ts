// Dreiecksnetze je Form, im Ursprung zentriert. Pure.
// Wickelrichtung gegen den Uhrzeigersinn von außen gesehen (glTF-Vorgabe) — ein Test prüft
// jedes Dreieck, weil eine falsche Richtung im Viewer als "Teil fehlt" erscheint.
import type { ShapeKind, Vec3 } from "./types";

export interface Mesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

const SEGMENTS = 24;
const RINGS = 12;

function box(sx: number, sy: number, sz: number): Mesh {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces: [Vec3, Vec3[]][] = [
    [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  const m: Mesh = { positions: [], normals: [], indices: [] };
  faces.forEach(([n, corners], f) => {
    for (const c of corners) {
      m.positions.push(...c);
      m.normals.push(...n);
    }
    const b = f * 4;
    m.indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return m;
}

/** Deckel: Mitte + Ring. `up` = Normale zeigt nach +Y. */
function cap(m: Mesh, radius: number, y: number, up: boolean): void {
  const centre = m.positions.length / 3;
  const ny = up ? 1 : -1;
  m.positions.push(0, y, 0);
  m.normals.push(0, ny, 0);
  for (let s = 0; s <= SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    m.positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
    m.normals.push(0, ny, 0);
  }
  for (let s = 0; s < SEGMENTS; s++) {
    const r0 = centre + 1 + s, r1 = r0 + 1;
    if (up) m.indices.push(centre, r1, r0);
    else m.indices.push(centre, r0, r1);
  }
}

function cylinder(radius: number, height: number): Mesh {
  const h = height / 2;
  const m: Mesh = { positions: [], normals: [], indices: [] };
  for (let s = 0; s <= SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2, c = Math.cos(a), n = Math.sin(a);
    m.positions.push(c * radius, -h, n * radius, c * radius, h, n * radius);
    m.normals.push(c, 0, n, c, 0, n);
  }
  for (let s = 0; s < SEGMENTS; s++) {
    const b0 = 2 * s, t0 = b0 + 1, b1 = b0 + 2, t1 = b0 + 3;
    m.indices.push(b0, t0, b1, b1, t0, t1);
  }
  cap(m, radius, h, true);
  cap(m, radius, -h, false);
  return m;
}

function cone(radius: number, height: number): Mesh {
  const h = height / 2;
  const slant = Math.hypot(height, radius);
  const m: Mesh = { positions: [], normals: [], indices: [] };
  for (let s = 0; s <= SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2, c = Math.cos(a), n = Math.sin(a);
    const nx = (height * c) / slant, ny = radius / slant, nz = (height * n) / slant;
    m.positions.push(c * radius, -h, n * radius, 0, h, 0);
    m.normals.push(nx, ny, nz, nx, ny, nz);
  }
  for (let s = 0; s < SEGMENTS; s++) {
    const b0 = 2 * s, apex = b0 + 1, b1 = b0 + 2;
    m.indices.push(b0, apex, b1);
  }
  cap(m, radius, -h, false);
  return m;
}

function sphere(radius: number): Mesh {
  const m: Mesh = { positions: [], normals: [], indices: [] };
  for (let i = 0; i <= RINGS; i++) {
    const phi = (i / RINGS) * Math.PI;
    const y = -Math.cos(phi), rho = Math.sin(phi);
    for (let j = 0; j <= SEGMENTS; j++) {
      const a = (j / SEGMENTS) * Math.PI * 2;
      const nx = rho * Math.cos(a), nz = rho * Math.sin(a);
      const len = Math.hypot(nx, y, nz) || 1;
      m.positions.push(nx * radius, y * radius, nz * radius);
      m.normals.push(nx / len, y / len, nz / len);
    }
  }
  const row = SEGMENTS + 1;
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * row + j, b = a + row;
      m.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return m;
}

export function buildMesh(kind: ShapeKind, size: readonly number[]): Mesh {
  switch (kind) {
    case "box":
      return box(size[0], size[1], size[2]);
    case "cylinder":
      return cylinder(size[0], size[1]);
    case "cone":
      return cone(size[0], size[1]);
    case "sphere":
      return sphere(size[0]);
  }
}

/** Euler-Winkel in Grad, Reihenfolge XYZ (three.js-Default) → Quaternion (x, y, z, w). */
export function eulerXyzToQuaternion(rotDeg: Vec3): [number, number, number, number] {
  const [x, y, z] = rotDeg.map((d) => (d * Math.PI) / 360);
  const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z);
  const s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}
