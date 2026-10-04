import { describe, expect, it } from "vitest";
import { fitCamera } from "../../src/core/camera-fit";
import { needsRefit, type RefitState } from "../../src/core/refit-policy";

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
  // Die Rechnung, die danach laeuft: Mitte der Box ist das Ziel (Pane-Zentrum), der Abstand folgt dem Seitenverhaeltnis.
  it("the refit centres the table box and the distance follows the new aspect", () => {
    const min = { x: -0.6, y: 0, z: -0.35 };
    const max = { x: 0.6, y: 0.75, z: 0.35 };
    const narrow = fitCamera(min, max, 50, 600 / 1000);
    const wide = fitCamera(min, max, 50, 1200 / 1000);
    expect(narrow.target).toEqual({ x: 0, y: 0.375, z: 0 });
    expect(wide.target).toEqual(narrow.target);
    expect(wide.distance).toBeLessThan(narrow.distance);
  });
});
