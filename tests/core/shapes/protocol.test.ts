import { describe, expect, it } from "vitest";
import { readPartsAnswer } from "../../../src/core/shapes/protocol";

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
