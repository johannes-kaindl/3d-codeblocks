import { describe, expect, it } from "vitest";
import { findFenceAt } from "../../../src/core/shapes/fence";

const NOTE = ["# Möbel", "", "```shapes", "box A size 1", "```", "", "~~~js", "x", "~~~", "````shapes", "```", "box B size 1", "````"].join("\n");

describe("findFenceAt", () => {
  it("finds the block around a body line and on its fence lines", () => {
    for (const line of [2, 3, 4]) {
      expect(findFenceAt(NOTE, line)).toEqual({ lang: "shapes", openLine: 2, closeLine: 4, body: "box A size 1" });
    }
  });
  it("returns null outside any block", () => {
    expect(findFenceAt(NOTE, 0)).toBeNull();
    expect(findFenceAt(NOTE, 5)).toBeNull();
  });
  it("knows tildes and longer fences", () => {
    expect(findFenceAt(NOTE, 7)?.lang).toBe("js");
    expect(findFenceAt(NOTE, 11)).toEqual({ lang: "shapes", openLine: 9, closeLine: 12, body: "```\nbox B size 1" });
  });
  it("treats an unclosed fence as running to the end", () => {
    expect(findFenceAt("```shapes\nbox A size 1", 1)).toEqual({ lang: "shapes", openLine: 0, closeLine: 1, body: "box A size 1" });
  });
  it("does not see fences nested in a callout or list item", () => {
    expect(findFenceAt("> ```shapes\n> box A size 1\n> ```", 1)).toBeNull();
    expect(findFenceAt("- item\n    ```shapes\n    box A size 1\n    ```", 2)).toBeNull();
  });
});
