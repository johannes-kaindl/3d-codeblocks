import { describe, expect, it } from "vitest";
import { applyChanges, applyChangesAnswer, findPartName } from "../../../src/core/shapes/changes";
import { readChangesAnswer } from "../../../src/core/shapes/protocol";

const TABLE = [
  "title: Tisch",
  "# Platte",
  "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b",
  "box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3",
  "box Bein-2   size 0.05 0.7 0.05 at 0.55 0.35 -0.3",
  "",
].join("\n");

const text = (r: ReturnType<typeof applyChanges>): string => {
  if (!r.ok) throw new Error(`not ok: ${r.problems.join("; ")}`);
  return r.text;
};

describe("applyChanges", () => {
  it("rewrites only the changed line; everything else stays byte-identical", () => {
    const out = text(applyChanges(TABLE, [{ op: "change", name: "Platte", at: [0, 0.925, 0] }]));
    expect(out).toBe(TABLE.replace("at 0 0.725 0", "at 0 0.925 0"));
  });

  it("a colour-only change rewrites only that line (odd spacing elsewhere survives)", () => {
    const out = text(applyChanges(TABLE, [{ op: "change", name: "Bein-1", color: "#FFF" }]));
    expect(out).toBe(TABLE.replace("box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3", "box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3 color #ffffff"));
    expect(out).toContain("box Bein-2   size");
  });

  it("fills missing fields from the existing part", () => {
    const out = text(applyChanges(TABLE, [{ op: "change", name: "Platte", size: [2.4, 0.05, 0.7] }]));
    expect(out).toBe(TABLE.replace("size 1.2 0.05 0.7", "size 2.4 0.05 0.7"));
  });

  it("adds after the last part and removes lines without leaving blanks", () => {
    const out = text(
      applyChanges(TABLE, [
        { op: "remove", name: "Bein-2" },
        { op: "add", part: { op: "add", name: "Lade", shape: "box", position: [0, 0.6, 0.2], size: [0.5, 0.1, 0.5] } },
      ]),
    );
    expect(out).toBe(
      ["title: Tisch", "# Platte", "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b", "box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3", "box Lade size 0.5 0.1 0.5 at 0 0.6 0.2", ""].join("\n"),
    );
  });

  it("Focus 2: remove then add under the same name works; the new part goes to the end", () => {
    const r = applyChanges(TABLE, [
      { op: "remove", name: "Bein-1" },
      { op: "add", part: { op: "add", name: "Bein-1", shape: "cylinder", position: [-0.55, 0.35, -0.3], size: [0.03, 0.7] } },
    ]);
    expect(text(r)).toBe(
      [
        "title: Tisch",
        "# Platte",
        "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b",
        "box Bein-2   size 0.05 0.7 0.05 at 0.55 0.35 -0.3",
        "cylinder Bein-1 size 0.03 0.7 at -0.55 0.35 -0.3",
        "",
      ].join("\n"),
    );
    expect(r.ok && r.after.map((p) => p.name)).toEqual(["Platte", "Bein-2", "Bein-1"]);
    expect(r.ok && r.after.find((p) => p.name === "Bein-1")?.kind).toBe("cylinder");
  });

  it("Focus 4: two changes to the same part see each other's results", () => {
    const out = text(
      applyChanges(TABLE, [
        { op: "change", name: "Platte", at: [0, 0.8, 0] },
        { op: "change", name: "Platte", color: "#000000" },
      ]),
    );
    expect(out).toBe(TABLE.replace("at 0 0.725 0 color #8b5a2b", "at 0 0.8 0 color #000000"));
    // später ändert, was ein früherer Schritt gesetzt hat
    const out2 = text(
      applyChanges(TABLE, [
        { op: "change", name: "Platte", at: [0, 0.8, 0] },
        { op: "change", name: "platte", at: [1, 1, 1] },
      ]),
    );
    expect(out2).toBe(TABLE.replace("at 0 0.725 0", "at 1 1 1"));
  });

  it("an add may not reuse an existing name (also folded); remove first is fine", () => {
    for (const name of ["Platte", "platte", "Bein_1"]) {
      const r = applyChanges(TABLE, [{ op: "add", part: { name, shape: "box", size: [1] } }]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems[0]).toMatch(/already exists/);
    }
  });

  it("an add whose part is invalid fails the whole list and names the item", () => {
    const r = applyChanges(TABLE, [
      { op: "remove", name: "Bein-2" },
      { op: "add", part: { op: "add", name: "X", shape: "torus", size: [1] } },
    ]);
    expect(r).toEqual({ ok: false, problems: ["change 2 (add): unknown shape `torus`"] });
  });

  it("adds clean the name like create does (no duplicated logic)", () => {
    const r = applyChanges(TABLE, [{ op: "add", part: { name: "Bein vorne links!", shape: "sphere", size: [0.1] } }]);
    expect(r.ok && r.after.at(-1)?.name).toBe("Bein-vorne-links");
  });

  it("Focus 1: findPartName ignores case and separators, refuses ambiguity", () => {
    expect(findPartName(["Bein-1", "Platte"], "platte")).toBe("Platte");
    expect(findPartName(["Tischplatte"], "tischplatte")).toBe("Tischplatte");
    expect(findPartName(["Bein-vorne-links"], "bein vorne links")).toBe("Bein-vorne-links");
    expect(findPartName(["Bein-1", "Platte"], "Bein_1")).toBe("Bein-1");
    expect(findPartName(["Bein-1", "Bein_1"], "bein 1")).toBe("ambiguous");
    expect(findPartName(["Bein-1", "Bein_1"], "Bein-1")).toBe("Bein-1");
    expect(findPartName(["Platte"], "Stuhl")).toBeNull();
    expect(findPartName(["Platte"], "-_ ")).toBeNull();
    expect(findPartName(["ambiguous"], "ambiguous")).toBe("ambiguous");
    expect(findPartName(["Ärger"], "Ärger")).toBe("Ärger"); // NFC vs NFD
  });

  it("Focus 1: a case-insensitive name edits the right line in the text", () => {
    const out = text(applyChanges(TABLE, [{ op: "change", name: "bein 1", color: "#ff0000" }]));
    expect(out.split("\n")[3]).toBe("box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3 color #ff0000");
    expect(out.split("\n")[4]).toBe("box Bein-2   size 0.05 0.7 0.05 at 0.55 0.35 -0.3");
  });

  it("an ambiguous name rejects the whole list and names both candidates; nothing changes", () => {
    const amb = "box Bein-1 size 1\nbox Bein_1 size 1\n";
    const r = applyChanges(amb, [{ op: "change", name: "bein 1", color: "#000" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems[0]).toContain("Bein-1");
      expect(r.problems[0]).toContain("Bein_1");
    }
  });

  it("refuses the whole list when one change cannot apply, naming wanted and available names", () => {
    const r = applyChanges(TABLE, [{ op: "change", name: "Platte", at: [0, 1, 0] }, { op: "remove", name: "Stuhl" }]);
    expect(r).toEqual({ ok: false, problems: ["change 2: no part named `Stuhl` (available: Platte, Bein-1, Bein-2)"] });
  });

  it("rejects wrong arity, non-finite and kind-mismatched values", () => {
    const p = (c: Parameters<typeof applyChanges>[1]): string[] => {
      const r = applyChanges(TABLE + "sphere Ball size 0.1\n", c);
      return r.ok ? [] : r.problems;
    };
    expect(p([{ op: "change", name: "Platte", size: [1, 2] }])).toEqual(["change 1: `Platte`: `size` of a box needs 1 or 3 numbers"]);
    expect(p([{ op: "change", name: "Ball", size: [1, 2, 3] }])).toEqual(["change 1: `Ball`: `size` of a sphere needs 1 number (radius)"]);
    expect(p([{ op: "change", name: "Platte", at: [1, 2] }])).toEqual(["change 1: `Platte`: `at` needs 3 numbers"]);
    expect(p([{ op: "change", name: "Platte", rot: [1, NaN, 2] }])).toEqual(["change 1: `Platte`: `rot` needs 3 numbers"]);
    expect(p([{ op: "change", name: "Platte", size: [1, Infinity, 1] }])).toHaveLength(1);
    expect(p([{ op: "change", name: "Platte", size: [0, 1, 1] }])).toEqual(["change 1: `Platte`: `size` values must be greater than 0"]);
    expect(p([{ op: "change", name: "Platte", size: [0.00001, 1, 1] }])).toHaveLength(1);
    expect(p([{ op: "change", name: "Platte", color: "red" }])).toHaveLength(1);
  });

  it("Focus 3: CRLF stays byte-identical, new lines get CRLF, final newline kept", () => {
    const crlf = TABLE.replace(/\n/g, "\r\n");
    const out = text(applyChanges(crlf, [{ op: "add", part: { name: "K", shape: "sphere", size: [0.1] } }, { op: "change", name: "Bein-1", color: "#000" }]));
    expect(out).toBe(
      crlf.replace("at -0.55 0.35 -0.3\r\n", "at -0.55 0.35 -0.3 color #000000\r\n").replace("at 0.55 0.35 -0.3\r\n", "at 0.55 0.35 -0.3\r\nsphere K size 0.1\r\n"),
    );
    expect(out.endsWith("\r\n")).toBe(true);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("Focus 3: remove in CRLF text leaves no stray line breaks", () => {
    const crlf = TABLE.replace(/\n/g, "\r\n");
    expect(text(applyChanges(crlf, [{ op: "remove", name: "Bein-1" }]))).toBe(crlf.replace("box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3\r\n", ""));
  });

  it("keeps a missing final newline missing (add after the last line, and remove of the last line)", () => {
    const noNl = TABLE.trimEnd();
    expect(text(applyChanges(noNl, [{ op: "add", part: { name: "K", shape: "sphere", size: [0.1] } }]))).toBe(noNl + "\nsphere K size 0.1");
    expect(text(applyChanges(noNl, [{ op: "remove", name: "Bein-2" }]))).toBe(noNl.replace("\nbox Bein-2   size 0.05 0.7 0.05 at 0.55 0.35 -0.3", ""));
  });

  it("adds to a text without parts: after the header, before the final newline", () => {
    expect(text(applyChanges("title: Leer\n", [{ op: "add", part: { name: "K", shape: "sphere", size: [0.1] } }]))).toBe("title: Leer\nsphere K size 0.1\n");
    expect(text(applyChanges("", [{ op: "add", part: { name: "K", shape: "sphere", size: [0.1] } }]))).toBe("sphere K size 0.1");
  });

  it("refuses to rewrite a line with unrecognised words, but leaves such a line alone otherwise", () => {
    const odd = "box A size 1 hello at 1 1 1\nbox B size 2\n";
    const r = applyChanges(odd, [{ op: "change", name: "A", color: "#000" }]);
    expect(r).toEqual({ ok: false, problems: ["line 1 has unrecognised words — fix it by hand first"] });
    expect(text(applyChanges(odd, [{ op: "change", name: "B", color: "#000" }]))).toBe("box A size 1 hello at 1 1 1\nbox B size 2 2 2 color #000000\n");
    expect(text(applyChanges(odd, [{ op: "remove", name: "A" }]))).toBe("box B size 2\n");
  });

  it("keeps indentation of a rewritten line", () => {
    expect(text(applyChanges("  box A size 1\n", [{ op: "change", name: "A", color: "#000" }]))).toBe("  box A size 1 1 1 color #000000\n");
  });

  it("before/after come from the parsed text, not from the model", () => {
    const r = applyChanges(TABLE, [{ op: "remove", name: "Bein-2" }]);
    expect(r.ok && [r.before.length, r.after.length]).toEqual([3, 2]);
    expect(r.ok && r.before[2]).toEqual({ kind: "box", name: "Bein-2", size: [0.05, 0.7, 0.05], at: [0.55, 0.35, -0.3], rot: [0, 0, 0], color: null });
  });
});

describe("applyChangesAnswer (all or nothing)", () => {
  it("passes a clean answer through", () => {
    const a = readChangesAnswer('{"changes":[{"op":"change","name":"platte","position":[0,1,0]}]}');
    expect(text(applyChangesAnswer(TABLE, a))).toBe(TABLE.replace("at 0 0.725 0", "at 0 1 0"));
  });

  it("applies nothing when the reader dropped an item, and says why", () => {
    const a = readChangesAnswer('{"changes":[{"op":"change","name":"Platte","position":[0,1,0]},{"op":"explode","name":"Bein-1"}]}');
    expect(a.ok && a.changes).toHaveLength(1);
    const r = applyChangesAnswer(TABLE, a);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0]).toContain("item 2");
      expect(r.problems[0]).toContain("unknown op `explode`");
    }
  });

  it("reports the reader's reason when the answer is unreadable", () => {
    expect(applyChangesAnswer(TABLE, readChangesAnswer("keine Ahnung"))).toEqual({ ok: false, problems: ["no JSON in the answer"] });
  });

  it("an add item with its op key is accepted end to end", () => {
    const a = readChangesAnswer('{"changes":[{"op":"add","name":"Lade","shape":"box","position":[0,0.6,0.2],"size":[0.5,0.1,0.5]}]}');
    expect(text(applyChangesAnswer(TABLE, a))).toContain("box Lade size 0.5 0.1 0.5 at 0 0.6 0.2\n");
  });
});
