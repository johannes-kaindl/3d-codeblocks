import { describe, expect, it, vi } from "vitest";
import { ActiveViewport, type ViewportController } from "../../src/core/active-viewport";

function makeController(name: string): ViewportController {
  return {
    getView: () => null,
    applyView: vi.fn(),
    canSave: () => true,
    save: vi.fn(async () => {}),
    label: () => name,
  };
}

describe("ActiveViewport", () => {
  it("starts with nothing active", () => {
    expect(new ActiveViewport().get()).toBeNull();
  });

  it("remembers the last one set", () => {
    const active = new ActiveViewport();
    const a = makeController("a");
    const b = makeController("b");
    active.set(a);
    active.set(b);
    expect(active.get()).toBe(b);
  });

  it("notifies subscribers on change", () => {
    const active = new ActiveViewport();
    const seen: (string | null)[] = [];
    active.subscribe((c) => seen.push(c?.label() ?? null));
    active.set(makeController("a"));
    expect(seen).toEqual(["a"]);
  });

  it("does not notify when the same controller is set again", () => {
    const active = new ActiveViewport();
    const a = makeController("a");
    active.set(a);
    const listener = vi.fn();
    active.subscribe(listener);
    active.set(a);
    expect(listener).not.toHaveBeenCalled();
  });

  it("clearIf only clears the one that is actually active", () => {
    const active = new ActiveViewport();
    const a = makeController("a");
    const b = makeController("b");
    active.set(a);
    active.clearIf(b);
    expect(active.get()).toBe(a);
    active.clearIf(a);
    expect(active.get()).toBeNull();
  });

  it("stops notifying after unsubscribe", () => {
    const active = new ActiveViewport();
    const listener = vi.fn();
    const off = active.subscribe(listener);
    off();
    active.set(makeController("a"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("notify fires listeners again with the current controller", () => {
    const active = new ActiveViewport();
    const seen: (string | null)[] = [];
    active.subscribe((c) => seen.push(c?.label() ?? null));
    const controller = makeController("a");
    active.set(controller);
    active.notify();
    expect(seen).toEqual(["a", "a"]);
  });

  it("keeps notifying later subscribers even when an earlier one throws", () => {
    // Sidebar und jeder Block/Embed/gltf-Block haengen am selben Listener-Set. Ohne
    // Isolation stoppt ein werfender Listener alle NACHFOLGENDEN Benachrichtigungen
    // in dieser Runde -- z. B. bekaeme die Sidebar nie mit, dass ein Block aktiv
    // wurde, nur weil ein anderer (fehlerhafter) Listener vorher warf.
    const active = new ActiveViewport();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    active.subscribe(broken);
    active.subscribe(healthy);

    active.set(makeController("a"));

    expect(broken).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalledWith(expect.objectContaining({ label: expect.any(Function) }));
    errorSpy.mockRestore();
  });
});
