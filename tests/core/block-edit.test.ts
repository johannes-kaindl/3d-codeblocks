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

  it("preserves CRLF line endings in round-trip", () => {
    const source = "file: a.glb\r\nheight: 300\r\n";
    const result = applyViewKey(source, TOP);
    expect(result).toBe("file: a.glb\r\nview: top\r\nheight: 300\r\n");
    // Verify all line separators are CRLF, not mixed
    expect(result).not.toContain("\n\r");
    const lines = result.split("\r\n");
    expect(lines.length).toBe(4); // file, view, height, and empty string after trailing CRLF
  });

  it("keeps pure LF when source uses LF", () => {
    const source = "file: a.glb\nheight: 300\n";
    const result = applyViewKey(source, TOP);
    expect(result).toBe("file: a.glb\nview: top\nheight: 300\n");
    // Verify no CRLF crept in
    expect(result).not.toContain("\r\n");
  });

  it("handles empty source by returning just the view line", () => {
    expect(applyViewKey("", TOP)).toBe("view: top");
  });

  it("returns empty string when removing view from empty source", () => {
    expect(applyViewKey("", null)).toBe("");
  });

  it("preserves mixed CRLF and LF boundaries", () => {
    const source = "file: a.glb\r\nheight: 300\nwidth: 10\r\n";
    const result = applyViewKey(source, TOP);
    expect(result).toBe("file: a.glb\r\nview: top\r\nheight: 300\nwidth: 10\r\n");
    // Verify the height/width boundary is still bare LF, not normalized to CRLF
    expect(result).toContain("height: 300\nwidth:");
  });

  it("handles single newline without losing it", () => {
    const result = applyViewKey("\n", TOP);
    expect(result).toBe("\nview: top\n");
  });

  it("inserts with CRLF boundary in a CRLF-only source", () => {
    const source = "file: a.glb\r\n";
    const result = applyViewKey(source, TOP);
    // The inserted line should inherit \r from the anchor line
    expect(result).toBe("file: a.glb\r\nview: top\r\n");
    expect(result).toContain("file: a.glb\r\nview: top\r\n");
  });
});
