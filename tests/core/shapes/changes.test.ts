import { describe, expect, it } from "vitest";
import { applyChanges, applyChangesAnswer, matchPart } from "../../../src/core/shapes/changes";
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

  it("Focus 1: matchPart ignores case and separators, refuses ambiguity (also with an exact hit)", () => {
    const found = (n: string): unknown => ({ kind: "found", name: n });
    expect(matchPart(["Bein-1", "Platte"], "platte")).toEqual(found("Platte"));
    expect(matchPart(["Tischplatte"], "tischplatte")).toEqual(found("Tischplatte"));
    expect(matchPart(["Bein-vorne-links"], "bein vorne links")).toEqual(found("Bein-vorne-links"));
    expect(matchPart(["Bein-1", "Platte"], "Bein_1")).toEqual(found("Bein-1"));
    expect(matchPart(["Bein-1", "Bein_1"], "bein 1")).toEqual({ kind: "ambiguous", candidates: ["Bein-1", "Bein_1"] });
    expect(matchPart(["Bein-1", "Bein_1"], "Bein-1")).toEqual({ kind: "ambiguous", candidates: ["Bein-1", "Bein_1"] });
    expect(matchPart(["Platte"], "Stuhl")).toEqual({ kind: "none" });
    expect(matchPart(["Platte"], "-_ ")).toEqual({ kind: "none" });
    expect(matchPart(["ambiguous"], "ambiguous")).toEqual(found("ambiguous"));
    expect(matchPart(["\u00c4rger"], "A\u0308rger")).toEqual(found("\u00c4rger")); // NFD gesucht, NFC vorhanden
  });

  it("a part literally named `ambiguous` can be changed", () => {
    expect(text(applyChanges("box ambiguous size 1\n", [{ op: "change", name: "ambiguous", color: "#000" }]))).toBe("box ambiguous size 1 1 1 color #000000\n");
  });

  it("a decomposed model-side name edits the composed part in the text", () => {
    expect(text(applyChanges("box \u00c4rger size 1\n", [{ op: "remove", name: "A\u0308rger" }]))).toBe("");
  });

  it("refuses a target that sits on an error line (duplicate name)", () => {
    const dup = "box A size 1\nbox A size 2\n";
    expect(applyChanges(dup, [{ op: "change", name: "A", color: "#000" }])).toEqual({
      ok: false,
      problems: ["change 1: `A` appears on a line with an error — fix the text first"],
    });
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

describe("round-trip guard", () => {
  const fail = (t: string, c: Parameters<typeof applyChanges>[1]): string[] => {
    const r = applyChanges(t, c);
    if (r.ok) throw new Error("expected failure, got: " + r.text);
    return r.problems;
  };
  const MSG = (n: string): string => `\`${n}\`: its values need more than 4 decimals — edit this part by hand`;

  it("a colour-only change on a part with a size below 0.0001 is refused (it would vanish)", () => {
    expect(fail("sphere S size 0.00004\n", [{ op: "change", name: "S", color: "#000" }])).toContain(MSG("S"));
  });

  it("a colour-only change must not silently round other values", () => {
    expect(fail("box B size 0.123456789 at 1.000001 0 0\n", [{ op: "change", name: "B", color: "#000" }])).toEqual([MSG("B")]);
  });

  it("model-supplied values are rounded the way they are printed, and `after` agrees with the text", () => {
    const r = applyChanges("box B size 1\n", [{ op: "change", name: "B", at: [0.00001, 1.23456, 0] }]);
    expect(r.ok && r.text).toBe("box B size 1 1 1 at 0 1.2346 0\n");
    expect(r.ok && r.after[0]?.at).toEqual([0, 1.2346, 0]);
  });

  it("an added part with long decimals is printed and reported identically", () => {
    const r = applyChanges("box B size 1\n", [{ op: "add", part: { name: "C", shape: "sphere", size: [0.123456], position: [0, 0, 0.00001] } }]);
    expect(r.ok && r.text).toBe("box B size 1\nsphere C size 0.1235\n");
    expect(r.ok && r.after[1]).toMatchObject({ name: "C", size: [0.1235], at: [0, 0, 0] });
  });

  it("a colour-only change on 4-decimal values stays byte-identical except the colour", () => {
    const t = "box B size 0.1235 0.0001 2 at 1.0001 0 -0.9999 color #111111\n";
    expect(text(applyChanges(t, [{ op: "change", name: "B", color: "#222222" }]))).toBe(t.replace("#111111", "#222222"));
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

describe("unsupported or unknown keys on `change` (I-1)", () => {
  const refuse = (json: string): string[] => {
    const a = readChangesAnswer(json);
    const r = applyChangesAnswer(TABLE, a);
    expect(r.ok).toBe(false);
    return r.ok ? [] : r.problems;
  };

  it("an unknown key on `change` (`colour`, `at`, `Shape`) still refuses the whole answer, naming the key", () => {
    for (const key of ["colour", "at", "Shape"]) {
      const p = refuse(`{"changes":[{"op":"change","name":"Bein-1","${key}":"x","size":[1,1,1]}]}`);
      expect(p.join(" "), key).toContain(`\`${key}\``);
    }
  });

  it("any other unknown key is dropped too, with its name", () => {
    const a = readChangesAnswer('{"changes":[{"op":"change","name":"Bein-1","position":[0,0,0],"scale":2}]}');
    expect(a.ok && a.changes).toHaveLength(0);
    expect(a.ok && a.dropped[0].reason).toContain("`scale`");
  });

  it("known keys stay accepted; an `add` with an unknown key is refused like a `change` (Plan 3b symmetry)", () => {
    const a = readChangesAnswer('{"changes":[{"op":"change","name":"Bein-1","position":[0,0,0],"size":[1,1,1],"rotation_deg":[0,0,0],"color":"#fff"},{"op":"add","name":"X","shape":"box","size":[1,1,1]}]}');
    expect(a.ok && a.dropped).toEqual([]);
    const p = refuse('{"changes":[{"op":"add","name":"X","shape":"box","size":[1,1,1],"at":[0,0,0]}]}');
    expect(p.join(" ")).toContain("`add` has an unknown key `at`");
  });

  it("an answer that changes nothing is refused explicitly", () => {
    expect(refuse('{"changes":[]}')).toEqual(["the answer changed nothing"]);
    expect(refuse('{"changes":[{"op":"change","name":"Platte","position":[0,0.725,0]}]}')).toEqual(["the answer changed nothing"]);
  });
});

describe("add is as strict as change (I-3)", () => {
  const addFault = (extra: string): string => {
    const r = applyChanges(TABLE, [{ op: "add", part: JSON.parse(`{"op":"add","name":"Lade","shape":"box","size":[1,1,1],${extra}}`) }]);
    expect(r.ok, extra).toBe(false);
    return r.ok ? "" : r.problems.join(" ");
  };

  it("refuses malformed position, rotation_deg and color, naming item and field", () => {
    expect(addFault('"position":["0","1","0"]')).toMatch(/Lade.*`position`/);
    expect(addFault('"position":[0,1]')).toMatch(/Lade.*`position`/);
    expect(addFault('"rotation_deg":[0,1]')).toMatch(/Lade.*`rotation_deg`/);
    expect(addFault('"color":"black"')).toMatch(/Lade.*`color`/);
    expect(addFault('"color":5')).toMatch(/Lade.*`color`/);
  });

  it("absent keys keep their defaults", () => {
    const r = applyChanges(TABLE, [{ op: "add", part: { op: "add", name: "Lade", shape: "box", size: [1, 1, 1] } }]);
    expect(text(r)).toContain("box Lade size 1 1 1\n");
  });
});

describe("unnamed adds (M-5)", () => {
  it("two unnamed boxes get different numbers", () => {
    const r = applyChanges(TABLE, [
      { op: "add", part: { shape: "box", size: [1, 1, 1] } },
      { op: "add", part: { shape: "box", size: [2, 2, 2] } },
    ]);
    const t = text(r);
    expect(t).toContain("box box-4 size 1 1 1");
    expect(t).toContain("box box-5 size 2 2 2");
  });
});

describe("shape change (Plan 3b)", () => {
  const LEG = "box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3";
  const refused = (changes: Parameters<typeof applyChanges>[1], src = TABLE): string[] => {
    const r = applyChanges(src, changes);
    expect(r.ok).toBe(false);
    return r.ok ? [] : r.problems;
  };

  it("changes the shape when size comes along, keeping position and colour", () => {
    const r = applyChanges(TABLE, [{ op: "change", name: "Bein-1", shape: "cylinder", size: [0.03, 0.7] }]);
    expect(r.ok && r.text.split("\n")[3]).toBe("cylinder Bein-1 size 0.03 0.7 at -0.55 0.35 -0.3");
  });

  it("keeps colour, rotation and line position exactly (full text)", () => {
    const src = ["title: T", "box A size 1 1 1", "box B size 1 2 3 at 1 2 3 rot 0 90 0 color #112233", "box C size 1", ""].join("\n");
    const r = applyChanges(src, [{ op: "change", name: "B", shape: "cone", size: [0.5, 2] }]);
    expect(text(r)).toBe(["title: T", "box A size 1 1 1", "cone B size 0.5 2 at 1 2 3 rot 0 90 0 color #112233", "box C size 1", ""].join("\n"));
    expect(r.ok && r.after[1]).toMatchObject({ kind: "cone", name: "B", color: "#112233", rot: [0, 90, 0] });
  });

  it("refuses a shape change without a size for the new shape", () => {
    expect(refused([{ op: "change", name: "Bein-1", shape: "sphere" }])).toEqual(["change 1: `Bein-1`: changing the shape needs a `size` for a sphere"]);
  });

  it("refuses an unknown shape", () => {
    expect(refused([{ op: "change", name: "Bein-1", shape: "torus", size: [1] }])).toEqual(["change 1: `Bein-1`: unknown shape `torus`"]);
  });

  it("validates the size against the NEW kind (3 numbers for a sphere is refused, naming the kind)", () => {
    const p = refused([{ op: "change", name: "Bein-1", shape: "sphere", size: [1, 2, 3] }]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("sphere");
  });

  it("same-kind shape is a no-op on the shape and size stays optional", () => {
    const r = applyChanges(TABLE, [{ op: "change", name: "Bein-1", shape: "box", color: "#ff0000" }]);
    expect(text(r)).toBe(TABLE.replace(LEG, `${LEG} color #ff0000`));
    const q = applyChanges(TABLE, [{ op: "change", name: "Bein-1", shape: "box" }]);
    expect(q.ok).toBe(true);
    // end to end the no-op is refused explicitly
    const a = readChangesAnswer('{"changes":[{"op":"change","name":"Bein-1","shape":"box"}]}');
    expect(applyChangesAnswer(TABLE, a)).toEqual({ ok: false, problems: ["the answer changed nothing"] });
  });

  it("an `add` without a shape says so instead of `unknown shape undefined`", () => {
    const p = refused([{ op: "add", part: { op: "add", name: "Lade", size: [1, 1, 1] } }]);
    expect(p).toEqual(["change 1 (add): `Lade`: `add` needs a `shape`"]);
  });

  it("accepts shape in other case / with whitespace, like the parser does for kinds", () => {
    const r = applyChanges(TABLE, [{ op: "change", name: "Bein-1", shape: " Cylinder ", size: [0.03, 0.7] }]);
    expect(r.ok && r.after[1].kind).toBe("cylinder");
  });

  it("still refuses a shape change on a line with unrecognised words", () => {
    const src = "box A size 1 1 1 bogus\n";
    const p = refused([{ op: "change", name: "A", shape: "sphere", size: [1] }], src);
    expect(p.join(" ")).toContain("unrecognised words");
  });

  it("works cumulatively: shape change then size change on the same part", () => {
    const r = applyChanges(TABLE, [
      { op: "change", name: "Bein-1", shape: "cylinder", size: [0.03, 0.7] },
      { op: "change", name: "Bein-1", size: [0.05, 0.9] },
    ]);
    expect(r.ok && r.text.split("\n")[3]).toBe("cylinder Bein-1 size 0.05 0.9 at -0.55 0.35 -0.3");
  });

  it("a second change after a shape change is validated against the new kind", () => {
    const p = refused([
      { op: "change", name: "Bein-1", shape: "cylinder", size: [0.03, 0.7] },
      { op: "change", name: "Bein-1", size: [1, 1, 1] },
    ]);
    expect(p.join(" ")).toContain("cylinder");
  });

  it("remove + add under the same name still works", () => {
    const r = applyChanges(TABLE, [
      { op: "remove", name: "Bein-1" },
      { op: "add", part: { op: "add", name: "Bein-1", shape: "cylinder", position: [-0.55, 0.35, -0.3], size: [0.03, 0.7] } },
    ]);
    expect(r.ok && r.after.find((d) => d.name === "Bein-1")?.kind).toBe("cylinder");
  });

  it("the round-trip guard sees the new line (answer path: reader + applier)", () => {
    const a = readChangesAnswer('{"changes":[{"op":"change","name":"Bein-1","shape":"cylinder","size":[0.03,0.7]}]}');
    const r = applyChangesAnswer(TABLE, a);
    expect(r.ok && r.after[1]).toEqual({ kind: "cylinder", name: "Bein-1", size: [0.03, 0.7], at: [-0.55, 0.35, -0.3], rot: [0, 0, 0], color: null });
    expect(r.ok && r.before[1].kind).toBe("box");
  });
});
