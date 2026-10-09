import { describe, expect, it, vi } from "vitest";
import type { SseTransport } from "../../src/vendor/kit-obsidian/chat-client";

// Fake-Transport statt Netz: die ECHTE Verbindung aus main.ts laeuft, nur der HTTP-Weg ist ersetzt.
const sent: { body: any }[] = [];
let respondWith: (body: any) => string = () => "";
const fakeTransport: SseTransport = {
  postStream: async (_url, body, _headers, onChunk) => {
    sent.push({ body });
    const content = respondWith(body);
    onChunk(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    onChunk("data: [DONE]\n\n");
    return 200;
  },
};

vi.mock("../../src/vendor/kit-obsidian/llm-connection", async (orig) => {
  const m = await orig<typeof import("../../src/vendor/kit-obsidian/llm-connection")>();
  return {
    ...m,
    createLlmConnection: (o: any) => m.createLlmConnection({ ...o, probe: async () => true, listModels: async () => ["m"], transports: { http: fakeTransport, fallback: "none" } }),
  };
});

import ThreeDCodeblocksPlugin from "../../src/main";
import { makeFakeApp } from "../__mocks__/obsidian";

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
const PROMPT = `Build a lamp. Note: ${PEM}`;

async function loadedPlugin() {
  const app = makeFakeApp();
  const plugin = new ThreeDCodeblocksPlugin(app, {} as any);
  plugin.registerView = vi.fn();
  plugin.registerExtensions = vi.fn();
  plugin.addCommand = vi.fn();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  plugin.loadData = vi.fn().mockResolvedValue({ endpoints: [{ url: "http://127.0.0.1:1234/v1", model: "m" }], llmModel: "m" });
  await plugin.onload();
  return plugin;
}

describe("LLM connection: redaction with JSON restore", () => {
  it("sends a placeholder for a PEM block and returns the original as valid JSON in content", async () => {
    sent.length = 0;
    // Das Modell spiegelt den Platzhalter in einen JSON-String (z. B. einen Teilenamen).
    respondWith = (body) => {
      const user = String(body.messages.at(-1).content);
      const ph = /\[redacted-private-key[^\]]*\]/.exec(user)?.[0] ?? "NO-PLACEHOLDER";
      return JSON.stringify({ parts: [{ name: ph }] });
    };
    const plugin = await loadedPlugin();
    const r = await plugin.llm.complete({ messages: [{ role: "user", content: PROMPT }] }, {});
    expect(r.ok).toBe(true);
    const wire = JSON.stringify(sent[0]!.body);
    expect(wire).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
    expect(wire).toContain("redacted-private-key");
    if (!r.ok) return;
    const parsed = JSON.parse(r.content);
    expect(parsed.parts[0].name).toBe(PEM);
  });
});
