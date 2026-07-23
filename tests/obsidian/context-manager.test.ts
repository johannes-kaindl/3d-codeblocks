import { describe, expect, it, vi } from "vitest";
import { ContextManager } from "../../src/obsidian/context-manager";

describe("ContextManager", () => {
  it("keeps everything below the limit", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(
      () => 3,
      () => ++clock.t,
    );
    const a = vi.fn();
    const b = vi.fn();
    mgr.register("a", a);
    mgr.register("b", b);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("releases the least recently used once the limit is exceeded", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(
      () => 2,
      () => ++clock.t,
    );
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    mgr.register("a", a);
    mgr.register("b", b);
    mgr.register("c", c);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
  });

  it("protects a context that was just touched", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(
      () => 2,
      () => ++clock.t,
    );
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    mgr.register("a", a);
    mgr.register("b", b);
    mgr.touch("a");
    mgr.register("c", c);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("does not release an unregistered context", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(
      () => 1,
      () => ++clock.t,
    );
    const a = vi.fn();
    const b = vi.fn();
    mgr.register("a", a);
    mgr.unregister("a");
    mgr.register("b", b);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("releases each context only once", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(
      () => 1,
      () => ++clock.t,
    );
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    mgr.register("a", a);
    mgr.register("b", b);
    mgr.register("c", c);
    expect(a).toHaveBeenCalledTimes(1);
  });
});
