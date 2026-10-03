import { describe, expect, it } from "vitest";
import { formatNumber, formatPartLine, formatShapes, partsFromLlm } from "../../../src/core/shapes/format";
import { parseShapes } from "../../../src/core/shapes/parse";

describe("formatNumber", () => {
  it("is short and stable", () => {
    expect(formatNumber(0.725)).toBe("0.725");
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(1 / 3)).toBe("0.3333");
    expect(formatNumber(-0.00001)).toBe("0");
  });
});

describe("formatPartLine", () => {
  it("leaves out defaults", () => {
    expect(formatPartLine({ kind: "box", name: "A", size: [1, 1, 1], at: [0, 0, 0], rot: [0, 0, 0], color: null })).toBe("box A size 1 1 1");
    expect(formatPartLine({ kind: "cone", name: "B", size: [0.5, 1], at: [0, 1, 0], rot: [0, 45, 0], color: "#ff0000" })).toBe(
      "cone B size 0.5 1 at 0 1 0 rot 0 45 0 color #ff0000",
    );
  });
});

describe("round trip", () => {
  const canonical = ["title: Tisch", "height: 400", "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b", "sphere Knauf size 0.04"].join("\n");

  it("format(parse(x)) === x for canonical text", () => {
    const parsed = parseShapes(canonical);
    expect(formatShapes({ title: parsed.header.title, height: parsed.header.height }, parsed.parts)).toBe(canonical);
  });
});

describe("partsFromLlm", () => {
  it("maps the spike JSON shape and makes names valid and unique", () => {
    const { parts, dropped } = partsFromLlm([
      { name: "Bein vorne links", shape: "box", position: [-0.55, 0.35, 0.3], size: [0.05, 0.7, 0.05], color: "#6b4423" },
      { name: "Bein vorne links", shape: "box", position: [0.55, 0.35, 0.3], size: [0.05, 0.7, 0.05] },
      { shape: "Sphere", size: [0.2], rotation_deg: [0, 90, 0] },
      { name: "size", shape: "cone", size: [0.1, 0.3] },
    ]);
    expect(dropped).toEqual([]);
    expect(parts.map((p) => p.name)).toEqual(["Bein-vorne-links", "Bein-vorne-links-2", "sphere-3", "size-part"]);
    expect(parts[2]).toMatchObject({ kind: "sphere", rot: [0, 90, 0], at: [0, 0, 0], color: null });
    // Was der Formatierer schreibt, muss der Parser fehlerfrei zurücklesen.
    const reparsed = parseShapes(formatShapes({}, parts));
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.parts).toHaveLength(4);
  });

  it("drops what cannot become a part and says why", () => {
    const { parts, dropped } = partsFromLlm([
      { name: "X", shape: "torus", size: [1] },
      { name: "Y", shape: "box", size: [1, 2] },
      { name: "Z", shape: "box" },
      "nonsense",
    ]);
    expect(parts).toEqual([]);
    expect(dropped).toEqual([
      { index: 0, reason: "unknown shape `torus`" },
      { index: 1, reason: "`size` of a box needs 1 or 3 numbers" },
      { index: 2, reason: "`size` is missing" },
      { index: 3, reason: "not an object" },
    ]);
  });

  it("ignores a broken position or colour instead of dropping the part", () => {
    const { parts } = partsFromLlm([{ name: "A", shape: "box", size: [1], position: [1, 2], color: "brown" }]);
    expect(parts[0]).toMatchObject({ at: [0, 0, 0], color: null });
  });
});
