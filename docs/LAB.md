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

Refine case R07 depends on the model keeping the part name `Bein-1` when it replaces the leg, either with `remove` plus `add` or with a `change` that carries `shape` and `size`; a model that renames it fails that case by construction. The dry run answers R07 with `remove` plus `add`; the shape-change variant is a second canned answer in `tests/helpers/shapes-refine-answers.ts`, and both are tested against the check.

## Rules

- Rows below come only from complete runs. A run that failed or was aborted is "not measured", with the reason, and never a failure count.
- One request per case (n=1), no retries, the same as the spike.
- Contention: other sessions may use the same model server. Never unload someone else's model, and check who is using it before a run. A run that breaks off because of contention is "not measured".
- A measured number goes into `MEASUREMENTS` in `src/core/shapes/quality.ts` only from a complete run, with its date, its source and its `promptSha`. The table shows only rows whose `promptSha` equals the shipped prompt (the test fails otherwise). A prompt change RETIRES the old rows: move them to "Retired rows" below, with their `promptSha`, and measure again. "Never overwrite with a lower number" applies only to re-runs of the same prompt: both numbers are reported.
- `promptSha` is the first 16 hex characters of SHA-256 over the system prompt immediately followed by the user message produced by the real `build*Messages` function for a fixed input (rule and code: `tests/helpers/prompt-sha.ts`). Every lab record and the summary line carry it. The two 2026-10-03 refine fixtures were recorded before this field existed and carry none; the table rows carried it (the refine prompt changed on 2026-10-03 and those rows are retired, see below). The spike create rows use the create hash by the same rule (the spike's user message was the plain prompt).
- Fixtures live in `tests/fixtures/shapes-lab/<model-short>-<task>-<date>[-<promptSha8>].jsonl`, one file per run. Each record has `answerTruncated: true` when the stored answer was cut at 6000 characters (none of the recorded answers was).
- The lab trims `SHAPES_LAB_MODEL`. Endpoints that need an authorization header (token endpoints) are not supported by the harness yet.
- Sampling: the runs used temperature 0.2, `max_tokens` 14000 and no `response_format`; the panel must send the same or measure again.

## Runs

| Date | Model | Task | Result (good of total) | Duration | Notes |
|---|---|---|---|---|---|
| 2026-10-03 | qwen/qwen3.8-27b | refine | 8 of 8 | about 21.5 min | Temperature 0.2, n=1 per case. Case R08 took 542 s. The first attempt of the same run failed at 301 s with `UND_ERR_HEADERS_TIMEOUT` (`fetch` caps the wait for headers); the harness was fixed to use `node:http`. That attempt is not a row, because infrastructure errors make a run incomplete. Fixture: `tests/fixtures/shapes-lab/qwen3.8-27b-refine-2026-10-03.jsonl` |
| 2026-10-03 | google/gemma-4-e4b | refine | 6 of 8 | about 7.5 min | Temperature 0.2, n=1 per case. R01 bad (the answer was applied, the check failed). R07 bad: the model used `change` to switch `Bein-1` to a cylinder, which the change language rejects; `remove` plus `add` is required. Fixture: `tests/fixtures/shapes-lab/gemma-4-e4b-refine-2026-10-03.jsonl` |
| 2026-10-03 | qwen/qwen3.8-27b | refine | 8 of 8 | about 22.8 min | New refine prompt (`promptSha` `71051822eb114cf6`, shape on `change`), measured on code f514a5e, temperature 0.2, n=1 per case; R01 277 s, R04 298 s, R08 518 s, all good. Same number as the retired row. Fixture: `tests/fixtures/shapes-lab/qwen3.8-27b-refine-2026-10-03-71051822.jsonl` |
| 2026-10-03 | google/gemma-4-e4b | refine | 6 of 8 | about 7.3 min | New refine prompt (`promptSha` `71051822eb114cf6`), temperature 0.2, n=1 per case. R01 bad as before (applied, check failed). R07 good now: the shape change `change` + `shape` + `size` works. R08 bad, new: four `add`s without `size`, refused all-or-nothing ("`size` is missing"); R08 was good under the old prompt, and with n=1 this cannot be told apart from variation or a prompt effect. Same total, different cases. Fixture: `tests/fixtures/shapes-lab/gemma-4-e4b-refine-2026-10-03-71051822.jsonl` |
| 2026-10-03 | qwen/qwen3.8-27b | create | 9 of 10 | about 61 min | Temperature 0.2, n=1 per prompt, 150 to 809 s per prompt. Control run through the production code; it reproduces the spike's 9 of 10 (A07 bad again: house dimensions out of range). Same number as the spike row, so it does not replace it. Fixture: `tests/fixtures/shapes-lab/qwen3.8-27b-create-2026-10-03.jsonl` |
| 2026-10-03 | Apple Foundation Models (via local shim) | create, refine | not measured, no shim running | none | No listener on the known ports and no shim was started. Not a failure count, and no entry in `MEASUREMENTS`, so the panel never shows a number for it. |

The two refine rows above were measured with the previous REFINE_SYSTEM (`remove` plus `add` for a shape change) and are retired; see "Retired rows".

All five fixtures are replayed in the test gate: the refine counts in `tests/core/shapes/quality-refine-replay.test.ts`, the create control run (9 of 10, A07 bad) in `tests/core/shapes/quality.test.ts`, each by feeding the recorded answer through the production path (`runRefineCase` and `runCreateCase` with an injected chat). Answers are stored truncated to 6000 characters; no recorded answer reached that length, so every one replays in full. The lab run itself stays outside the gate.

"Applied correctly" means the literal check of the case passed, not that the result is what a person would call right. Case R04 accepts a drawer at z=0, and R01 checks only the height of the tabletop, not that the legs follow. A stricter R04 would make gemma 5 of 8. The checks stay as they are, so the numbers stay comparable.

## Retired rows

Rows whose prompt was changed after the measurement move here, with the `promptSha` they were measured with.

| Retired | Model | Task | Result | `promptSha` | Date | Reason |
|---|---|---|---|---|---|---|
| 2026-10-03 | qwen/qwen3.8-27b | refine | 8 of 8 | `8bd865943b3454d1` | 2026-10-03 | retired 2026-10-03: REFINE_SYSTEM changed (shape on change); re-measured 2026-10-03 under the new prompt, see Runs |
| 2026-10-03 | google/gemma-4-e4b | refine | 6 of 8 | `8bd865943b3454d1` | 2026-10-03 | retired 2026-10-03: REFINE_SYSTEM changed (shape on change); re-measured 2026-10-03 under the new prompt, see Runs |

The fixtures of the retired rows stay in the repository. Replaying them documents the behaviour of the OLD prompt (the reader and applier regression test in `tests/core/shapes/quality-refine-replay.test.ts` still expects 8 and 6, because those answers contain no `shape` key on `change`); it is no longer tied to the table. The old prompt told the model to replace a part with `remove` plus `add`; the new one lets `change` carry `shape` (with a `size` for the new form), which case R07 needs.

Current prompts: create `6d29c7c76d4532f2`, refine `71051822eb114cf6`. The quality table now shows the two refine rows measured with this prompt (the two runs above). For a model without a refine row, the panel text for refine is the plain "Not measured for this model." only when no small-model refine row exists; with one (as now) it is the refine reference sentence (gemma-4-e4b, 6 of 8). A create statistic is never shown for refine.
