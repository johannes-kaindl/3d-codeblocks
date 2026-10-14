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

const BLOCKED = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

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

    expect(r.resolve("textures/wall.png")).toBe(BLOCKED);
    expect(r.problems).toEqual([{ uri: "textures/wall.png", reason: "missing" }]);
  });

  it("blocks an external URL while the setting is off: what three receives is the placeholder, never the URL", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", false);

    expect(r.resolve("https://cdn.example.com/w.png")).toBe(BLOCKED);
    expect(r.problems).toEqual([
      { uri: "https://cdn.example.com/w.png", reason: "external-blocked" },
    ]);
  });

  // Schreibweisen, die ein Schema-Muster verfehlt, der URL-Parser des Browsers aber als Netz-URL liest. Nichts davon darf bei ausgeschalteter
  // Einstellung als etwas anderes als der Platzhalter bei three ankommen (und nichts davon als Original-Zeichenkette, auch bei eingeschalteter nicht).
  const HOSTILE = [
    "ht\ttps://evil.example/a.png",
    "h\nttp://evil.example/b.png",
    "htt\rps://evil.example/c.png",
    " https://evil.example/d.png",
    "\u0001https://evil.example/e.png",
    "HTTPS://EVIL.EXAMPLE/f.png",
    "//evil.example/g.png",
    "\\\\evil.example/h.png",
    "/\\evil.example/i.png",
  ];

  it.each(HOSTILE)("setting off: %j never reaches three as a URL", (uri) => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", false);
    expect(r.resolve(uri)).toBe(BLOCKED);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]?.reason).toBe("external-blocked");
  });

  it.each(HOSTILE)("setting on: %j arrives as one clean https URL (no control characters left)", (uri) => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", true);
    const out = r.resolve(uri);
    expect(out).toMatch(/^https?:\/\/evil\.example\/[a-i]\.png$/i);
    expect(r.problems).toEqual([]);
  });

  it("a data URI with control characters inside the scheme is cleaned, not passed raw", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", false);
    expect(r.resolve("da\tta:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("lets an external URL through once the setting is on", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", true);

    expect(r.resolve("https://cdn.example.com/w.png")).toBe("https://cdn.example.com/w.png");
    expect(r.problems).toEqual([]);
  });

  it("a rejected reference (outside the vault, other scheme) gets the placeholder too", () => {
    const r = createResourceResolver(vaultWith(), "a/m.gltf", true);
    expect(r.resolve("../../../etc/passwd")).toBe(BLOCKED);
    expect(r.resolve("file:///etc/passwd")).toBe(BLOCKED);
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
