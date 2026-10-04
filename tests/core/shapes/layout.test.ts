import { describe, expect, it } from "vitest";
import { initialMode, layoutFor } from "../../../src/core/shapes/layout";

describe("initialMode", () => {
  it("starts split when there is room, model otherwise", () => {
    expect(initialMode(700)).toBe("split");
    expect(initialMode(699)).toBe("model");
    expect(initialMode(0)).toBe("model");
  });

  // Boundary tests
  it("handles boundary width 701", () => {
    expect(initialMode(701)).toBe("split");
  });

  it("handles negative width as model", () => {
    expect(initialMode(-1)).toBe("model");
  });

  it("handles NaN width as model", () => {
    expect(initialMode(NaN)).toBe("model");
  });
});

describe("layoutFor", () => {
  it("offers three pills when wide", () => {
    expect(layoutFor("split", 900)).toEqual({ pills: ["model", "text", "split"], active: "split", showModel: true, showText: true });
    expect(layoutFor("text", 900)).toEqual({ pills: ["model", "text", "split"], active: "text", showModel: false, showText: true });
  });
  it("drops split when narrow and falls back to the model", () => {
    expect(layoutFor("split", 400)).toEqual({ pills: ["model", "text"], active: "model", showModel: true, showText: false });
    expect(layoutFor("text", 400)).toEqual({ pills: ["model", "text"], active: "text", showModel: false, showText: true });
  });

  // Boundary tests for layoutFor
  it("handles boundary width 700 (split should be available)", () => {
    expect(layoutFor("split", 700)).toEqual({ pills: ["model", "text", "split"], active: "split", showModel: true, showText: true });
    expect(layoutFor("model", 700)).toEqual({ pills: ["model", "text", "split"], active: "model", showModel: true, showText: false });
  });

  it("handles boundary width 699 (split should not be available)", () => {
    expect(layoutFor("split", 699)).toEqual({ pills: ["model", "text"], active: "model", showModel: true, showText: false });
    expect(layoutFor("text", 699)).toEqual({ pills: ["model", "text"], active: "text", showModel: false, showText: true });
  });

  it("handles boundary width 701 (split should be available)", () => {
    expect(layoutFor("split", 701)).toEqual({ pills: ["model", "text", "split"], active: "split", showModel: true, showText: true });
  });

  it("handles width 0 (narrow)", () => {
    expect(layoutFor("split", 0)).toEqual({ pills: ["model", "text"], active: "model", showModel: true, showText: false });
    expect(layoutFor("model", 0)).toEqual({ pills: ["model", "text"], active: "model", showModel: true, showText: false });
  });

  it("handles negative width as narrow", () => {
    expect(layoutFor("split", -100)).toEqual({ pills: ["model", "text"], active: "model", showModel: true, showText: false });
  });

  it("handles NaN width as narrow", () => {
    expect(layoutFor("split", NaN)).toEqual({ pills: ["model", "text"], active: "model", showModel: true, showText: false });
  });
});
