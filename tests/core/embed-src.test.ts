import { describe, expect, it } from "vitest";
import { embedHeightFromAttrs } from "../../src/core/embed-src";

describe("embedHeightFromAttrs", () => {
  it("returns undefined without any dimension", () => {
    expect(embedHeightFromAttrs(null, null)).toBeUndefined();
    expect(embedHeightFromAttrs("", "")).toBeUndefined();
  });

  it("reads the single |N value (Obsidian puts it in width)", () => {
    expect(embedHeightFromAttrs("250", null)).toBe(250);
  });

  it("prefers an explicit height (|WxH)", () => {
    expect(embedHeightFromAttrs("100", "200")).toBe(200);
  });

  it("ignores non-numeric or non-positive values", () => {
    expect(embedHeightFromAttrs("wide", null)).toBeUndefined();
    expect(embedHeightFromAttrs("0", null)).toBeUndefined();
    expect(embedHeightFromAttrs("-5", null)).toBeUndefined();
  });
});
