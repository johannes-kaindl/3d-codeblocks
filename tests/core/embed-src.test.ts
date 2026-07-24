import { describe, expect, it } from "vitest";
import { heightFromAlt } from "../../src/core/embed-src";

describe("heightFromAlt", () => {
  it("returns undefined without an alt", () => {
    expect(heightFromAlt(null)).toBeUndefined();
    expect(heightFromAlt(undefined)).toBeUndefined();
    expect(heightFromAlt("")).toBeUndefined();
  });

  it("reads a plain numeric alt as the height", () => {
    expect(heightFromAlt("300")).toBe(300);
  });

  it("reads the number after a pipe", () => {
    expect(heightFromAlt("weltmodell/3d/eg.gltf|420")).toBe(420);
  });

  it("trims whitespace", () => {
    expect(heightFromAlt("  250 ")).toBe(250);
  });

  it("ignores a non-numeric alt", () => {
    expect(heightFromAlt("some caption")).toBeUndefined();
  });

  it("ignores a non-positive number", () => {
    expect(heightFromAlt("0")).toBeUndefined();
    expect(heightFromAlt("-5")).toBeUndefined();
  });
});
