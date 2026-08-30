import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp } from "../__mocks__/obsidian";
import { createResourceResolver } from "../../src/obsidian/gltf-resources";

function vaultWith(...paths: string[]) {
  const app = makeFakeApp();
  app.vault.getAbstractFileByPath = vi.fn((p: string) => {
    if (!paths.includes(p)) return null;
    const f = new TFile();
    f.path = p;
    return f;
  });
  app.vault.getResourcePath = vi.fn((f: TFile) => `app://vault/${f.path}`);
  return app;
}

describe("createResourceResolver", () => {
  it("resolves a sibling file relative to the model, not the note", () => {
    const app = vaultWith("weltmodell/3d/scene.bin");
    const r = createResourceResolver(app, "weltmodell/3d/scene.gltf", false);

    expect(r.resolve("scene.bin")).toBe("app://vault/weltmodell/3d/scene.bin");
    expect(r.problems).toEqual([]);
  });

  it("passes data URIs through untouched", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", false);
    expect(r.resolve("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(r.problems).toEqual([]);
  });

  it("records a missing sibling instead of inventing a path", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", false);

    expect(r.resolve("textures/wall.png")).toBe("textures/wall.png");
    expect(r.problems).toEqual([{ uri: "textures/wall.png", reason: "missing" }]);
  });

  it("blocks an external URL while the setting is off", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", false);

    expect(r.resolve("https://cdn.example.com/w.png")).toBe("https://cdn.example.com/w.png");
    expect(r.problems).toEqual([
      { uri: "https://cdn.example.com/w.png", reason: "external-blocked" },
    ]);
  });

  it("lets an external URL through once the setting is on", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", true);

    expect(r.resolve("https://cdn.example.com/w.png")).toBe("https://cdn.example.com/w.png");
    expect(r.problems).toEqual([]);
  });

  it("never leaves the vault, not even with the setting on", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", true);

    r.resolve("../../../etc/passwd");

    expect(r.problems).toEqual([{ uri: "../../../etc/passwd", reason: "outside-vault" }]);
  });

  it("rejects other schemes", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", true);

    r.resolve("file:///etc/passwd");

    expect(r.problems).toEqual([{ uri: "file:///etc/passwd", reason: "scheme" }]);
  });

  it("reports each distinct uri once, however often the loader asks", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", false);

    r.resolve("wall.png");
    r.resolve("wall.png");

    expect(r.problems).toEqual([{ uri: "wall.png", reason: "missing" }]);
  });
});
