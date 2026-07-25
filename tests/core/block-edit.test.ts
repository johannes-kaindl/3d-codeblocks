import { describe, expect, it } from "vitest";
import { applyViewKey } from "../../src/core/block-edit";
import { NAMED_VIEWS } from "../../src/core/view-spec";

const TOP = NAMED_VIEWS.top;

describe("applyViewKey", () => {
  it("adds the key right after file:", () => {
    expect(applyViewKey("file: a.glb\nheight: 300", TOP)).toBe("file: a.glb\nview: top\nheight: 300");
  });

  it("adds the key after a bare path short form", () => {
    expect(applyViewKey("models/a.glb", TOP)).toBe("models/a.glb\nview: top");
  });

  it("replaces an existing key in place", () => {
    expect(applyViewKey("file: a.glb\nview: front\ntitle: X", TOP)).toBe(
      "file: a.glb\nview: top\ntitle: X",
    );
  });

  it("removes the key when given null", () => {
    expect(applyViewKey("file: a.glb\nview: top\ntitle: X", null)).toBe("file: a.glb\ntitle: X");
  });

  it("keeps only the first of several view lines", () => {
    expect(applyViewKey("file: a.glb\nview: front\nview: back", TOP)).toBe("file: a.glb\nview: top");
  });

  it("keeps comments, blank lines and unknown keys untouched", () => {
    const source = "# my house\nfile: a.glb\n\nwobble: 3";
    expect(applyViewKey(source, TOP)).toBe("# my house\nfile: a.glb\nview: top\n\nwobble: 3");
  });

  it("appends at the end when there is no file line at all", () => {
    expect(applyViewKey("height: 300", TOP)).toBe("height: 300\nview: top");
  });

  it("returns the source unchanged when removing a key that is not there", () => {
    expect(applyViewKey("file: a.glb", null)).toBe("file: a.glb");
  });

  it("preserves a trailing newline", () => {
    expect(applyViewKey("file: a.glb\n", TOP)).toBe("file: a.glb\nview: top\n");
  });
});
