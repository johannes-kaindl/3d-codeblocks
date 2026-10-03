// Golden-Tests über die Antworten aus Spike A (2026-10-01): dieselben LLM-Antworten laufen
// durch den Produktionsweg readPartsAnswer → partsFromLlm → formatShapes → convertShapesText
// → loadModel. Die Grenzen je Prompt sind die VORAB festgelegten des Spikes; A01 ist um die
// Lochprüfung verschärft (mindestens vier Teile um die Lücke), die im Spike fehlte.
//
// Drei Fixtures statt der zwei, die der Bauauftrag nannte: a-q27-dsl.jsonl enthält für A04 einen
// Netzwerkfehler-Satz ohne Antwort („fetch failed“); der Spike hat genau diesen Eintrag selbst wiederholt
// (a-q27-dsl-rerun.jsonl). Die Rerun-Datei liegt deshalb unverändert daneben, und `readRecords` ersetzt nur
// Fehlersätze ohne Antwort durch den Satz derselben id — und wirft, wenn keiner da ist (Ruling des Masters, 2026-10-03).
import { describe, expect, it } from "vitest";
import { evaluate } from "../../helpers/shapes-spike-eval";

describe("golden: spike A answers through the production path", () => {
  it("large model (qwen3.8-27b): 10/10 load, at least 9/10 plausible", async () => {
    const r = await evaluate("a-q27-dsl.jsonl");
    expect(r).toHaveLength(10);
    expect(r.filter((o) => o.loaded)).toHaveLength(10);
    expect(r.filter((o) => o.plausible).length).toBeGreaterThanOrEqual(9);
    // Gemessen im Spike: der Würfel mit Loch besteht aus vier Boxen.
    expect(r.find((o) => o.id === "A01")?.plausible).toBe(true);
    // Gemessen im Spike: A07 Haus ist der eine nicht plausible Fall.
    expect(r.filter((o) => !o.plausible).map((o) => o.id)).toEqual(["A07"]);
  });

  it("small model (gemma-4-e4b): at least 9/10 load, the solid cube fails the hole check", async () => {
    const r = await evaluate("a-e4b-dsl.jsonl");
    expect(r.filter((o) => o.loaded).length).toBeGreaterThanOrEqual(9);
    // Gemessen im Spike: voller Würfel ohne Loch — mit Lochprüfung nicht plausibel.
    expect(r.find((o) => o.id === "A01")?.plausible).toBe(false);
  });
});
