import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings, parseLockedPrefixes } from "../../src/core/settings-types";

describe("validateSettings", () => {
  it("returns the defaults for null or undefined", () => {
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("has sensible defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      viewMode: "immediate",
      defaultHeight: 400,
      autoRotate: false,
      showGrid: false,
      maxContexts: 6,
      panelPlacement: "auto",
      lockedNodePrefixes: "env__",
      allowExternalResources: false,
      lighting: "faithful",
      modelLights: "prefer",
    });
  });

  it("keeps stored values", () => {
    expect(validateSettings({ defaultHeight: 250 }).defaultHeight).toBe(250);
  });

  it("drops an unknown view mode", () => {
    expect(validateSettings({ viewMode: "sideways" }).viewMode).toBe("immediate");
  });

  it("drops a non-positive height", () => {
    expect(validateSettings({ defaultHeight: 0 }).defaultHeight).toBe(400);
    expect(validateSettings({ defaultHeight: "tall" }).defaultHeight).toBe(400);
  });

  it("allows 0 (off) and clamps the top to 12", () => {
    expect(validateSettings({ maxContexts: 0 }).maxContexts).toBe(0);
    expect(validateSettings({ maxContexts: 13 }).maxContexts).toBe(12);
    expect(validateSettings({ maxContexts: 999 }).maxContexts).toBe(12);
  });

  it("rejects a negative maxContexts back to the default", () => {
    expect(validateSettings({ maxContexts: -3 }).maxContexts).toBe(6);
  });

  it("ignores unknown keys", () => {
    expect(validateSettings({ nope: true })).toEqual(DEFAULT_SETTINGS);
  });
});

describe("panelPlacement", () => {
  it("defaults to auto", () => {
    expect(validateSettings({}).panelPlacement).toBe("auto");
  });

  it("keeps a valid value", () => {
    expect(validateSettings({ panelPlacement: "toolbar" }).panelPlacement).toBe("toolbar");
  });

  it("falls back to the default for garbage", () => {
    expect(validateSettings({ panelPlacement: "somewhere" }).panelPlacement).toBe("auto");
    expect(validateSettings({ panelPlacement: 7 }).panelPlacement).toBe("auto");
  });
});

describe("lockedNodePrefixes", () => {
  it("Default env__, fremde Typen fallen auf den Default", () => {
    expect(validateSettings({}).lockedNodePrefixes).toBe("env__");
    expect(validateSettings({ lockedNodePrefixes: 42 }).lockedNodePrefixes).toBe("env__");
    expect(validateSettings({ lockedNodePrefixes: "sky__, env__" }).lockedNodePrefixes).toBe("sky__, env__");
    expect(validateSettings({ lockedNodePrefixes: "" }).lockedNodePrefixes).toBe("");
  });
});

describe("parseLockedPrefixes", () => {
  it("splittet an Kommas, trimmt, verwirft Leeres", () => {
    expect(parseLockedPrefixes("env__, sky__ ,,")).toEqual(["env__", "sky__"]);
    expect(parseLockedPrefixes("")).toEqual([]);
  });
});

describe("allowExternalResources", () => {
  it("defaults to off — the vault is the only source until the user says otherwise", () => {
    expect(DEFAULT_SETTINGS.allowExternalResources).toBe(false);
  });

  it("keeps an explicit true", () => {
    expect(validateSettings({ allowExternalResources: true }).allowExternalResources).toBe(true);
  });

  it("falls back to the default for a non-boolean, rather than treating it as truthy", () => {
    expect(validateSettings({ allowExternalResources: "yes" }).allowExternalResources).toBe(false);
    expect(validateSettings({ allowExternalResources: 1 }).allowExternalResources).toBe(false);
  });
});

describe("Beleuchtungs-Felder", () => {
  it("liefert die Defaults aus der Spec", () => {
    expect(DEFAULT_SETTINGS.lighting).toBe("faithful");
    expect(DEFAULT_SETTINGS.modelLights).toBe("prefer");
  });

  it("nimmt gueltige Werte an", () => {
    const s = validateSettings({ lighting: "contrast", modelLights: "ignore" });
    expect(s.lighting).toBe("contrast");
    expect(s.modelLights).toBe("ignore");
  });

  // Der eigentliche Punkt von `oneOf`: eine handgeschriebene oder veraltete data.json
  // darf keinen Muellwert in den Renderpfad durchreichen.
  it("faellt bei unbekannten Werten auf den Default zurueck", () => {
    const s = validateSettings({ lighting: "cinematic", modelLights: 42 });
    expect(s.lighting).toBe("faithful");
    expect(s.modelLights).toBe("prefer");
  });
});
