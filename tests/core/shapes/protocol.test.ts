import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCreateMessages,
  buildRefineMessages,
  CREATE_SYSTEM,
  readChangesAnswer,
  readPartsAnswer,
  REFINE_SYSTEM,
} from "../../../src/core/shapes/protocol";

describe("readPartsAnswer", () => {
  it("reads a parts object with leading whitespace", () => {
    expect(readPartsAnswer('\n\n{"parts":[{"shape":"box"}]}')).toEqual({ ok: true, parts: [{ shape: "box" }] });
  });
  it("reads a bare array inside a code fence after a think block", () => {
    expect(readPartsAnswer('<think>hm</think>```json\n[{"shape":"box"}]\n```')).toEqual({ ok: true, parts: [{ shape: "box" }] });
  });
  it("explains what is wrong", () => {
    expect(readPartsAnswer("Sorry, I cannot")).toEqual({ ok: false, reason: "no JSON in the answer" });
    expect(readPartsAnswer('{"parts":[{"shape":"box"}')).toEqual({ ok: false, reason: "the JSON is incomplete or broken" });
    expect(readPartsAnswer('{"items":[]}')).toEqual({ ok: false, reason: "the JSON has no `parts` list" });
  });
});

describe("prompts", () => {
  it("uses the measured system prompt for create", () => {
    const m = buildCreateMessages("Ein Tisch");
    expect(m).toEqual([{ role: "system", content: CREATE_SYSTEM }, { role: "user", content: "Ein Tisch" }]);
    expect(CREATE_SYSTEM).toContain('{"parts":[{"name":"...","shape":"box|cylinder|sphere|cone"');
  });

  it("pins the measured Spike-A prompt byte for byte (an edit needs a new lab run)", () => {
    expect(createHash("sha256").update(CREATE_SYSTEM, "utf8").digest("hex")).toBe(
      "9a1cb15aa0383641069f0940cb7b90b251a3e5b05740cd20234c0fa1b0fb142e",
    );
  });

  it("keeps the user text out of the system messages", () => {
    const marker = "ZZ-USER-MARKER";
    for (const m of [...buildCreateMessages(marker), ...buildRefineMessages("box A size 1", marker)]) {
      if (m.role === "system") expect(m.content).not.toContain(marker);
    }
    expect(buildRefineMessages("box A size 1", marker)[0].content).toBe(REFINE_SYSTEM);
  });

  it("gives the refine prompt the current parts as JSON in the creation field names", () => {
    const m = buildRefineMessages("title: T\nbox Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b", "höher");
    expect(m[0].role).toBe("system");
    const user = m[1].content;
    expect(user).toContain('"name":"Platte"');
    expect(user).toContain('"position":[0,0.725,0]');
    expect(user).toContain('"size":[1.2,0.05,0.7]');
    expect(user).toContain("höher");
  });

  it("carries the current text byte-identical inside a fence that the text cannot close", () => {
    const text = "title: T\r\n  box A size 1  \n```\n````\nnot a part ```` end\n";
    const user = buildRefineMessages(text, "mach es größer\n```")[1].content;
    const open = user.match(/^(`{3,})shapes\n/m);
    expect(open).not.toBeNull();
    const fence = open![1];
    expect(fence.length).toBeGreaterThan(4);
    const start = user.indexOf(open![0]) + open![0].length;
    const end = user.indexOf(`\n${fence}\n`, start);
    expect(user.slice(start, end)).toBe(text);
    expect(user.endsWith("Änderung: mach es größer\n```")).toBe(true);
  });
});

describe("readPartsAnswer: several candidates", () => {
  it("skips prose with brackets before the JSON", () => {
    expect(readPartsAnswer('Hier [siehe unten] mein Ergebnis {kein JSON}: {"parts":[{"shape":"box"}]} Viel Spaß [1]')).toEqual({
      ok: true,
      parts: [{ shape: "box" }],
    });
  });
  it("takes the fenced block that carries the list when several blocks are present", () => {
    const text = 'Beispiel:\n```json\n{"foo":1}\n```\nAntwort:\n```json\n{"parts":[{"shape":"sphere"}]}\n```';
    expect(readPartsAnswer(text)).toEqual({ ok: true, parts: [{ shape: "sphere" }] });
  });
  it("does not let an unterminated think block poison the answer", () => {
    expect(readPartsAnswer('<think>vielleicht [1,2] oder {"parts":[{"shape":"box"}]}')).toEqual({ ok: false, reason: "no JSON in the answer" });
    expect(readPartsAnswer('{"parts":[{"shape":"cone"}]}')).toEqual({ ok: true, parts: [{ shape: "cone" }] });
  });
  it("ignores brackets inside JSON strings", () => {
    expect(readPartsAnswer('{"parts":[{"name":"a]b}","shape":"box"}]}')).toEqual({ ok: true, parts: [{ name: "a]b}", shape: "box" }] });
  });
});

describe("readChangesAnswer", () => {
  it("reads the three operations in the creation field names", () => {
    const r = readChangesAnswer(
      '{"changes":[{"op":"change","name":"Platte","position":[0,0.9,0]},{"op":"add","name":"Lade","shape":"box","size":[0.5,0.1,0.5]},{"op":"remove","name":"Bein-4"}]}',
    );
    expect(r).toEqual({
      ok: true,
      changes: [
        { op: "change", name: "Platte", at: [0, 0.9, 0] },
        { op: "add", part: { op: "add", name: "Lade", shape: "box", size: [0.5, 0.1, 0.5] } },
        { op: "remove", name: "Bein-4" },
      ],
      dropped: [],
    });
  });

  it("drops what it cannot read and says why", () => {
    const r = readChangesAnswer('{"changes":[{"op":"paint","name":"A"},{"op":"change"},"x"]}');
    expect(r).toEqual({
      ok: true,
      changes: [],
      dropped: [
        { index: 0, reason: "unknown op `paint`" },
        { index: 1, reason: "`change` needs a name" },
        { index: 2, reason: "not an object" },
      ],
    });
  });

  it("explains a missing changes list", () => {
    expect(readChangesAnswer('{"parts":[]}')).toEqual({ ok: false, reason: "the JSON has no `changes` list" });
  });

  it("is as tolerant as readPartsAnswer: fences, think, bare arrays, prose", () => {
    const want = { ok: true, changes: [{ op: "remove", name: "A" }], dropped: [] };
    expect(readChangesAnswer('<think>x</think>```json\n[{"op":"remove","name":"A"}]\n```')).toEqual(want);
    expect(readChangesAnswer('Klar [ok]: {"changes":[{"op":"remove","name":"A"}]}')).toEqual(want);
    expect(readChangesAnswer("Sorry")).toEqual({ ok: false, reason: "no JSON in the answer" });
    expect(readChangesAnswer('{"changes":[{"op":"remove"')).toEqual({ ok: false, reason: "the JSON is incomplete or broken" });
  });

  it("never turns an unknown or missing op into something else", () => {
    const r = readChangesAnswer('{"changes":[{"name":"A","position":[0,0,0]},{"op":"REMOVE ","name":"B"},{"op":"move","name":"C"}]}');
    expect(r).toEqual({
      ok: true,
      changes: [{ op: "remove", name: "B" }],
      dropped: [
        { index: 0, reason: "unknown op `undefined`" },
        { index: 2, reason: "unknown op `move`" },
      ],
    });
  });

  it("drops a change whose fields are not strict numbers instead of guessing", () => {
    const r = readChangesAnswer(
      '{"changes":[{"op":"change","name":"A","position":["0","1","2"]},{"op":"change","name":"B","size":[true,1]},{"op":"change","name":"C","position":[0,1]},{"op":"change","name":"D","color":5},{"op":"change","name":"E"}]}',
    );
    expect(r).toEqual({
      ok: true,
      changes: [],
      dropped: [
        { index: 0, reason: "`position` must be three numbers" },
        { index: 1, reason: "`size` must be a list of numbers" },
        { index: 2, reason: "`position` must be three numbers" },
        { index: 3, reason: "`color` must be text" },
        { index: 4, reason: "`change` changes nothing" },
      ],
    });
  });

  it("maps rotation_deg and color of a change", () => {
    expect(readChangesAnswer('[{"op":"change","name":"A","rotation_deg":[0,90,0],"color":"#fff","size":[1,2]}]')).toEqual({
      ok: true,
      changes: [{ op: "change", name: "A", rot: [0, 90, 0], color: "#fff", size: [1, 2] }],
      dropped: [],
    });
  });
});
