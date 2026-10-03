import { describe, expect, it } from "vitest";
import { convertShapesBytes, convertShapesText } from "../../../src/core/shapes/convert";

describe("convertShapesText", () => {
  it("converts and reports line problems as notes", () => {
    const r = convertShapesText("box A size 1\nbox B size 1 2\nbox C size 1 bogus");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.gltf.nodes as unknown[]).length).toBe(2);
    expect(r.notes).toEqual(["Line 2: `size` of a box needs 1 or 3 numbers", "Line 3: Unknown word `bogus` ignored"]);
  });

  it("fails with the line errors when no part is valid", () => {
    const r = convertShapesText("boxx A size 1");
    expect(r).toMatchObject({ ok: false, messages: ["Line 1: Unknown shape `boxx` — use box, cylinder, sphere or cone"] });
  });

  it("gives an example when the text is empty", () => {
    const r = convertShapesText("# nothing yet\n");
    expect(r).toMatchObject({ ok: false, messages: ["Write one part per line, e.g. `box Cube size 1 at 0 0.5 0`."] });
  });
});

describe("convertShapesBytes", () => {
  it("returns glTF JSON bytes", () => {
    const r = convertShapesBytes(new TextEncoder().encode("sphere K size 0.5").buffer as ArrayBuffer);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = JSON.parse(new TextDecoder().decode(r.bytes)) as { asset: { version: string } };
    expect(doc.asset.version).toBe("2.0");
  });
});
