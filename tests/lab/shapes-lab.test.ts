// Messlauf gegen ein echtes Modell — NICHT Teil des Gates: läuft nur mit gesetzten SHAPES_LAB_*-Variablen
// (oder SHAPES_LAB_DRY=1 ohne HTTP) und erscheint sonst als "skipped". Protokoll und Aufruf: docs/LAB.md.
// Ergebnis: eine JSONL-Zeile je Fall + eine Summary-Zeile (nach SHAPES_LAB_OUT, falls gesetzt) und stdout.
// Die Summary-Zeile ist der einzige Vollständigkeitsbeleg; ein unvollständiger Lauf lässt den Test scheitern.
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREATE_CASES, REFINE_CASES } from "../helpers/shapes-cases";
import { dryChat, httpChat, readLabEnv, runCreateCase, runRefineCase, summarize, CASE_TIMEOUT_MS } from "../helpers/shapes-lab-run";

const env = readLabEnv(process.env);
const HOUR = 3_600_000;
const timeoutFor = (n: number, floor = 0): number => Math.max(floor, n * CASE_TIMEOUT_MS + 600_000);

describe.runIf(env.active)("shapes lab", () => {
  it.runIf(env.active && !env.ok)("environment is valid", () => {
    expect(env.active && !env.ok ? env.problems : []).toEqual([]);
  });

  for (const task of ["create", "refine"] as const) {
    const cases = task === "create" ? CREATE_CASES : REFINE_CASES;
    it.runIf(env.active && env.ok && env.task === task)(task, async () => {
      if (!env.active || !env.ok) return;
      const ctx = { run: `${new Date().toISOString()} ${env.dry ? "dry" : env.model} ${task}`, dry: env.dry };
      const http = httpChat(env.url, env.model, env.temperature);
      const emit = (rec: object): void => {
        const line = JSON.stringify({ at: new Date().toISOString(), model: env.dry ? "dry" : env.model, task, temperature: env.temperature, ...rec });
        if (env.out) appendFileSync(env.out, `${line}\n`);
        console.log(line);
      };
      const recs: Record<string, unknown>[] = [];
      for (const c of cases) {
        const chat = env.dry ? dryChat(task, c.id) : http;
        const rec = task === "create"
          ? await runCreateCase(c as (typeof CREATE_CASES)[number], chat, ctx)
          : await runRefineCase(c as (typeof REFINE_CASES)[number], chat, ctx);
        recs.push(rec);
        emit(rec);
      }
      const { summary, line } = summarize(recs, { ...ctx, model: env.dry ? "dry" : env.model, task });
      emit(summary);
      console.log(line);
      expect(summary.complete, line).toBe(true);
    }, timeoutFor(cases.length, task === "create" ? 3 * HOUR : 0));
  }
});
