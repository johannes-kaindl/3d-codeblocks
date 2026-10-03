// Messlauf gegen ein echtes Modell — NICHT Teil des Gates: läuft nur mit SHAPES_LAB_URL + SHAPES_LAB_MODEL
// (oder SHAPES_LAB_DRY=1 ohne HTTP) und erscheint sonst als "skipped". Protokoll und Aufruf: docs/LAB.md.
// Ergebnis: eine JSONL-Zeile je Fall (nach SHAPES_LAB_OUT, falls gesetzt) + eine Zusammenfassung auf stdout.
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFINE_CASES, CREATE_CASES } from "../helpers/shapes-cases";
import { dryChat, httpChat, runCreateCase, runRefineCase, type Chat } from "../helpers/shapes-lab-run";

const URL_ = process.env.SHAPES_LAB_URL ?? "";
const MODEL = process.env.SHAPES_LAB_MODEL ?? "";
const TASK = process.env.SHAPES_LAB_TASK ?? "create";
const OUT = process.env.SHAPES_LAB_OUT ?? "";
const DRY = process.env.SHAPES_LAB_DRY === "1";
const TEMPERATURE = Number(process.env.SHAPES_LAB_TEMPERATURE ?? "0.2");

function record(rec: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), model: DRY ? "dry" : MODEL, task: TASK, temperature: TEMPERATURE, ...rec });
  if (OUT) appendFileSync(OUT, `${line}\n`);
  console.log(line);
}

const enabled = DRY || (URL_ !== "" && MODEL !== "");
const http: Chat = httpChat(URL_, MODEL, TEMPERATURE);

describe.runIf(enabled)(`shapes lab: ${DRY ? "dry" : MODEL} ${TASK}`, () => {
  it.runIf(TASK === "create")("create", async () => {
    let good = 0;
    for (const c of CREATE_CASES) {
      const rec = await runCreateCase(c, DRY ? dryChat("create", c.id) : http);
      if (rec.good) good += 1;
      record(rec);
    }
    console.log(`SUMMARY create ${DRY ? "dry" : MODEL}: ${good} of ${CREATE_CASES.length}`);
    expect(true).toBe(true);
  }, 7_200_000);

  it.runIf(TASK === "refine")("refine", async () => {
    let good = 0;
    for (const c of REFINE_CASES) {
      const rec = await runRefineCase(c, DRY ? dryChat("refine", c.id) : http);
      if (rec.good) good += 1;
      record(rec);
    }
    console.log(`SUMMARY refine ${DRY ? "dry" : MODEL}: ${good} of ${REFINE_CASES.length}`);
    expect(true).toBe(true);
  }, 7_200_000);
});
