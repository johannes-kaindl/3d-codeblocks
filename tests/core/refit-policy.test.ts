import { describe, expect, it } from "vitest";
import { fitCamera } from "../../src/core/camera-fit";
import { needsRefit, RefitTracker, type RefitState } from "../../src/core/refit-policy";

const base: RefitState = { userMoved: false, hasBounds: true, lastFit: { width: 600, height: 1000 }, now: { width: 600, height: 1000 } };

describe("needsRefit", () => {
  it("refits an untouched view when the pane size changed (Split -> Model, sidebar on/off)", () => {
    expect(needsRefit({ ...base, now: { width: 1200, height: 1000 } })).toBe(true);
    expect(needsRefit({ ...base, now: { width: 600, height: 700 } })).toBe(true);
  });
  it("does NOT refit while the size is unchanged", () => {
    expect(needsRefit(base)).toBe(false);
  });
  it("keeps a view the user moved, whatever the size does", () => {
    expect(needsRefit({ ...base, userMoved: true, now: { width: 1200, height: 1000 } })).toBe(false);
  });
  it("fits the first time (nothing fitted yet), but never without bounds or on a zero-sized pane", () => {
    expect(needsRefit({ ...base, lastFit: null })).toBe(true);
    expect(needsRefit({ ...base, lastFit: null, hasBounds: false })).toBe(false);
    expect(needsRefit({ ...base, lastFit: null, now: { width: 0, height: 1000 } })).toBe(false);
    expect(needsRefit({ ...base, lastFit: null, now: { width: 600, height: 0 } })).toBe(false);
  });
});

describe("RefitTracker (the state Viewport.resize() consults)", () => {
  const A = { width: 1180, height: 631 };
  const B = { width: 315, height: 631 };
  it("nothing fitted yet: first fit is due, then not again at the same size", () => {
    const t = new RefitTracker();
    expect(t.shouldRefit(A, true)).toBe(true);
    t.noteFit(A);
    expect(t.shouldRefit(A, true)).toBe(false);
  });
  it("an untouched view follows every size change", () => {
    const t = new RefitTracker();
    t.noteFit(A);
    expect(t.shouldRefit(B, true)).toBe(true);
    t.noteFit(B);
    expect(t.shouldRefit(A, true)).toBe(true);
  });
  it("a moved view stays through resizes", () => {
    const t = new RefitTracker();
    t.noteFit(A);
    t.noteUserMove();
    expect(t.userMoved()).toBe(true);
    expect(t.shouldRefit(B, true)).toBe(false);
  });
  it("any explicit fit (Fit button, double click, saved view, file camera) makes the view untouched again", () => {
    const t = new RefitTracker();
    t.noteFit(A);
    t.noteUserMove();
    t.noteFit(A);
    expect(t.userMoved()).toBe(false);
    expect(t.shouldRefit(B, true)).toBe(true);
  });
  it("a new model starts over; no bounds, no refit", () => {
    const t = new RefitTracker();
    t.noteFit(A);
    t.noteUserMove();
    t.reset();
    expect(t.userMoved()).toBe(false);
    expect(t.shouldRefit(A, true)).toBe(true);
    expect(t.shouldRefit(A, false)).toBe(false);
  });
});

// Warum der Refit zaehlt (gerechnet mit der Fit-Formel): Der Tisch ist bei breitem Pane durch die HOEHE begrenzt.
// Wird das Pane schmal (Split, Seitenleisten), begrenzt die BREITE; ohne Refit behielte die Kamera ihren Abstand,
// und das Modell stuende breiter als das Bild. Pinhole-Projektion der acht Boxecken.
describe("why the refit matters: hull of the table box in the image", () => {
  const min = { x: -0.6, y: 0, z: -0.35 };
  const max = { x: 0.6, y: 0.75, z: 0.35 };
  const FOV = 50;
  function hull(position: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, aspect: number) {
    const sub = (a: typeof position, b: typeof position) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
    const dot = (a: typeof position, b: typeof position) => a.x * b.x + a.y * b.y + a.z * b.z;
    const cross = (a: typeof position, b: typeof position) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const norm = (a: typeof position) => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
    const fwd = norm(sub(target, position));
    const right = norm(cross(fwd, { x: 0, y: 1, z: 0 }));
    const up = cross(right, fwd);
    const t = Math.tan((FOV * Math.PI) / 360);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const p = sub({ x, y, z }, position);
      const depth = dot(p, fwd);
      const nx = dot(p, right) / depth / (t * aspect);
      const ny = dot(p, up) / depth / t;
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
    }
    return { width: (x1 - x0) / 2, height: (y1 - y0) / 2, left: x0, right: x1 }; // Anteile der Bildbreite/-hoehe
  }
  const wide = fitCamera(min, max, FOV, 1180 / 631);
  const narrowAspect = 315 / 631;

  it("at the wide pane the table fits with room to spare", () => {
    const h = hull(wide.position, wide.target, 1180 / 631);
    expect(h.width).toBeLessThan(0.9);
    expect(h.height).toBeLessThan(0.9);
  });
  it("narrow pane WITHOUT a refit: the table is wider than the image (clipped at both sides)", () => {
    const h = hull(wide.position, wide.target, narrowAspect);
    expect(h.width).toBeGreaterThan(1);
  });
  it("narrow pane WITH the refit the policy asks for: it fits again, centred", () => {
    const t = new RefitTracker();
    t.noteFit({ width: 1180, height: 631 });
    expect(t.shouldRefit({ width: 315, height: 631 }, true)).toBe(true);
    const fitted = fitCamera(min, max, FOV, narrowAspect);
    const h = hull(fitted.position, fitted.target, narrowAspect);
    expect(h.width).toBeLessThan(1);
    expect(h.left).toBeGreaterThan(-1);
    expect(h.right).toBeLessThan(1);
    // Perspektive verschiebt die Hullmitte leicht; die Toleranz des Smokes ist 10 % der Bildbreite (0,2 in NDC).
    expect(Math.abs((h.left + h.right) / 2)).toBeLessThan(0.1);
  });
});
