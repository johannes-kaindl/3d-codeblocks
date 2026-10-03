# Lab: measuring shapes quality against a real model

This lab measures how well a model builds and refines 3D models with the shapes DSL, through the same production path as the panel: prompt, read the answer, convert, load, check.

It is not part of the test gate. The lab test file only runs when the environment asks for it and shows up as skipped otherwise.

## How to run

Create task (ten prompts from spike A, one request per case, no retries):

`SHAPES_LAB_URL=<chat completions URL> SHAPES_LAB_MODEL=<model id> SHAPES_LAB_TASK=create SHAPES_LAB_OUT=<file>.jsonl npx vitest run tests/lab/shapes-lab.test.ts`

Refine task (eight change requests on a fixed table, answered as a change list): set `SHAPES_LAB_TASK=refine`.

Environment variables:

- `SHAPES_LAB_URL` and `SHAPES_LAB_MODEL`: endpoint and model id, both required for a real run.
- `SHAPES_LAB_TASK`: `create` (default) or `refine`.
- `SHAPES_LAB_OUT`: optional JSONL file that receives one line per case. Nothing else is written outside the repository.
- `SHAPES_LAB_TEMPERATURE`: default `0.2`. Requests use `max_tokens` 14000 and `stream: false`.
- `SHAPES_LAB_DRY=1`: runs the whole pipeline without any HTTP call, using canned answers (golden fixtures for create, hand-authored correct change lists for refine). Use it to check the harness itself.

Each JSONL line records the case id, duration in ms, HTTP status or error, the first 6000 characters of the answer, and the outcome (`good`). For refine it also records the entries the reader dropped and the problems found when applying. Refine is all-or-nothing: if any entry of the answer is unusable, the case fails and the reasons are recorded.

## Reading a run

Every case record has an `outcome`: `good`, `bad` (the model answered, the result is not good), `timeout` (the case ran longer than 15 minutes; a labelled result that counts as not good) or `infra` (connection error, HTTP status other than 200, or a 200 response without text content; nothing was measured). An answer cut off by the token budget (`finish_reason: length`) is the model's failure and counts as `bad`, also for a reasoning model whose `content` is null (the case records `reasoningChars`, not the reasoning text). A null `content` without `finish_reason: length` is `infra`.

The final line of the JSONL file is the summary: `{"summary": true, "run": …, "complete": …, "good": …, "of": …, "timeouts": …, "infraErrors": …, "dry": …}`. `complete` is true only when every case got a model answer (no `infra`). The summary line is the only evidence that a run is complete, and a partial JSONL file never counts: a table row needs `complete: true` in the summary line and `dry: false`. An incomplete run makes the lab test fail and is "not measured".

Use one OUT file per run. A reader matches the summary's `run` to the case lines of the same run: a later run that was killed does not own the summary of an earlier one in the same file.

The harness posts with `node:http` and not with `fetch`. Measured on 2026-10-03: a refine case that generated for more than 300 s failed with `UND_ERR_HEADERS_TIMEOUT`, because `fetch` (undici) caps the wait for response headers at 300 s and a non-streaming server only sends headers when generation is done. `node:http` has no such cap, so the 15-minute per-case limit really is 15 minutes. A case slower than that is recorded as `timeout`, a legitimate labelled result that counts as not good and does not make the run incomplete.

The lab test fails loudly on bad environment values (unknown task, a task spelled with different case, a temperature that is not a plain decimal between 0 and 2, a URL without a model or one that does not start with http:// or https://).

Refine case R07 depends on the model keeping the part name `Bein-1` when it replaces the leg; a model that renames it fails that case by construction.

## Rules

- Rows below come only from complete runs. A run that failed or was aborted is "not measured", with the reason, and never a failure count.
- One request per case (n=1), no retries, the same as the spike.
- Contention: other sessions may use the same model server. Never unload someone else's model, and check who is using it before a run. A run that breaks off because of contention is "not measured".
- A measured number goes into `MEASUREMENTS` in `src/core/shapes/quality.ts` only from a complete run, with its date and source. An existing entry is never overwritten by a lower number; both numbers are reported.

## Runs

| Date | Model | Task | Result (good of total) | Duration | Notes |
|---|---|---|---|---|---|
| 2026-10-03 | qwen/qwen3.8-27b | refine | 8 of 8 | about 21.5 min | Temperature 0.2, n=1 per case. Case R08 took 542 s. The first attempt of the same run failed at 301 s with `UND_ERR_HEADERS_TIMEOUT` (`fetch` caps the wait for headers); the harness was fixed to use `node:http`. That attempt is not a row, because infrastructure errors make a run incomplete. Fixture: `tests/fixtures/shapes-lab/qwen3.8-27b-refine-2026-10-03.jsonl` |
| 2026-10-03 | google/gemma-4-e4b | refine | 6 of 8 | about 7.5 min | Temperature 0.2, n=1 per case. R01 bad (the answer was applied, the check failed). R07 bad: the model used `change` to switch `Bein-1` to a cylinder, which the change language rejects; `remove` plus `add` is required. Fixture: `tests/fixtures/shapes-lab/gemma-4-e4b-refine-2026-10-03.jsonl` |
| 2026-10-03 | qwen/qwen3.8-27b | create | 9 of 10 | about 61 min | Temperature 0.2, n=1 per prompt, 150 to 809 s per prompt. Control run through the production code; it reproduces the spike's 9 of 10 (A07 bad again: house dimensions out of range). Same number as the spike row, so it does not replace it. Fixture: `tests/fixtures/shapes-lab/qwen3.8-27b-create-2026-10-03.jsonl` |
| 2026-10-03 | Apple Foundation Models (via local shim) | create, refine | not measured, no shim running | none | No listener on the known ports and no shim was started. Not a failure count, and no entry in `MEASUREMENTS`, so the panel never shows a number for it. |

The three fixtures are replayed in the test gate (`tests/core/shapes/quality-refine-replay.test.ts` for refine, `quality.test.ts` for the table): the counts in `MEASUREMENTS` are re-derived from the recorded answers through the production path. Answers are stored truncated to 6000 characters. The lab run itself stays outside the gate.
