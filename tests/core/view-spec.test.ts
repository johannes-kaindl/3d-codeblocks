import { describe, expect, it } from "vitest";
import { NAMED_VIEWS, cameraToView, formatView, parseView, viewToCamera } from "../../src/core/view-spec";
import { fitCamera } from "../../src/core/camera-fit";

const v = (x: number, y: number, z: number) => ({ x, y, z });
const MIN = v(-1, -1, -1);
const MAX = v(1, 1, 1);
const len = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("parseView", () => {
  it("reads a named view", () => {
    expect(parseView("iso")).toEqual({ azimuth: 45, elevation: 30, distance: 1 });
  });

  it("ignores case and surrounding space", () => {
    expect(parseView("  TOP ")).toEqual(NAMED_VIEWS.top);
  });

  it("reads three numbers", () => {
    expect(parseView("45,30,1.2")).toEqual({ azimuth: 45, elevation: 30, distance: 1.2 });
  });

  it("tolerates spaces between the numbers", () => {
    expect(parseView("45, 30, 1.2")).toEqual({ azimuth: 45, elevation: 30, distance: 1.2 });
  });

  it("wraps the azimuth into 0..359", () => {
    expect(parseView("370,0,1")?.azimuth).toBe(10);
    expect(parseView("-90,0,1")?.azimuth).toBe(270);
  });

  it("clamps the elevation to the gimbal limit", () => {
    expect(parseView("0,90,1")?.elevation).toBe(89);
    expect(parseView("0,-120,1")?.elevation).toBe(-89);
  });

  it("rejects a non-positive distance", () => {
    expect(parseView("0,0,0")).toBeNull();
    expect(parseView("0,0,-2")).toBeNull();
  });

  it("rejects distance that rounds to zero", () => {
    expect(parseView("0,0,0.001")).toBeNull();
  });

  it("rejects unknown names and malformed input", () => {
    expect(parseView("schräg-von-oben")).toBeNull();
    expect(parseView("45,30")).toBeNull();
    expect(parseView("45,30,1,2")).toBeNull();
    expect(parseView("")).toBeNull();
  });
});

describe("formatView", () => {
  it("writes the name when the view is close enough", () => {
    expect(formatView({ azimuth: 44, elevation: 31, distance: 1.03 })).toBe("iso");
  });

  it("writes numbers when no name is close enough", () => {
    expect(formatView({ azimuth: 20, elevation: 10, distance: 1 })).toBe("20,10,1");
  });

  // Von Hand trifft niemand einen Standardwinkel auf 2 Grad genau (Smoke #4, Schritt 3:
  // "von oben" schauen ergab 71 statt 89 Grad). 5 Grad Toleranz macht den Namen im
  // Alltag erreichbar; der Sprung beim Wiederherstellen bleibt dabei unsichtbar klein.
  it("writes the name when the view is a few degrees off in both angles", () => {
    expect(formatView({ azimuth: 41, elevation: 34, distance: 1 })).toBe("iso");
  });

  // Die Gegenprobe zur Entscheidung, die Toleranz NICHT weiter aufzuziehen: der reale
  // Wert aus Smoke #4 liegt 18 Grad neben `top` und muss Zahlen bleiben. Als `top`
  // geschrieben wuerde die Kamera beim Wiederherstellen sichtbar von 71 auf 89 springen
  // — genau das, was `view:` verspricht nicht zu tun.
  it("keeps numbers for a hand-turned near-top view that is far off the named angle", () => {
    expect(formatView({ azimuth: 358, elevation: 71, distance: 1 })).toBe("358,71,1");
  });

  it("does not use a name when the distance differs too much", () => {
    expect(formatView({ azimuth: 45, elevation: 30, distance: 2 })).toBe("45,30,2");
  });

  it("rounds angles to whole degrees and distance to two decimals", () => {
    expect(formatView({ azimuth: 20.4, elevation: 9.6, distance: 1.234 })).toBe("20,10,1.23");
  });

  it("round-trips through parseView", () => {
    const spec = { azimuth: 123, elevation: -45, distance: 0.75 };
    expect(parseView(formatView(spec))).toEqual(spec);
  });
});

