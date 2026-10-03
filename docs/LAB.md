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

## Rules

- Rows below come only from complete runs. A run that failed or was aborted is "not measured", with the reason, and never a failure count.
- One request per case (n=1), no retries, the same as the spike.
- Contention: other sessions may use the same model server. Never unload someone else's model, and check who is using it before a run. A run that breaks off because of contention is "not measured".
- A measured number goes into `MEASUREMENTS` in `src/core/shapes/quality.ts` only from a complete run, with its date and source. An existing entry is never overwritten by a lower number; both numbers are reported.

## Runs

| Date | Model | Task | Result (good of total) | Duration | Notes |
|---|---|---|---|---|---|

No lab runs recorded yet — see CHANGELOG/Cockpit for the plan.
