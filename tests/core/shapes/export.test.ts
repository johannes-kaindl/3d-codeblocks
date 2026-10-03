import { describe, expect, it } from "vitest";
import { buildGltfExport, exportBaseName } from "../../../src/core/shapes/export";

describe("exportBaseName", () => {
  it("prefers the title and strips characters files cannot carry", () => {
    expect(exportBaseName({ title: "Tisch: groß/klein?" }, "x")).toBe("Tisch- groß-klein-");
    expect(exportBaseName({}, "Möbel")).toBe("Möbel");
    expect(exportBaseName({ title: "  " }, "Möbel")).toBe("Möbel");
  });
});

describe("buildGltfExport", () => {
  it("writes a derived glTF that names its source", () => {
    const r = buildGltfExport("title: Tisch\nbox A size 1", "Möbel.md (shapes code block)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = JSON.parse(r.json) as { asset: { extras: { generatedFrom: string } } };
    expect(doc.asset.extras.generatedFrom).toBe("Möbel.md (shapes code block)");
    expect(r.title).toBe("Tisch");
  });
  it("refuses text without a valid part", () => {
    expect(buildGltfExport("nothing", "x")).toMatchObject({ ok: false });
  });
});
