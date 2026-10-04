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
      endpoints: [],
      llmModel: "",
      request: { overrides: {}, thinking: {}, lastOnLevel: {}, levelPickerInChat: false },
      acceptAs: "block",
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

// Plan 3b Task 3: Felder der LLM-Anbindung.
describe("validateSettings: prompt settings", () => {
  // Echte data.json eines Installs vor Plan 3b: keines der neuen Felder.
  const PRE_3B = {
    viewMode: "on-click",
    defaultHeight: 320,
    autoRotate: true,
    showGrid: true,
    maxContexts: 4,
    panelPlacement: "toolbar",
    lockedNodePrefixes: "env__, sky__",
    allowExternalResources: true,
    lighting: "contrast",
    modelLights: "ignore",
  };

  it("defaults the prompt settings", () => {
    const s = validateSettings({});
    expect(s.acceptAs).toBe("block");
    expect(s.endpoints).toEqual([]);
    expect(s.llmModel).toBe("");
    expect(s.endpointChoice).toBeUndefined();
    expect(s.request).toEqual({ overrides: {}, thinking: {}, lastOnLevel: {}, levelPickerInChat: false });
  });

  it("rejects an unknown acceptAs value and keeps the three known ones", () => {
    expect(validateSettings({ acceptAs: "clipboard" }).acceptAs).toBe("block");
    for (const v of ["block", "file", "ask"] as const) expect(validateSettings({ acceptAs: v }).acceptAs).toBe(v);
  });

  it("loads a pre-3b data.json with all old values and the new defaults", () => {
    const s = validateSettings(PRE_3B);
    expect(s).toMatchObject(PRE_3B);
    expect(s.acceptAs).toBe("block");
    expect(s.endpoints).toEqual([]);
    expect(s.llmModel).toBe("");
  });

  it("accepts endpoints only as an array", () => {
    expect(validateSettings({ endpoints: "http://x" }).endpoints).toEqual([]);
    expect(validateSettings({ endpoints: { url: "http://x" } }).endpoints).toEqual([]);
  });

  // Form, die das Kit erzeugt: `<pluginId>-ep-<uuid>` (endpoint-secrets.ts, secretIdFor).
  const UUID = "2b9c8e4e-5f3a-4c47-9a53-0d6a1c3f7e11";
  const SECRET = `three-d-codeblocks-ep-${UUID}`;

  it("round-trips an endpoint entry with id and secretId (keychain reference survives)", () => {
    const stored = validateSettings({
      endpoints: [{ url: "http://localhost:1234/v1", id: UUID, secretId: SECRET, model: "m" }],
      endpointChoice: { endpointId: UUID, model: "m" },
      llmModel: "m",
    });
    const reloaded = validateSettings(JSON.parse(JSON.stringify(stored)));
    expect(reloaded.endpoints).toEqual([
      { url: "http://localhost:1234/v1", id: UUID, secretId: SECRET, model: "m" },
    ]);
    expect(reloaded.endpointChoice).toEqual({ endpointId: UUID, model: "m" });
    expect(reloaded.llmModel).toBe("m");
  });

  it("lets a legacy plaintext apiKey entry pass so the kit migration can move it", () => {
    const s = validateSettings({ endpoints: [{ url: "http://localhost:1234/v1", apiKey: "test-key" }] });
    expect(s.endpoints).toEqual([{ url: "http://localhost:1234/v1", apiKey: "test-key" }]);
  });

  it("drops garbage endpoint entries without losing the good ones", () => {
    const s = validateSettings({ endpoints: [null, 5, { url: "  " }, { url: "http://a/v1", id: "x" }] });
    expect(s.endpoints).toEqual([{ url: "http://a/v1", id: "x" }]);
  });

  it("falls back for a malformed endpointChoice, llmModel and request", () => {
    const s = validateSettings({ endpointChoice: "x", llmModel: 5, request: { levelPickerInChat: "yes", overrides: 3 } });
    expect(s.endpointChoice).toBeUndefined();
    expect(s.llmModel).toBe("");
    expect(s.request).toEqual({ overrides: {}, thinking: {}, lastOnLevel: {}, levelPickerInChat: false });
  });

  it("keeps a valid request block", () => {
    const s = validateSettings({ request: { levelPickerInChat: true } });
    expect(s.request.levelPickerInChat).toBe(true);
  });
});

describe("validateSettings: malformed endpoint entries never throw", () => {
  const UUID = "2b9c8e4e-5f3a-4c47-9a53-0d6a1c3f7e11";
  const eps = (e: unknown[]) => validateSettings({ endpoints: e }).endpoints;

  it("drops a non-string url entry", () => {
    expect(() => eps([{ url: 5 }])).not.toThrow();
    expect(eps([{ url: 5 }])).toEqual([]);
  });
  it("drops a non-string apiKey, keeping the entry", () => {
    expect(eps([{ url: "x", apiKey: 5 }])).toEqual([{ url: "x" }]);
  });
  it("drops a non-string model, keeping the entry", () => {
    expect(eps([{ url: "x", model: 5 }])).toEqual([{ url: "x" }]);
  });
  it("drops non-string id and secretId", () => {
    expect(eps([{ url: "x", id: 7, secretId: { a: 1 } }])).toEqual([{ url: "x" }]);
  });
  it("keeps a valid string id when only secretId is malformed, and vice versa", () => {
    expect(eps([{ url: "x", id: UUID, secretId: 3 }])).toEqual([{ url: "x", id: UUID }]);
    expect(eps([{ url: "x", id: 3, secretId: "s" }])).toEqual([{ url: "x", secretId: "s" }]);
  });
  it("leaves a valid entry unchanged", () => {
    const e = { url: "http://a/v1", id: UUID, secretId: `three-d-codeblocks-ep-${UUID}`, model: "m" };
    expect(eps([e])).toEqual([e]);
  });
  it("tolerates null, numbers, arrays and strings among entries", () => {
    expect(() => eps([null, 5, [1], undefined, true])).not.toThrow();
    expect(eps([null, 5, [1], "http://s/v1"])).toEqual([{ url: "http://s/v1" }]);
  });
});
