import { describe, expect, it } from "vitest";
import { NAMED_VIEWS, formatView, parseView } from "../../src/core/view-spec";

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
