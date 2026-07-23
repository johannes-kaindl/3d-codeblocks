import { describe, expect, it } from "vitest";
import { parseBlockConfig } from "../../src/core/block-config";

describe("parseBlockConfig", () => {
  it("reads file, height and title", () => {
    const r = parseBlockConfig("file: a/b.glb\nheight: 420\ntitle: Ground floor");
    expect(r.config).toEqual({ file: "a/b.glb", height: 420, title: "Ground floor" });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("accepts a bare path as shorthand for file", () => {
    const r = parseBlockConfig("weltmodell/3d/eg.glb");
    expect(r.config?.file).toBe("weltmodell/3d/eg.glb");
    expect(r.errors).toEqual([]);
  });

  it("keeps colons inside a bare path", () => {
    const r = parseBlockConfig("some folder/odd:name.glb");
    expect(r.config?.file).toBe("some folder/odd:name.glb");
  });

  it("errors when file is missing", () => {
    const r = parseBlockConfig("height: 300");
    expect(r.config).toBeNull();
    expect(r.errors).toEqual(["No `file:` given."]);
  });

  it("errors on an empty block", () => {
    const r = parseBlockConfig("   \n\n");
    expect(r.config).toBeNull();
    expect(r.errors).toEqual(["No `file:` given."]);
  });

  it("warns about an unknown key and still renders", () => {
    const r = parseBlockConfig("file: a.glb\nheigth: 400");
    expect(r.config?.file).toBe("a.glb");
    expect(r.warnings).toEqual(["Unknown key: `heigth`"]);
  });

  it("warns about an invalid height and falls back", () => {
    const r = parseBlockConfig("file: a.glb\nheight: tall");
    expect(r.config?.height).toBeUndefined();
    expect(r.warnings).toEqual(["`height` must be a number: `tall`"]);
  });

  it("warns about a non-positive height", () => {
    const r = parseBlockConfig("file: a.glb\nheight: 0");
    expect(r.config?.height).toBeUndefined();
    expect(r.warnings).toEqual(["`height` must be a number: `0`"]);
  });

  it("ignores blank lines and # comments", () => {
    const r = parseBlockConfig("# the ground floor\n\nfile: a.glb\n");
    expect(r.config?.file).toBe("a.glb");
    expect(r.warnings).toEqual([]);
  });

  it("trims surrounding whitespace and quotes", () => {
    const r = parseBlockConfig('  file:   "a b.glb"  ');
    expect(r.config?.file).toBe("a b.glb");
  });

  it("is case-insensitive for keys", () => {
    const r = parseBlockConfig("File: a.glb\nHEIGHT: 250");
    expect(r.config).toEqual({ file: "a.glb", height: 250, title: undefined });
  });

  it("reports the last of two file keys and warns", () => {
    const r = parseBlockConfig("file: a.glb\nfile: b.glb");
    expect(r.config?.file).toBe("b.glb");
    expect(r.warnings).toEqual(["`file` given more than once — using the last one."]);
  });
});
