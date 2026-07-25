import { describe, expect, it, vi } from "vitest";
import { readOnlyController } from "../../src/obsidian/read-only-controller";
import { NAMED_VIEWS } from "../../src/core/view-spec";

function fakeHost() {
  return { currentView: vi.fn(() => NAMED_VIEWS.top), applyView: vi.fn() };
}

describe("readOnlyController", () => {
  it("never allows saving — there is no code block behind it", () => {
    expect(readOnlyController(() => fakeHost() as any, () => "a.glb").canSave()).toBe(false);
  });

  it("reads the current view through the host", () => {
    const host = fakeHost();
    expect(readOnlyController(() => host as any, () => "a.glb").getView()).toEqual(NAMED_VIEWS.top);
  });

  it("applies a view through the host, so Fit works", () => {
    const host = fakeHost();
    readOnlyController(() => host as any, () => "a.glb").applyView(null);
    expect(host.applyView).toHaveBeenCalledWith(null);
  });

  it("survives a missing host", () => {
    const controller = readOnlyController(() => null, () => "a.glb");
    expect(controller.getView()).toBeNull();
    expect(() => controller.applyView(null)).not.toThrow();
  });

  it("reports the label it was given", () => {
    expect(readOnlyController(() => null, () => "haus.glb").label()).toBe("haus.glb");
  });
});
