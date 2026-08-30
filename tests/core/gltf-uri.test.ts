import { describe, expect, it } from "vitest";
import { classifyUri, resourceProblemNotes } from "../../src/core/gltf-uri";

describe("classifyUri", () => {
  it("leaves data URIs to the loader", () => {
    expect(classifyUri("data:application/octet-stream;base64,AAAA", "weltmodell/3d")).toEqual({
      kind: "embedded",
    });
  });

  it("resolves a sibling file against the model's folder, not the note's", () => {
    expect(classifyUri("scene.bin", "weltmodell/3d")).toEqual({
      kind: "vault",
      path: "weltmodell/3d/scene.bin",
    });
  });

  it("resolves a subfolder reference", () => {
    expect(classifyUri("textures/wall.png", "weltmodell/3d")).toEqual({
      kind: "vault",
      path: "weltmodell/3d/textures/wall.png",
    });
  });

  it("allows going up as long as the result stays inside the vault", () => {
    expect(classifyUri("../shared/wall.png", "weltmodell/3d")).toEqual({
      kind: "vault",
      path: "weltmodell/shared/wall.png",
    });
  });

  it("rejects a path that climbs out of the vault", () => {
    expect(classifyUri("../../../etc/passwd", "weltmodell/3d")).toEqual({
      kind: "rejected",
      reason: "outside-vault",
    });
  });

  it("handles a model that sits in the vault root", () => {
    expect(classifyUri("scene.bin", "")).toEqual({ kind: "vault", path: "scene.bin" });
  });

  it("decodes percent-escapes, which glTF URIs are required to use", () => {
    expect(classifyUri("my%20model.bin", "a")).toEqual({ kind: "vault", path: "a/my model.bin" });
  });

  it("reports http(s) separately so the setting can decide", () => {
    expect(classifyUri("https://cdn.example.com/wall.png", "a")).toEqual({
      kind: "external",
      url: "https://cdn.example.com/wall.png",
    });
  });

  it("recognises the scheme regardless of case", () => {
    expect(classifyUri("HTTP://example.com/w.png", "a")).toEqual({
      kind: "external",
      url: "HTTP://example.com/w.png",
    });
  });

  it("rejects every other scheme", () => {
    expect(classifyUri("file:///etc/passwd", "a")).toEqual({
      kind: "rejected",
      reason: "scheme",
    });
    expect(classifyUri("blob:abcd", "a")).toEqual({ kind: "rejected", reason: "scheme" });
  });

  it("rejects an empty reference", () => {
    expect(classifyUri("", "a")).toEqual({ kind: "rejected", reason: "empty" });
    expect(classifyUri("   ", "a")).toEqual({ kind: "rejected", reason: "empty" });
  });
});

describe("resourceProblemNotes", () => {
  it("says nothing when nothing went wrong", () => {
    expect(resourceProblemNotes([])).toEqual([]);
  });

  it("names a missing sibling file", () => {
    expect(resourceProblemNotes([{ uri: "textures/wall.png", reason: "missing" }])).toEqual([
      "Not found in the vault: textures/wall.png",
    ]);
  });

  it("groups several problems of the same kind into one line", () => {
    expect(
      resourceProblemNotes([
        { uri: "a.png", reason: "missing" },
        { uri: "b.png", reason: "missing" },
      ]),
    ).toEqual(["Not found in the vault: a.png, b.png"]);
  });

  it("keeps the line short when many files are missing", () => {
    const many = ["a", "b", "c", "d", "e"].map((u) => ({ uri: u, reason: "missing" as const }));
    expect(resourceProblemNotes(many)).toEqual(["Not found in the vault: a, b, c and 2 more"]);
  });

  it("points at the setting when an external reference was blocked", () => {
    expect(
      resourceProblemNotes([{ uri: "https://cdn.example.com/w.png", reason: "external-blocked" }]),
    ).toEqual([
      'Not loaded because "Allow external resources" is off: https://cdn.example.com/w.png',
    ]);
  });

  it("explains a reference that leaves the vault", () => {
    expect(resourceProblemNotes([{ uri: "../../x.png", reason: "outside-vault" }])).toEqual([
      "Refused, because it points outside the vault: ../../x.png",
    ]);
  });

  it("explains an unusable scheme", () => {
    expect(resourceProblemNotes([{ uri: "file:///x.png", reason: "scheme" }])).toEqual([
      "Refused, because this kind of reference cannot be read: file:///x.png",
    ]);
  });

  it("keeps one line per kind, in a stable order", () => {
    expect(
      resourceProblemNotes([
        { uri: "b.png", reason: "external-blocked" },
        { uri: "a.png", reason: "missing" },
      ]),
    ).toEqual([
      "Not found in the vault: a.png",
      'Not loaded because "Allow external resources" is off: b.png',
    ]);
  });
});
