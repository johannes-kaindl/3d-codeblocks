// Trockenlauf des Messlauf-Ablaufs ohne Modell: derselbe Code (runCreateCase/runRefineCase) mit
// eingespeister Chat-Funktion. Ein Fehler im Messlauf soll hier auffallen, nicht in einem echten Lauf.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CREATE_CASES, REFINE_CASES } from "../../helpers/shapes-cases";
import { changesAsAnswerText } from "../../helpers/shapes-refine-answers";
import { promptSha } from "../../helpers/prompt-sha";
import { dryChat, httpChat, readLabEnv, runCreateCase, runRefineCase, summarize, type Chat } from "../../helpers/shapes-lab-run";

describe("lab harness (dry, no model, no network)", () => {
  it("create: canned golden answers run prompt → read → convert → load → check", async () => {
    const recs = [];
    for (const c of CREATE_CASES) recs.push(await runCreateCase(c, dryChat("create", c.id)));
    expect(recs.filter((r) => r.error !== undefined && r.id !== "A07")).toEqual([]);
    expect(recs.every((r) => typeof r.parts === "number" || r.id === "A07")).toBe(true);
    // wie der Golden-Test: 9 von 10 plausibel, A07 nicht
    expect(recs.filter((r) => r.good).length).toBe(9);
    expect(recs.find((r) => r.good === false)?.id).toBe("A07");
  });

  it("refine: hand-authored correct lists run through the whole path, 8 of 8", async () => {
    const recs = [];
    for (const c of REFINE_CASES) recs.push(await runRefineCase(c, dryChat("refine", c.id)));
    expect(recs.map((r) => [r.id, r.good, r.error])).toEqual(REFINE_CASES.map((c) => [c.id, true, undefined]));
    expect(recs.every((r) => Array.isArray(r.dropped) && (r.dropped as unknown[]).length === 0)).toBe(true);
  });

  it("records a transport error without throwing", async () => {
    const failing: Chat = async () => ({ text: "", ms: 3, status: 500, error: "HTTP 500: boom" });
    const rec = await runRefineCase(REFINE_CASES[0], failing);
    expect(rec).toMatchObject({ id: "R01", good: false, outcome: "infra", status: 500, ms: 3 });
    expect(String(rec.error)).toContain("HTTP 500");
    const thrown: Chat = async () => { throw new Error("socket closed"); };
    expect(await runCreateCase(CREATE_CASES[0], thrown)).toMatchObject({ good: false, outcome: "infra", error: "socket closed" });
  });

  it("refine is all-or-nothing: a dropped item fails the case and records dropped + reasons", async () => {
    const good = JSON.parse(changesAsAnswerText([{ op: "change", name: "Platte", at: [0, 0.925, 0] }])) as { changes: unknown[] };
    good.changes.push({ op: "change", name: "Bein-1" }); // ändert nichts → vom Leser verworfen
    const chat: Chat = async () => ({ text: JSON.stringify(good), ms: 1 });
    const rec = await runRefineCase(REFINE_CASES[0], chat);
    expect(rec.good).toBe(false);
    expect(rec.dropped).toHaveLength(1);
    expect((rec.problems as string[])[0]).toContain("nothing applied");
  });

  it("an answer without usable JSON is a failed case, not an exception", async () => {
    const chat: Chat = async () => ({ text: "Sorry, no.", ms: 1 });
    expect(await runRefineCase(REFINE_CASES[1], chat)).toMatchObject({ id: "R02", good: false });
    expect(await runCreateCase(CREATE_CASES[1], chat)).toMatchObject({ id: "A02", good: false });
  });

  const ctx = { run: "test-run", dry: true };
  const sum = (recs: Record<string, unknown>[]) => summarize(recs, { ...ctx, model: "m", task: "refine" });

  it("every record carries outcome, run and dry", async () => {
    const rec = await runRefineCase(REFINE_CASES[2], dryChat("refine", "R03"), ctx);
    expect(rec).toMatchObject({ outcome: "good", good: true, run: "test-run", dry: true });
    const bad = await runRefineCase(REFINE_CASES[2], async () => ({ text: "{\"changes\":[]}", ms: 1 }), ctx);
    expect(bad).toMatchObject({ outcome: "bad", good: false });
  });

  it("records and summary carry the promptSha of their task (M/I-2)", async () => {
    const r = await runRefineCase(REFINE_CASES[2], dryChat("refine", "R03"), ctx);
    expect(r.promptSha).toBe(promptSha("refine"));
    const c = await runCreateCase(CREATE_CASES[0], dryChat("create", "A01"), ctx);
    expect(c.promptSha).toBe(promptSha("create"));
    expect(sum([r]).summary.promptSha).toBe(promptSha("refine"));
    expect(summarize([c], { ...ctx, model: "m", task: "create" }).summary.promptSha).toBe(promptSha("create"));
  });

  it("marks answerTruncated only when the 6000-char cut applied (M-9)", async () => {
    const long = await runRefineCase(REFINE_CASES[2], async () => ({ text: "x".repeat(6001), ms: 1 }), ctx);
    expect(long).toMatchObject({ answerTruncated: true });
    expect((long.answer as string).length).toBe(6000);
    const short = await runRefineCase(REFINE_CASES[2], async () => ({ text: "x".repeat(6000), ms: 1 }), ctx);
    expect(short.answerTruncated).toBeUndefined();
  });

  it("trims SHAPES_LAB_MODEL (M-9)", () => {
    const r = readLabEnv({ SHAPES_LAB_URL: "http://127.0.0.1:1/v1", SHAPES_LAB_MODEL: "  qwen/x \n" });
    expect(r.active && r.ok && r.model).toBe("qwen/x");
  });

  it("transport error and HTTP 500 are infra and make the run INCOMPLETE", async () => {
    const down: Chat = async () => ({ text: "", ms: 2, error: "connect ECONNREFUSED" });
    const e500: Chat = async () => ({ text: "", ms: 2, status: 500, error: "HTTP 500: x" });
    const recs = [await runRefineCase(REFINE_CASES[0], dryChat("refine", "R01"), ctx), await runRefineCase(REFINE_CASES[1], down, ctx), await runRefineCase(REFINE_CASES[2], e500, ctx)];
    expect(recs.map((r) => r.outcome)).toEqual(["good", "infra", "infra"]);
    const { summary, line } = sum(recs);
    expect(summary).toMatchObject({ summary: true, complete: false, good: 1, of: 3, infraErrors: 2, timeouts: 0, dry: true });
    expect(line).toBe("INCOMPLETE refine m (infra errors: 2) — not measured");
  });

  it("a response whose content is not text (array, error object, no choices) is infra", async () => {
    const shape: Chat = async () => ({ text: "", ms: 1, status: 200, error: "content is an array of parts, not text" });
    const rec = await runCreateCase(CREATE_CASES[0], shape, ctx);
    expect(rec).toMatchObject({ outcome: "infra", status: 200 });
    expect(String(rec.error)).toContain("array of parts");
  });

  it("a timeout is a labelled result and the run stays COMPLETE", async () => {
    const slow: Chat = async () => ({ text: "", ms: 900_000, timedOut: true, error: "timeout after 900 s" });
    const recs = [await runRefineCase(REFINE_CASES[0], slow, ctx), await runRefineCase(REFINE_CASES[2], dryChat("refine", "R03"), ctx)];
    expect(recs.map((r) => [r.outcome, r.good])).toEqual([["timeout", false], ["good", true]]);
    const { summary, line } = sum(recs);
    expect(summary).toMatchObject({ complete: true, good: 1, of: 2, timeouts: 1, infraErrors: 0 });
    expect(line).toBe("COMPLETE refine m: 1 of 2 (timeouts: 1)");
  });

  it("empty content with finish_reason length is the model's failure (bad), not infra", async () => {
    const cut: Chat = async () => ({ text: "", ms: 5, status: 200, finishReason: "length", usage: { completion_tokens: 14000 } });
    const rec = await runCreateCase(CREATE_CASES[1], cut, ctx);
    expect(rec).toMatchObject({ outcome: "bad", good: false, finish_reason: "length", status: 200 });
    expect(rec.usage).toEqual({ completion_tokens: 14000 });
    expect(sum([rec]).summary.complete).toBe(true);
  });

  it("create records how many parts the converter dropped", async () => {
    const chat: Chat = async () => ({ text: JSON.stringify({ parts: [{ name: "a", shape: "box", position: [0, 0, 0], size: [1, 1, 1] }, { name: "b", shape: "blob", size: [1] }] }), ms: 1 });
    expect((await runCreateCase(CREATE_CASES[1], chat, ctx)).partsDropped).toBe(1);
  });

  it("an empty run is never complete", () => {
    expect(sum([]).summary.complete).toBe(false);
  });

  it("env is read strictly", () => {
    expect(readLabEnv({})).toEqual({ active: false });
    const bad = (e: Record<string, string>) => { const r = readLabEnv(e); return r.active && !r.ok ? r.problems.join("|") : "ok"; };
    expect(bad({ SHAPES_LAB_URL: "http://x" })).toContain("both SHAPES_LAB_URL and SHAPES_LAB_MODEL");
    expect(bad({ SHAPES_LAB_URL: "http://u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TASK: "Refine" })).toContain("TASK");
    expect(bad({ SHAPES_LAB_URL: "http://u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TEMPERATURE: "abc" })).toContain("TEMPERATURE");
    expect(bad({ SHAPES_LAB_URL: "http://u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TEMPERATURE: "-1" })).toContain("TEMPERATURE");
    expect(bad({ SHAPES_LAB_URL: "http://u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TEMPERATURE: "" })).toContain("TEMPERATURE");
    expect(bad({ SHAPES_LAB_DRY: "yes" })).toContain("DRY");
    expect(readLabEnv({ SHAPES_LAB_DRY: "1" })).toMatchObject({ active: true, ok: true, task: "create", temperature: 0.2, dry: true });
    expect(readLabEnv({ SHAPES_LAB_URL: "http://u", SHAPES_LAB_MODEL: "m", SHAPES_LAB_TASK: "refine", SHAPES_LAB_TEMPERATURE: "0" })).toMatchObject({ ok: true, task: "refine", temperature: 0 });
  });

  describe("httpChat against a local fake server (127.0.0.1, random port, no model)", () => {
    type Handler = (req: IncomingMessage, res: ServerResponse) => void;
    const sockets = new Set<Socket>();
    const servers: Server[] = [];
    const serve = async (handler: Handler): Promise<{ url: string; server: Server }> => {
      const server = createServer(handler);
      server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      servers.push(server);
      return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`, server };
    };
    const json = (body: unknown, status = 200): Handler => (_req, res) => { res.statusCode = status; res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    const ask = (url: string, timeoutMs?: number) => httpChat(url, "m", 0.2, timeoutMs)([{ role: "user", content: "hi" }]);
    afterEach(async () => {
      for (const s of sockets) s.destroy();
      await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
    });

    it("valid 200 gives the text, status, finish_reason and usage; the request body is as specified", async () => {
      let seen: { body: Record<string, unknown>; ct?: string; cl?: string } | undefined;
      const { url } = await serve((req, res) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => {
          seen = { body: JSON.parse(b) as Record<string, unknown>, ct: req.headers["content-type"], cl: req.headers["content-length"] };
          json({ choices: [{ message: { content: "hello" }, finish_reason: "stop" }], usage: { completion_tokens: 3 } })(req, res);
        });
      });
      const r = await ask(url);
      expect(r).toMatchObject({ text: "hello", status: 200, finishReason: "stop", usage: { completion_tokens: 3 } });
      expect(r.error).toBeUndefined();
      expect(seen?.body).toMatchObject({ model: "m", temperature: 0.2, max_tokens: 14000, stream: false });
      expect(seen?.ct).toBe("application/json");
      expect(Number(seen?.cl)).toBeGreaterThan(0);
    });

    it("200 with an error object is infra", async () => {
      const { url } = await serve(json({ error: { message: "model not loaded" } }));
      const r = await ask(url);
      expect(r).toMatchObject({ status: 200 });
      expect(r.error).toContain("no choices[0].message.content");
      expect((await runCreateCase(CREATE_CASES[0], async () => r, ctx)).outcome).toBe("infra");
    });

    it("HTTP 500 is infra with the status", async () => {
      const { url } = await serve(json("boom", 500));
      const r = await ask(url);
      expect(r).toMatchObject({ status: 500, text: "" });
      expect(r.error).toContain("HTTP 500");
    });

    it("connection refused is infra with the error code", async () => {
      const { url, server } = await serve(json({}));
      await new Promise((r) => server.close(r));
      const r = await ask(url);
      expect(r.error).toContain("ECONNREFUSED");
      expect(r.timedOut).toBeFalsy();
      expect((await runCreateCase(CREATE_CASES[0], async () => r, ctx)).outcome).toBe("infra");
    });

    it("an invalid JSON body keeps status 200 and says so", async () => {
      const { url } = await serve(json("NOT JSON"));
      expect(await ask(url)).toMatchObject({ status: 200, error: "invalid JSON body" });
    });

    it("content as an array of parts is infra", async () => {
      const { url } = await serve(json({ choices: [{ message: { content: [{ type: "text", text: "x" }] }, finish_reason: "stop" }] }));
      expect((await ask(url)).error).toContain("array of parts");
    });

    it("content null + finish_reason length is bad, reasoning length recorded, not its text", async () => {
      const { url } = await serve(json({ choices: [{ message: { content: null, reasoning_content: "x".repeat(123) }, finish_reason: "length" }], usage: { completion_tokens: 14000 } }));
      const r = await ask(url);
      expect(r).toMatchObject({ text: "", status: 200, finishReason: "length", reasoningChars: 123 });
      expect(r.error).toBeUndefined();
      const rec = await runCreateCase(CREATE_CASES[0], async () => r, ctx);
      expect(rec).toMatchObject({ outcome: "bad", finish_reason: "length", reasoningChars: 123 });
      expect(JSON.stringify(rec)).not.toContain("xxxxxxxx");
    });

    it("content null without finish_reason length stays infra", async () => {
      const { url } = await serve(json({ choices: [{ message: { content: null, reasoning_content: "thinking" }, finish_reason: "stop" }] }));
      const r = await ask(url);
      expect(r.error).toContain("no choices[0].message.content");
      expect((await runCreateCase(CREATE_CASES[0], async () => r, ctx)).outcome).toBe("infra");
    });

    it("headers delayed by 1.5 s still give a good result (no header timeout in the request)", async () => {
      const answer = JSON.stringify({ changes: [{ op: "remove", name: "Bein-4" }] });
      const { url } = await serve((_req, res) => {
        setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: "stop" }] })), 1500);
      });
      const rec = await runRefineCase(REFINE_CASES[2], httpChat(url, "m", 0.2), ctx);
      expect(rec).toMatchObject({ id: "R03", outcome: "good", good: true });
      expect(Number(rec.ms)).toBeGreaterThanOrEqual(1400);
    });

    it("a server that never answers gives outcome timeout after the injected limit, and the run stays COMPLETE", async () => {
      const { url } = await serve(() => { /* never answers */ });
      const rec = await runRefineCase(REFINE_CASES[0], httpChat(url, "m", 0.2, 300), ctx);
      expect(rec).toMatchObject({ outcome: "timeout", good: false });
      expect(Number(rec.ms)).toBeGreaterThanOrEqual(250);
      expect(Number(rec.ms)).toBeLessThan(3000);
      expect(sum([rec]).summary).toMatchObject({ complete: true, timeouts: 1 });
    }, 10_000);
  });

  it("env: whitespace URL, non-http URL, temperature out of range or not a plain decimal are rejected", () => {
    const base = { SHAPES_LAB_URL: "http://127.0.0.1:1234/v1/chat/completions", SHAPES_LAB_MODEL: "m" };
    const bad = (e: Record<string, string>) => { const r = readLabEnv({ ...base, ...e }); return r.active && !r.ok ? r.problems.join("|") : "ok"; };
    expect(bad({ SHAPES_LAB_URL: "   " })).toContain("both SHAPES_LAB_URL");
    expect(bad({ SHAPES_LAB_URL: "127.0.0.1:1234" })).toContain("http");
    expect(bad({ SHAPES_LAB_URL: "ftp://x" })).toContain("http");
    for (const t of ["2.1", "3", "0x10", "1e3", "1e-1", ".5", "+0.2", "0.2.1"]) expect(bad({ SHAPES_LAB_TEMPERATURE: t }), t).toContain("TEMPERATURE");
    for (const t of ["0", "0.2", "1", "2", " 0.7 "]) expect(bad({ SHAPES_LAB_TEMPERATURE: t }), t).toBe("ok");
    expect(readLabEnv({ ...base, SHAPES_LAB_URL: "  https://h/v1  " })).toMatchObject({ ok: true, url: "https://h/v1" });
  });
});
