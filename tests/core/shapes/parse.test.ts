import { describe, expect, it } from "vitest";
import { normalizeColor, normalizeSize, parseShapes } from "../../../src/core/shapes/parse";

const TABLE = [
  "title: Tisch",
  "height: 400",
  "# Platte und Beine",
  "box Tischplatte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b",
  "cylinder Bein-1 size 0.03 0.7 at -0.55 0.35 -0.3",
  "sphere Knauf size 0.04 at 0.5 0.6 0.36 color #CCC",
].join("\n");

describe("parseShapes", () => {
  it("reads header and parts", () => {
    const r = parseShapes(TABLE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.header).toEqual({ title: "Tisch", height: 400 });
    expect(r.parts).toEqual([
      { kind: "box", name: "Tischplatte", size: [1.2, 0.05, 0.7], at: [0, 0.725, 0], rot: [0, 0, 0], color: "#8b5a2b", line: 4 },
      { kind: "cylinder", name: "Bein-1", size: [0.03, 0.7], at: [-0.55, 0.35, -0.3], rot: [0, 0, 0], color: null, line: 5 },
      { kind: "sphere", name: "Knauf", size: [0.04], at: [0.5, 0.6, 0.36], rot: [0, 0, 0], color: "#cccccc", line: 6 },
    ]);
  });

  it("accepts keywords in any order and defaults at/rot", () => {
    const r = parseShapes("cone Spitze color #ff0000 rot 0 45 0 size 0.5 1");
    expect(r.parts[0]).toMatchObject({ kind: "cone", size: [0.5, 1], at: [0, 0, 0], rot: [0, 45, 0], color: "#ff0000" });
  });

  it("expands a one-number box to a cube", () => {
    expect(parseShapes("box W size 2").parts[0].size).toEqual([2, 2, 2]);
  });

  it("drops only the broken line and names it", () => {
    const r = parseShapes(["box A size 1", "box B size 1 2", "box C size 1"].join("\n"));
    expect(r.parts.map((p) => p.name)).toEqual(["A", "C"]);
    expect(r.errors).toEqual([{ line: 2, message: "`size` of a box needs 1 or 3 numbers" }]);
  });

  it("treats CRLF exactly like LF", () => {
    expect(parseShapes(TABLE.replace(/\n/g, "\r\n"))).toEqual(parseShapes(TABLE));
  });

  it("rejects a duplicate name on the second line", () => {
    const r = parseShapes("box A size 1\nsphere A size 1");
    expect(r.parts).toHaveLength(1);
    expect(r.errors).toEqual([{ line: 2, message: "Duplicate name `A`" }]);
  });

  it("warns about unknown words but keeps the part", () => {
    const r = parseShapes("box A size 1 shiny at 0 1 0");
    expect(r.parts[0].at).toEqual([0, 1, 0]);
    expect(r.warnings).toEqual([{ line: 1, message: "Unknown word `shiny` ignored" }]);
  });

  it("explains each kind of broken line", () => {
    const cases: [string, string][] = [
      ["boxx A size 1", "Unknown shape `boxx` — use box, cylinder, sphere or cone"],
      ["box", "Every part needs a name after the shape (letters, digits, `-`, `_`)"],
      ["box size 1", "Every part needs a name after the shape (letters, digits, `-`, `_`)"],
      ["box A at 0 0 0", "`size` is missing"],
      ["box A size 1 at 0 0", "`at` needs 3 numbers"],
      ["box A size 1 rot 1", "`rot` needs 3 numbers"],
      ["box A size 1 color red", "`color` needs a hex colour like #8b5a2b"],
      ["box A size 0", "`size` values must be greater than 0"],
      ["sphere A size 1 2", "`size` of a sphere needs 1 number (radius)"],
      ["cylinder A size 1", "`size` of a cylinder needs 2 numbers (radius, height)"],
      ["box A size 1 size 2", "`size` given twice"],
    ];
    for (const [line, message] of cases) {
      expect(parseShapes(line).errors, line).toEqual([{ line: 1, message }]);
    }
  });

  it("handles header problems", () => {
    expect(parseShapes("file: x.glb\nbox A size 1").errors).toEqual([
      { line: 1, message: "`file:` belongs in a `3d` block — a shapes block holds the parts itself" },
    ]);
    expect(parseShapes("colour: red\nbox A size 1").warnings).toEqual([{ line: 1, message: "Unknown key: `colour`" }]);
    expect(parseShapes("height: tall\nbox A size 1").warnings).toEqual([{ line: 1, message: "`height` must be a number: `tall`" }]);
    expect(parseShapes("box A size 1\ntitle: late").errors).toEqual([
      { line: 2, message: "Header lines (`key: value`) must come before the first part" },
    ]);
  });

  it("reads view like the 3d block", () => {
    expect(parseShapes("view: front\nbox A size 1").header.view).toBeDefined();
    expect(parseShapes("view: nowhere\nbox A size 1").warnings[0].message).toMatch(/^`view`: unknown view `nowhere`/);
  });

  it("skips comments and blank lines and keeps line numbers true", () => {
    const r = parseShapes("\n# c\n\nbox A size 1");
    expect(r.parts[0].line).toBe(4);
  });

  it("allows umlauts in names", () => {
    expect(parseShapes("box Tür size 1").parts[0].name).toBe("Tür");
  });
});

describe("normalizeSize / normalizeColor", () => {
  it("normalizes", () => {
    expect(normalizeSize("box", [1])).toEqual([1, 1, 1]);
    expect(normalizeSize("cone", [1, 2])).toEqual([1, 2]);
    expect(normalizeSize("sphere", [-1])).toBe("`size` values must be greater than 0");
    expect(normalizeColor("#ABC")).toBe("#aabbcc");
    expect(normalizeColor("abc")).toBeNull();
  });
});
