/**
 * Linearität der Funktionen, die Vault- oder Modelltext zerlegen (ReDoS-Konvention, CORE-TEST-26 (b)): der erschöpfende Fuzz `pruefeLinearFuzz`
 * aus dem Kit-Testmodul. Gemessen wird ein Quotient t(50 000)/t(10 000), keine Millisekunden.
 *
 * Geprüft sind die Wege, auf denen Text von außen in den Kern kommt: der shapes-Quelltext der Datei (`parseShapes`), die Notizen des Vaults auf der Suche nach Verweisen (`findModelReferences`), die Ansichtsangabe im Block (`parseView`) und die Modellantwort (`readPartsAnswer`). Feste Eingaben für `readPartsAnswer`, `diffParts` und
 * `applyChanges` (dessen Zeilenaufteilung und `parseShapes` auf dem Text der Datei; ein Fuzz darauf kippte nur unter Rechnerlast über 120, direkt gemessen linear) stehen in `shapes/protocol.test.ts`, `shapes/diff.test.ts` und `shapes/changes.test.ts`.
 *
 * Nicht Gegenstand: `extractJsonCandidates` (Kit, dort mit eigenem Fuzz) und `shapesBlock` (ruft seit Welle 36 `wrapInFence` des Kits; dessen `/\n+$/` ist quadratisch bei einem langen Lauf von Zeilenumbrüchen mitten im Text,
 * gemessen 2026-11-19: n = 1 000 → 0,7 ms, n = 10 000 → 98 ms; Fix und Fuzz gehören ins Kit, Task im code-kit-Cockpit). Die Gegenprobe (eine absichtlich quadratische Fassung wird rot) steht am Ende.
 */
import { describe, expect, it } from "vitest";
import { pruefeLinearFuzz } from "../vendor/kit/linear-probe";
import { parseShapes } from "../../src/core/shapes/parse";
import { findModelReferences } from "../../src/core/shapes/references";
import { readPartsAnswer } from "../../src/core/shapes/protocol";
import { parseView } from "../../src/core/view-spec";

const FUZZ_MS = 180_000;

/** Befund als lesbarer Text, damit eine rote Zeile ohne Nachlesen verständlich ist (CORE-TEST-14). */
const befund = (r: { verdaechtig: ReadonlyArray<{ message: string }> }): string => r.verdaechtig.map((v) => v.message).join("\n");
const fuzz = (fn: (s: string) => unknown, alphabet: readonly string[], maxLaenge = 3): void => {
  const f = pruefeLinearFuzz(fn, { alphabet, maxLaenge });
  expect(f.linear, befund(f)).toBe(true);
  // Eine Bilanz ohne Messung ist kein Erfolg (CORE-TEST-19).
  expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
};

describe("shapes-Quelltext aus der Datei", () => {
  it("parseShapes: Fuzz über Leerraum, Zeilenumbruch, Wagenrücklauf, Kommentar und Zahlen", () => {
    fuzz(parseShapes, ["\n", " ", "box", "#", "1"]);
  }, FUZZ_MS);
});

describe("Vault-Notizen auf der Suche nach Verweisen", () => {
  it("findModelReferences: Fuzz über Zäune, Verweisklammern, Leerraum und Zeilenumbruch (Text der Notiz)", () => {
    const resolve = (link: string): string | null => (link === "m.glb" ? "m.glb" : null);
    fuzz((s) => findModelReferences([{ path: "n.md", text: s }], "m.glb", resolve), ["```", "![[", "]]", "![", "\n", " "]);
  }, FUZZ_MS);
});

describe("Ansichtsangabe und Modellantwort", () => {
  it("parseView: Fuzz über Präfix, Doppelpunkt, Leerraum und Zahlen", () => {
    fuzz(parseView, ["camera:", " ", ":", "1", "-"]);
  }, FUZZ_MS);

  it("readPartsAnswer: Fuzz über Think-Marken, Zäune, Klammern und Anführungszeichen", () => {
    fuzz(readPartsAnswer, ["<think>", "```json\n", "{", "[", '"', "\\"]);
  }, FUZZ_MS);
});

describe("Gegenprobe: der Fuzz kann rot werden (CORE-TEST-01)", () => {
  /** Absichtlich quadratisch: ein Lauf von Zeilenumbrüchen mitten im Text, den ein `\n*$` je Startstelle neu abläuft. */
  const quadratisch = (s: string): string => `x\n${s}\ny`.replace(/\n*$/, "\n");

  it("pruefeLinearFuzz meldet die quadratische Form als Verdacht", () => {
    const f = pruefeLinearFuzz((s) => quadratisch(s), { alphabet: ["\n", "x"], maxLaenge: 1, verschachtelt: false });
    expect(f.linear).toBe(false);
    expect(f.verdaechtig.map((v) => v.einheit)).toContain("\n");
  }, FUZZ_MS);
});
