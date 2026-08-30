import { describe, expect, it } from "vitest";
import { decideLighting } from "../../src/core/lighting";

describe("decideLighting", () => {
  // Achse 1: `lighting` bestimmt Umgebung und Kurve — allein.
  it("schaltet bei 'off' Umgebung und Tone Mapping ab", () => {
    const plan = decideLighting("off", "prefer", false);
    expect(plan.environment).toBe(false);
    expect(plan.toneMapping).toBe("none");
  });

  it("nimmt bei 'faithful' die farbtreue Kurve", () => {
    const plan = decideLighting("faithful", "prefer", false);
    expect(plan.environment).toBe(true);
    expect(plan.toneMapping).toBe("neutral");
  });

  it("nimmt bei 'contrast' die filmische Kurve", () => {
    const plan = decideLighting("contrast", "prefer", false);
    expect(plan.environment).toBe(true);
    expect(plan.toneMapping).toBe("aces");
  });

  // Achse 2: `fillLights` haengt allein an modelLights x modelHasOwnLights.
  it("tritt zurueck, wenn das Modell eigene Lichter hat und sie bevorzugt werden", () => {
    expect(decideLighting("faithful", "prefer", true).fillLights).toBe(false);
  });

  it("leuchtet aus, wenn das Modell keine eigenen Lichter hat", () => {
    expect(decideLighting("faithful", "prefer", false).fillLights).toBe(true);
  });

  it("leuchtet aus, wenn Autorenlichter ignoriert werden sollen", () => {
    expect(decideLighting("faithful", "ignore", true).fillLights).toBe(true);
  });

  it("leuchtet aus, wenn weder Lichter da sind noch bevorzugt werden", () => {
    expect(decideLighting("faithful", "ignore", false).fillLights).toBe(true);
  });

  // Die Achsen kreuzen sich nicht: 'off' schaltet die Fuelllichter NICHT mit ab.
  // Sonst waere ein Modell mit eigener Beleuchtung bei 'off' unsichtbar.
  it("laesst die Achsen unabhaengig — 'off' loescht die Fuelllichter nicht", () => {
    expect(decideLighting("off", "ignore", true).fillLights).toBe(true);
    expect(decideLighting("off", "prefer", true).fillLights).toBe(false);
  });
});
