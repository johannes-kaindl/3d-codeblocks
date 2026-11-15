import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findVendoredCss, missingKitCss } from "./vendor/kit/kit-css";

// Kit-Vertrag: vendort wird das Verhalten, die Darstellung (`*_CSS`) ist eine Kopie in styles.css.
describe("Kit-CSS in styles.css", () => {
  const vendorDir = "src/vendor/kit-obsidian";
  it("der Waechter findet gevendorte Konstanten", () => {
    expect(findVendoredCss(vendorDir).length).toBeGreaterThan(0);
  });
  it("styles.css trägt kein ${…} (ein Rohtext-Kopieren einer Kit-Konstante mit Template-Einsatz wäre ungültiges CSS: Store „Unknown word“)", () => {
    expect(readFileSync("styles.css", "utf8")).not.toContain("${");
  });
  it("die Knopfzeile der Seitenleiste bricht um (deutsche Beschriftungen laufen sonst rechts aus der Leiste)", () => {
    const block = /\.tdcb-panel-actions\s*\{([^}]*)\}/.exec(readFileSync("styles.css", "utf8"));
    expect(block?.[1]).toMatch(/flex-wrap:\s*wrap/);
  });
  it("jede steht wortgleich in styles.css", () => {
    expect(missingKitCss(vendorDir, readFileSync("styles.css", "utf8"))).toEqual([]);
  });
});
