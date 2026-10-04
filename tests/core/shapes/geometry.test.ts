import { describe, expect, it } from "vitest";
import { Euler, Quaternion } from "three";
import { buildMesh, eulerXyzToQuaternion } from "../../../src/core/shapes/geometry";
import type { ShapeKind } from "../../../src/core/shapes/types";

const CASES: [ShapeKind, number[], [number, number, number]][] = [
  ["box", [1.2, 0.05, 0.7], [0.6, 0.025, 0.35]],
  ["cylinder", [0.3, 2], [0.3, 1, 0.3]],
  ["cone", [0.5, 1], [0.5, 0.5, 0.5]],
  ["sphere", [0.4], [0.4, 0.4, 0.4]],
];

function vertex(arr: number[], i: number): [number, number, number] {
  return [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
}

describe("buildMesh", () => {
  for (const [kind, size, half] of CASES) {
    it(`${kind}: centred bounds`, () => {
      const m = buildMesh(kind, size);
      for (let a = 0; a < 3; a++) {
        const values = m.positions.filter((_, i) => i % 3 === a);
        expect(Math.max(...values)).toBeCloseTo(half[a], 3);
        expect(Math.min(...values)).toBeCloseTo(-half[a], 3);
      }
    });

    it(`${kind}: unit normals`, () => {
      const m = buildMesh(kind, size);
      for (let i = 0; i < m.normals.length / 3; i++) {
        const [x, y, z] = vertex(m.normals, i);
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      }
    });

    it(`${kind}: every triangle faces outward (counter-clockwise, glTF)`, () => {
      const m = buildMesh(kind, size);
      let checked = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
        const pa = vertex(m.positions, a), pb = vertex(m.positions, b), pc = vertex(m.positions, c);
        const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const area = Math.hypot(cross[0], cross[1], cross[2]);
        const scale = Math.max(...size) ** 2;
        if (area < 1e-9 * scale) continue; // entartete Dreiecke an den Kugelpolen (relativ zur Teilegroesse)
        const na = vertex(m.normals, a), nb = vertex(m.normals, b), nc = vertex(m.normals, c);
        const n = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
        expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2], `${kind} triangle ${t / 3}`).toBeGreaterThan(0);
        // (a) unabhaengig von den Normalen: alle Formen sind um den Ursprung konvex.
        const cen = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
        expect(cross[0] * cen[0] + cross[1] * cen[1] + cross[2] * cen[2], `${kind} triangle ${t / 3} vs centroid`).toBeGreaterThan(0);
        // (b) Normalen zeigen nicht nach innen.
        for (const [i, p] of [[a, pa], [b, pb], [c, pc]] as [number, number[]][]) {
          const nv = vertex(m.normals, i);
          expect(nv[0] * p[0] + nv[1] * p[1] + nv[2] * p[2], `${kind} triangle ${t / 3} vertex normal`).toBeGreaterThan(0);
        }
        checked += 1;
      }
      expect(checked).toBeGreaterThan(10);
    });
  }

  it("uses 24 segments for round shapes", () => {
    // Zylinder: Mantel 2 × 25 Ecken + zwei Deckel je 1 + 25 Ecken.
    expect(buildMesh("cylinder", [1, 1]).positions.length / 3).toBe(2 * 25 + 2 * 26);
    expect(buildMesh("sphere", [1]).positions.length / 3).toBe(25 * 13);
  });
});

describe("eulerXyzToQuaternion", () => {
  it("matches three.js for order XYZ", () => {
    for (const rot of [[0, 45, 0], [30, -60, 90], [180, 0, 0], [12.5, 200, -33]] as [number, number, number][]) {
      const q = new Quaternion().setFromEuler(new Euler((rot[0] * Math.PI) / 180, (rot[1] * Math.PI) / 180, (rot[2] * Math.PI) / 180, "XYZ"));
      const mine = eulerXyzToQuaternion(rot);
      expect(mine[0]).toBeCloseTo(q.x, 6);
      expect(mine[1]).toBeCloseTo(q.y, 6);
      expect(mine[2]).toBeCloseTo(q.z, 6);
      expect(mine[3]).toBeCloseTo(q.w, 6);
    }
  });
});
