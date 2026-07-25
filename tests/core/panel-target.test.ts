import { describe, expect, it } from "vitest";
import { resolvePanelTarget } from "../../src/core/panel-target";

describe("resolvePanelTarget", () => {
  it("uses the panel and nothing else when set to sidebar", () => {
    expect(resolvePanelTarget("sidebar", true)).toBe("panel");
    expect(resolvePanelTarget("sidebar", false)).toBe("none");
  });

  it("always uses the toolbar when set to toolbar", () => {
    expect(resolvePanelTarget("toolbar", true)).toBe("toolbar");
    expect(resolvePanelTarget("toolbar", false)).toBe("toolbar");
  });

  it("falls back from panel to toolbar when set to auto", () => {
    expect(resolvePanelTarget("auto", true)).toBe("panel");
    expect(resolvePanelTarget("auto", false)).toBe("toolbar");
  });
});
