import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "../__mocks__/obsidian";
import { ViewerHost } from "../../src/obsidian/viewer-host";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import { NAMED_VIEWS } from "../../src/core/view-spec";

const fakeRig = { setMode: vi.fn(), select: vi.fn(), applyTrs: vi.fn(), dispose: vi.fn() };

function makeVp() {
  return {
    disposed: 0,
    setModel: vi.fn(),
    setView: vi.fn(),
    getView: vi.fn(() => null),
    setColors: vi.fn(),
    resize: vi.fn(),
    resetCamera: vi.fn(),
    capturePoster: () => "data:image/png;base64,AAA",
    createEditRig: vi.fn(() => fakeRig),
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

  it("applies the block's view after loading the model", async () => {
    const { host, created } = makeHost();
    await host.render({
      provideBytes: bytes,
      format: "gltf",
      inspectContainer: false,
      label: "x",
      view: NAMED_VIEWS.top,
    });
    expect(created[0].setView).toHaveBeenCalledWith(NAMED_VIEWS.top);
  });

  it("fits automatically when the block has no view", async () => {
    const { host, created } = makeHost();
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    expect(created[0].setView).toHaveBeenCalledWith(null);
  });

  // Leck-Regression: jeder Reload (onFileModified → render()) baute einen NEUEN Viewport,
  // ohne den noch lebenden alten freizugeben — Renderer, Canvas, ResizeObserver und
  // OrbitControls blieben pro Regenerierung liegen. Im Edit-Modus (`pin(true)`) fiel das
  // nicht einmal ueber den Poster-Pfad wieder auf, weil der gepinnte Host gar nicht
  // degradiert. `mount()` gibt den Vorgaenger deshalb IMMER frei.
  it("releases the previous viewport before mounting a new one (reload leak)", async () => {
    const { host, created } = makeHost();
    const source = { provideBytes: bytes, format: "gltf" as const, inspectContainer: false, label: "x" };
    await host.render(source);
    await host.render(source);

    expect(created).toHaveLength(2);
    expect(created[0].disposed).toBe(1);
    expect(created[1].disposed).toBe(0);
  });

  it("releases the previous viewport even while pinned (edit mode reload)", async () => {
    const { host, created } = makeHost();
    const source = { provideBytes: bytes, format: "gltf" as const, inspectContainer: false, label: "x" };
    await host.render(source);
    host.pin(true);
    await host.render(source);

    expect(created[0].disposed).toBe(1);
  });
});

// Der ganze Zweig war ungetestet — deshalb blieb der Modus seit v0.1.0 unbenutzbar,
// obwohl die Suite gruen war (Smoke #4 / Vorbefund-TaskNote).
describe("ViewerHost with viewMode 'on-click'", () => {
  const onClick = { ...DEFAULT_SETTINGS, viewMode: "on-click" as const };
  const source = { provideBytes: bytes, format: "gltf" as const, inspectContainer: false, label: "x" };

  /** Das Klickfeld, das `renderPoster` ueber das Standbild legt. */
  function playOverlay(stage: any) {
    return stage.children.find((child: any) => child.className === "tdcb-play");
  }

  /** `reactivate()` laeuft asynchron los; der Klick-Handler wartet nicht darauf. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("starts as a still image instead of a live viewport", async () => {
    const { host, created, stage } = makeHost({ settings: () => onClick });
    await host.render(source);
    expect(created[0].disposed).toBe(1);
    expect(playOverlay(stage)).toBeDefined();
  });

  it("stays interactive after the user clicks the still image", async () => {
    const { host, created, stage } = makeHost({ settings: () => onClick });
    await host.render(source);

    playOverlay(stage).click();
    await settle();

    // Ein zweiter Viewport wurde gebaut — und darf diesmal NICHT sofort wieder
    // eingezogen werden, sonst landet der Klick wieder im Standbild.
    expect(created).toHaveLength(2);
    expect(created[1].disposed).toBe(0);
  });

  it("hands the reactivated viewport to the budget, so it can degrade again later", async () => {
    const { host, budget, stage } = makeHost({ settings: () => onClick });
    await host.render(source);
    expect(budget.register).not.toHaveBeenCalled();

    playOverlay(stage).click();
    await settle();

    expect(budget.register).toHaveBeenCalled();
  });
});

describe("ViewerHost edit support", () => {
  it("delegiert createEditRig an den Viewport", async () => {
    const { host, created } = makeHost();
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    const cb = { isSelectable: () => true, onSelect: vi.fn(), onTransformEnd: vi.fn(), onInteract: vi.fn() };
    expect(host.createEditRig(cb)).not.toBeNull();
    expect(created[0].createEditRig).toHaveBeenCalledWith(cb);
  });

  it("liefert null ohne Viewport (Poster/Fehler)", () => {
    const { host } = makeHost();
    expect(host.createEditRig({ isSelectable: () => true, onSelect: vi.fn(), onTransformEnd: vi.fn(), onInteract: vi.fn() })).toBeNull();
  });

  it("pinned: Budget-Eviction degradiert NICHT zum Poster", async () => {
    const { host, budget, created } = makeHost();
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    host.pin(true);
    const release = budget.register.mock.calls[0][1] as () => void;
    release(); // LRU wirft uns raus — im Edit-Modus ignorieren
    expect(created[0].disposed).toBe(0);
  });

  it("pinned: on-click-Modus startet nach Reload trotzdem live (Regeneration im Edit)", async () => {
    const { host, created } = makeHost({ settings: () => ({ ...DEFAULT_SETTINGS, viewMode: "on-click" as const }) });
    host.pin(true);
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    // Ohne Pin wuerde on-click ohne Aktivierung sofort degradieren (kein zweiter Viewport-Zustand):
    expect(created[0].disposed).toBe(0);
  });
});
