import { describe, expect, it } from "vitest";
import { MOUSE, TOUCH } from "three";
import { configurePan, type OrbitLike } from "../../src/viewer/orbit-config";

const bare = (): OrbitLike => ({ enablePan: false, screenSpacePanning: false, keyPanSpeed: 0, mouseButtons: {}, touches: {} });

describe("configurePan", () => {
  it("turns panning on: right-drag pans, left-drag rotates, wheel stays zoom, two fingers dolly+pan", () => {
    const c = bare();
    configurePan(c);
    expect(c.enablePan).toBe(true);
    expect(c.screenSpacePanning).toBe(true);
    expect(c.keyPanSpeed).toBeGreaterThan(0);
    expect(c.mouseButtons).toEqual({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN });
    expect(c.touches).toEqual({ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN });
  });
});
