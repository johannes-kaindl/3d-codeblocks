import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "../__mocks__/obsidian";
import { ViewerHost } from "../../src/obsidian/viewer-host";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";

function makeVp() {
  return {
    disposed: 0,
    setModel: vi.fn(),
    setColors: vi.fn(),
    resize: vi.fn(),
    resetCamera: vi.fn(),
    capturePoster: () => "data:image/png;base64,AAA",
    dispose() {
      this.disposed += 1;
    },
  };
}

function makeHost(over: Record<string, unknown> = {}) {
  const created: any[] = [];
  const budget = { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() };
  const stage = makeFakeEl();
  const message = makeFakeEl();
  const host = new ViewerHost(stage, message, {
    settings: () => DEFAULT_SETTINGS,
    factory: {
      isWebGLAvailable: () => true,
      create: () => {
        const vp = makeVp();
        created.push(vp);
        return vp;
      },
    },
    budget,
    loadModel: vi.fn().mockResolvedValue({}),
    readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
    managed: true,
    ...over,
  } as any);
  return { host, created, budget, stage, message };
}

const bytes = () => Promise.resolve(new ArrayBuffer(8));

describe("ViewerHost", () => {
  it("registers with the budget when managed", async () => {
    const { host, budget, created } = makeHost({ managed: true });
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    expect(created).toHaveLength(1);
    expect(budget.register).toHaveBeenCalled();
  });

  it("never touches the budget when unmanaged (file view)", async () => {
    const { host, budget, created } = makeHost({ managed: false });
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    expect(created).toHaveLength(1);
    expect(budget.register).not.toHaveBeenCalled();
  });

  it("disposes the viewport and unregisters on dispose", async () => {
    const { host, budget, created } = makeHost();
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    host.dispose();
    expect(created[0].disposed).toBe(1);
    expect(budget.unregister).toHaveBeenCalled();
  });

  it("reports missing WebGL without building a viewport", async () => {
    const { host, created, message } = makeHost({ factory: { isWebGLAvailable: () => false, create: vi.fn() } });
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    expect(created).toHaveLength(0);
    expect(JSON.stringify(message.children)).toContain("WebGL is unavailable");
  });

  it("shows an arbitrary error via showError", () => {
    const { host, message } = makeHost();
    host.showError({ kind: "missing-file", path: "a/b.gltf" });
    expect(JSON.stringify(message.children)).toContain("File not found: a/b.gltf");
  });
});
