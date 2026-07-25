import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/core/settings-types";

describe("mergeSettings", () => {
  it("returns the defaults for null or undefined", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("has sensible defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      viewMode: "immediate",
      defaultHeight: 400,
      autoRotate: false,
      showGrid: false,
      maxContexts: 6,
      panelPlacement: "auto",
    });
  });

  it("keeps stored values", () => {
    expect(mergeSettings({ defaultHeight: 250 }).defaultHeight).toBe(250);
  });

  it("drops an unknown view mode", () => {
    expect(mergeSettings({ viewMode: "sideways" }).viewMode).toBe("immediate");
  });

  it("drops a non-positive height", () => {
    expect(mergeSettings({ defaultHeight: 0 }).defaultHeight).toBe(400);
    expect(mergeSettings({ defaultHeight: "tall" }).defaultHeight).toBe(400);
  });

  it("allows 0 (off) and clamps the top to 12", () => {
    expect(mergeSettings({ maxContexts: 0 }).maxContexts).toBe(0);
    expect(mergeSettings({ maxContexts: 13 }).maxContexts).toBe(12);
    expect(mergeSettings({ maxContexts: 999 }).maxContexts).toBe(12);
  });

  it("rejects a negative maxContexts back to the default", () => {
    expect(mergeSettings({ maxContexts: -3 }).maxContexts).toBe(6);
  });

  it("ignores unknown keys", () => {
    expect(mergeSettings({ nope: true })).toEqual(DEFAULT_SETTINGS);
  });
});

describe("panelPlacement", () => {
  it("defaults to auto", () => {
    expect(mergeSettings({}).panelPlacement).toBe("auto");
  });

  it("keeps a valid value", () => {
    expect(mergeSettings({ panelPlacement: "toolbar" }).panelPlacement).toBe("toolbar");
  });

  it("falls back to the default for garbage", () => {
    expect(mergeSettings({ panelPlacement: "somewhere" }).panelPlacement).toBe("auto");
    expect(mergeSettings({ panelPlacement: 7 }).panelPlacement).toBe("auto");
  });
});
