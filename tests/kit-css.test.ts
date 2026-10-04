// Kit-Vertrag: die CSS-Konstanten der gevendorten Kit-Bausteine gehoeren WORTGLEICH in die styles.css des
// Plugins (vendored wird nur das Verhalten, die Darstellung ist eine Kopie). Fehlt eine, sieht der Baustein
// ohne Fehlermeldung kaputt aus (kein Status-Icon, kein Layout). Jede `*_CSS`-Konstante unter src/vendor muss
// als Teilstring in styles.css stehen.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLLAPSIBLE_CSS } from "../src/vendor/kit-obsidian/collapsible";
import { ENDPOINT_LIST_CSS } from "../src/vendor/kit-obsidian/endpoint-list";
import { HUB_CSS } from "../src/vendor/kit-obsidian/hub";
import { REQUEST_SECTION_CSS } from "../src/vendor/kit-obsidian/request-section";
import { STREAM_AREA_CSS } from "../src/vendor/kit-obsidian/stream-area";
import { VERSION_LIST_CSS } from "../src/vendor/kit-obsidian/version-list";

const CONSTANTS: Record<string, string> = { COLLAPSIBLE_CSS, ENDPOINT_LIST_CSS, HUB_CSS, REQUEST_SECTION_CSS, STREAM_AREA_CSS, VERSION_LIST_CSS };

const root = join(__dirname, "..");
const styles = readFileSync(join(root, "styles.css"), "utf8");
const vendorDir = join(root, "src/vendor/kit-obsidian");
const modules = readdirSync(vendorDir).filter((f) => f.endsWith(".ts"));

describe("kit CSS constants are copied into styles.css", () => {
  const found: { name: string; module: string }[] = [];
  for (const m of modules) {
    for (const hit of readFileSync(join(vendorDir, m), "utf8").matchAll(/export const ([A-Z_]+_CSS)\b/g)) found.push({ name: hit[1], module: m });
  }
  it("finds the vendored constants (the guard itself must be able to find something)", () => {
    expect(found.map((f) => f.name).sort()).toEqual(
      ["COLLAPSIBLE_CSS", "ENDPOINT_LIST_CSS", "HUB_CSS", "REQUEST_SECTION_CSS", "STREAM_AREA_CSS", "VERSION_LIST_CSS"],
    );
  });
  for (const { name, module } of found) {
    it(`${name} (${module}) is in styles.css verbatim`, () => {
      // Eine neu gevendorte Konstante muss hier ergaenzt werden (der Test oben schlaegt sonst an).
      expect(typeof CONSTANTS[name]).toBe("string");
      expect(styles.includes(CONSTANTS[name].trim())).toBe(true);
    });
  }
});
