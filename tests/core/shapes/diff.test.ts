import { describe, expect, it } from "vitest";
import { diffParts, formatDiff } from "../../../src/core/shapes/diff";
import type { ShapeDraft } from "../../../src/core/shapes/types";

const P = (over: Partial<ShapeDraft>): ShapeDraft => ({ kind: "box", name: "Platte", size: [1.2, 0.05, 0.7], at: [0, 0.725, 0], rot: [0, 0, 0], color: "#8b5a2b", ...over });

describe("diffParts", () => {
  it("lists changed fields, added and removed parts (after order, then removed)", () => {
    const before = [P({}), P({ name: "Bein-4", size: [0.05, 0.7, 0.05] })];
    const after = [P({ at: [0, 0.925, 0], color: "#000000" }), P({ name: "Lade", size: [0.5, 0.1, 0.5], at: [0, 0.6, 0], color: null })];
    expect(diffParts(before, after).map(formatDiff)).toEqual([
      "Platte: at 0 0.725 0 → 0 0.925 0; color #8b5a2b → #000000",
      "Lade: added (box, size 0.5 0.1 0.5, at 0 0.6 0)",
      "Bein-4: removed",
    ]);
  });
  it("reports a shape change as one changed entry, also on replacement under the same name", () => {
    const d = diffParts([P({})], [P({ kind: "cylinder", size: [0.3, 1] })]);
    expect(d).toHaveLength(1);
    expect(d[0]?.change).toBe("changed");
    expect(d.map(formatDiff)).toEqual(["Platte: shape box → cylinder; size 1.2 0.05 0.7 → 0.3 1"]);
  });
  it("is empty for identical parts and for empty lists", () => {
    expect(diffParts([P({})], [P({})])).toEqual([]);
    expect(diffParts([], [])).toEqual([]);
  });
  it("treats values that print equal as equal (0.10000001 vs 0.1)", () => {
    expect(diffParts([P({ at: [0.1, 0, 0] })], [P({ at: [0.10000001, 0, 0] })])).toEqual([]);
    expect(diffParts([P({ size: [1, 1, 1] })], [P({ size: [1, 1, 1.0004] })]).map(formatDiff)).toEqual(["Platte: size 1 1 1 → 1 1 1.0004"]);
  });
  it("shows only the fields that differ; null colour reads `default`", () => {
    const d = diffParts([P({ color: null })], [P({ color: "#ff0000" })]);
    expect(d.map(formatDiff)).toEqual(["Platte: color default → #ff0000"]);
    expect(diffParts([P({ color: "#ff0000" })], [P({ color: null })]).map(formatDiff)).toEqual(["Platte: color #ff0000 → default"]);
    expect(diffParts([P({})], [P({ rot: [0, 90, 0] })]).map(formatDiff)).toEqual(["Platte: rot 0 0 0 → 0 90 0"]);
  });
  it("ignores pure reordering", () => {
    const a = P({ name: "A" });
    const b = P({ name: "B" });
    expect(diffParts([a, b], [b, a])).toEqual([]);
  });
  it("keeps umlaut names and details of added parts (rot, colour)", () => {
    const d = diffParts([], [P({ name: "Schublade", at: [0, 0, 0], rot: [0, 45, 0], color: "#112233" })]);
    expect(d.map(formatDiff)).toEqual(["Schublade: added (box, size 1.2 0.05 0.7, rot 0 45 0, color #112233)"]);
  });
  it("does not crash on duplicate names (pairs first-with-first, leftovers added/removed)", () => {
    const d = diffParts([P({ at: [1, 1, 1] }), P({ at: [2, 2, 2] })], [P({ at: [1, 1, 1] })]);
    expect(d.map((e) => e.change)).toEqual(["removed"]);
    const same = P({});
    expect(diffParts([same, same], [same]).map((x) => x.change)).toEqual(["removed"]);
    const e = diffParts([P({})], [P({}), P({ at: [9, 9, 9] })]);
    expect(e.map((x) => x.change)).toEqual(["added"]);
  });
  it("prints NaN/Infinity without throwing", () => {
    const d = diffParts([P({ at: [0, 0, 0] })], [P({ at: [NaN, Infinity, -Infinity] })]);
    expect(d.map(formatDiff)).toEqual(["Platte: at 0 0 0 → NaN Infinity -Infinity"]);
  });
  it("handles 5000 parts without quadratic behaviour", () => {
    const before = Array.from({ length: 5000 }, (_, i) => P({ name: `T${i}` }));
    const after = before.map((p, i) => (i % 2 ? p : { ...p, at: [1, 0, 0] as [number, number, number] })).reverse();
    const t = performance.now();
    const d = diffParts(before, after);
    const ms = performance.now() - t;
    expect(d).toHaveLength(2500);
    expect(ms).toBeLessThan(500);
    console.log(`diff 5000 parts: ${ms.toFixed(1)} ms`);
  });
});
