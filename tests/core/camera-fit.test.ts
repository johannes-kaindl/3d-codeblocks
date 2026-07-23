import { describe, expect, it } from "vitest";
import { fitCamera } from "../../src/core/camera-fit";

const v = (x: number, y: number, z: number) => ({ x, y, z });
const dist = (f: ReturnType<typeof fitCamera>) =>
  Math.hypot(f.position.x - f.target.x, f.position.y - f.target.y, f.position.z - f.target.z);

describe("fitCamera", () => {
  it("targets the centre of the box", () => {
    const f = fitCamera(v(0, 0, 0), v(2, 4, 6), 50, 1.5);
    expect(f.target).toEqual(v(1, 2, 3));
  });

  it("places the camera above and in front of the target", () => {
    const f = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 1.5);
    expect(f.position.x).toBeGreaterThan(f.target.x);
    expect(f.position.y).toBeGreaterThan(f.target.y);
    expect(f.position.z).toBeGreaterThan(f.target.z);
  });

  it("moves further away for a bigger box", () => {
    const near = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 1.5);
    const far = fitCamera(v(-10, -10, -10), v(10, 10, 10), 50, 1.5);
    expect(dist(far)).toBeGreaterThan(dist(near) * 5);
  });

  it("handles a flat object (zero height) without collapsing", () => {
    const f = fitCamera(v(0, 0, 0), v(10, 0, 10), 50, 1.5);
    expect(Number.isFinite(f.position.x)).toBe(true);
    expect(Number.isFinite(f.position.y)).toBe(true);
    expect(f.position.y).toBeGreaterThan(f.target.y);
  });

  it("handles a degenerate single point", () => {
    const f = fitCamera(v(3, 3, 3), v(3, 3, 3), 50, 1.5);
    expect(f.target).toEqual(v(3, 3, 3));
    expect(Number.isFinite(f.position.x)).toBe(true);
    expect(f.far).toBeGreaterThan(f.near);
  });

  it("widens the distance for a narrow viewport", () => {
    const wide = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 2.0);
    const narrow = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 0.5);
    expect(dist(narrow)).toBeGreaterThan(dist(wide));
  });

  it("keeps near below far and both positive", () => {
    const f = fitCamera(v(0, 0, 0), v(1, 1, 1), 50, 1);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
  });
});