describe("viewToCamera", () => {
  it("puts the camera in front of the model for `front`", () => {
    const cam = viewToCamera(NAMED_VIEWS.front, MIN, MAX, 50, 1.5);
    expect(cam.position.z).toBeGreaterThan(cam.target.z);
    expect(cam.position.x).toBeCloseTo(cam.target.x, 6);
    expect(cam.position.y).toBeCloseTo(cam.target.y, 6);
  });

  it("puts the camera to the right for `right`", () => {
    const cam = viewToCamera(NAMED_VIEWS.right, MIN, MAX, 50, 1.5);
    expect(cam.position.x).toBeGreaterThan(cam.target.x);
    expect(cam.position.z).toBeCloseTo(cam.target.z, 6);
  });

  it("puts the camera to the left for `left`", () => {
    const cam = viewToCamera(NAMED_VIEWS.left, MIN, MAX, 50, 1.5);
    expect(cam.position.x).toBeLessThan(cam.target.x);
  });

  it("puts the camera above for `top`", () => {
    const cam = viewToCamera(NAMED_VIEWS.top, MIN, MAX, 50, 1.5);
    expect(cam.position.y).toBeGreaterThan(cam.target.y);
    expect(len(cam.position, cam.target)).toBeGreaterThan(0);
  });

  it("scales the distance by the factor", () => {
    const base = viewToCamera(NAMED_VIEWS.iso, MIN, MAX, 50, 1.5);
    const far = viewToCamera({ ...NAMED_VIEWS.iso, distance: 2 }, MIN, MAX, 50, 1.5);
    expect(len(far.position, far.target)).toBeCloseTo(len(base.position, base.target) * 2, 6);
  });

  it("keeps near/far usable at an extreme distance factor", () => {
    const cam = viewToCamera({ ...NAMED_VIEWS.iso, distance: 10 }, MIN, MAX, 50, 1.5);
    expect(cam.near).toBeGreaterThan(0);
    expect(cam.far).toBeGreaterThan(len(cam.position, cam.target));
  });

  it("matches the automatic fit for `iso` — one truth for the default look", () => {
    const auto = fitCamera(MIN, MAX, 50, 1.5);
    const iso = viewToCamera(NAMED_VIEWS.iso, MIN, MAX, 50, 1.5);
    expect(iso.position.x).toBeCloseTo(auto.position.x, 6);
    expect(iso.position.y).toBeCloseTo(auto.position.y, 6);
    expect(iso.position.z).toBeCloseTo(auto.position.z, 6);
  });
});

describe("cameraToView", () => {
  it("round-trips every named view", () => {
    for (const [name, spec] of Object.entries(NAMED_VIEWS)) {
      const cam = viewToCamera(spec, MIN, MAX, 50, 1.5);
      const base = fitCamera(MIN, MAX, 50, 1.5).distance;
      expect(formatView(cameraToView(cam.position, cam.target, base)), name).toBe(name);
    }
  });

  it("reports a distance factor above 1 when the camera is further out", () => {
    const base = fitCamera(MIN, MAX, 50, 1.5).distance;
    const cam = viewToCamera({ ...NAMED_VIEWS.front, distance: 2 }, MIN, MAX, 50, 1.5);
    expect(cameraToView(cam.position, cam.target, base).distance).toBeCloseTo(2, 2);
  });

  it("survives a camera sitting exactly on the target", () => {
    const spec = cameraToView(v(0, 0, 0), v(0, 0, 0), 5);
    expect(Number.isFinite(spec.azimuth)).toBe(true);
    expect(Number.isFinite(spec.elevation)).toBe(true);
    expect(spec.distance).toBeGreaterThan(0);
  });
});
