import { describe, expect, it } from "vitest";
import { fenceFor, findFenceAt, listFences } from "../../../src/core/shapes/fence";

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
  it("does not open a backtick fence from a prose line whose info string holds a backtick", () => {
    expect(listFences("```shapes``` text\nbox A size 1")).toEqual([]);
    expect(findFenceAt("```shapes``` text\nbox A size 1", 1)).toBeNull();
    expect(listFences("~~~shapes ~ ok\nx\n~~~")).toHaveLength(1);
  });
  it("does not see fences nested in a callout or list item", () => {
    expect(findFenceAt("> ```shapes\n> box A size 1\n> ```", 1)).toBeNull();
    expect(findFenceAt("- item\n    ```shapes\n    box A size 1\n    ```", 2)).toBeNull();
  });
});

describe("listFences / fenceFor", () => {
  it("lists every fence in order", () => {
    expect(listFences("a\n```3d\nfile: x\n```\n~~~\ny\n~~~").map((f) => [f.lang, f.openLine, f.closeLine])).toEqual([
      ["3d", 1, 3],
      ["", 4, 6],
    ]);
  });
  it("does not list fences nested in callouts or deep indents", () => {
    expect(listFences("> ```shapes\n> a\n> ```\n- i\n    ```x\n    a\n    ```")).toEqual([]);
  });
  it("builds a fence longer than any backtick run inside", () => {
    expect(fenceFor("box A size 1")).toBe("```");
    expect(fenceFor("# ``` im Kommentar\nbox A size 1")).toBe("````");
    expect(fenceFor("x\n`````")).toBe("``````");
  });
});
