import { describe, expect, it, vi } from "vitest";
import { PromptPanelView } from "../../src/obsidian/prompt-panel";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import type { PanelTarget } from "../../src/core/shapes/panel-state";

const MODEL = "tiny/model";
const TABLE = "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b";
const TIMING = { startedAt: 0, firstTokenAt: 0, endedAt: 0 };

const BLOCK: PanelTarget = { kind: "shapes-block", path: "n.md", lineStart: 3, lineEnd: 6, label: "Table" };
const OTHER: PanelTarget = { kind: "other", label: "Elsewhere" };

type Handlers = { onToken?: (t: string) => void; onReasoning?: (t: string) => void; signal?: AbortSignal };
type Complete = (req: { messages?: unknown[] }, h: Handlers) => Promise<unknown>;

/** Antwort wie die Kit-Verbindung sie liefert: Text stueckweise ueber onToken, dann das Ergebnis. */
function answer(content: string): Complete {
  return async (_req, h) => {
    for (let i = 0; i < content.length; i += 7) h.onToken?.(content.slice(i, i + 7));
    return { ok: true, content, reasoning: "", toolCalls: [], truncated: false, streamed: true, timing: TIMING, facts: null, deviations: [], source: {} };
  };
}

function makeView(complete: Complete, extra: Record<string, unknown> = {}) {
  const loadModel = vi.fn().mockResolvedValue({ object: {}, cameras: [] });
  const llm = {
    complete: vi.fn(complete),
    models: vi.fn(async () => ({ models: [MODEL], reachable: true })),
    invalidate: vi.fn(),
    source: vi.fn(() => ({ family: null, familySource: "none", backend: "unknown", backendSource: "none", model: MODEL, sentModel: MODEL })),
  };
  const deps = {
    settings: () => DEFAULT_SETTINGS,
    factory: {
      isWebGLAvailable: () => true,
      create: () => ({
        setModel: vi.fn(), setView: vi.fn(), getView: vi.fn(() => null), setColors: vi.fn(),
        resize: vi.fn(), resetCamera: vi.fn(), capturePoster: () => "", dispose: vi.fn(),
      }),
    },
    budget: { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() },
    loadModel,
    readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
    llm,
    readTargetText: vi.fn(async (): Promise<string | null> => null),
    accept: vi.fn(async () => ({ ok: false, message: "not wired" })),
    openSettings: vi.fn(),
    confirm: vi.fn(async () => true),
    managerPresent: () => false,
    persistModel: vi.fn(async () => {}),
    ...extra,
  };
  const view = new PromptPanelView({ app: undefined } as never, deps as never);
  return { view, deps, llm, loadModel };
}

/** Der Attrappen-Baum hat kein querySelector — Elemente ueber ihre Klasse suchen. */
function findAll(el: any, cls: string): any[] {
  const out: any[] = [];
  const walk = (n: any): void => {
    if (String(n.className ?? "").split(/\s+/).includes(cls)) out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(el);
  return out;
}
const one = (view: PromptPanelView, cls: string): any => {
  const hits = findAll((view as any).contentEl, cls);
  expect(hits.length, `element .${cls}`).toBeGreaterThan(0);
  return hits[0];
};
const hasClass = (el: any, cls: string): boolean => String(el.className).split(/\s+/).includes(cls);
const statusText = (view: PromptPanelView): string => one(view, "tdcb-prompt-status-label").textContent as string;

async function send(view: PromptPanelView, text: string): Promise<void> {
  one(view, "tdcb-prompt-input").value = text;
  one(view, "tdcb-prompt-send").click();
  await view.settled();
}

describe("PromptPanelView", () => {
  it("creates a round from a parts answer and renders the preview", async () => {
    const { view, loadModel } = makeView(answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}'));
    await view.onOpen();
    await send(view, "a box");
    expect(view.state().rounds.rounds).toHaveLength(1);
    expect((view.state().rounds.rounds[0] as { text: string }).text).toBe("box A size 1 1 1"); // formatShapes schreibt size [1] als Würfel aus
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(statusText(view)).toContain("Done");
  });

  it("turns an unusable answer into a status with the hint, and no round", async () => {
    const { view, loadModel } = makeView(answer("Sorry, I cannot"));
    await view.onOpen();
    await send(view, "a box");
    expect(view.state().rounds.rounds).toHaveLength(0);
    expect(statusText(view)).toContain("no JSON in the answer");
    expect(statusText(view)).toContain("measured best");
    expect(loadModel).not.toHaveBeenCalled();
    // Der Rohtext bleibt sichtbar.
    expect(one(view, "okit-stream-tail").textContent).toBe("Sorry, I cannot");
  });

  it("refines on the active round and stores a readable diff", async () => {
    const changes = '{"changes":[{"op":"change","name":"Platte","position":[0,0.925,0]}]}';
    const { view, deps } = makeView(answer(changes), { readTargetText: vi.fn(async () => TABLE) });
    await view.onOpen();
    view.setTarget(BLOCK);
    await send(view, "raise the top");
    expect(deps.readTargetText).toHaveBeenCalledWith(BLOCK);
    const round = view.state().rounds.rounds[0] as { kind: string; basedOn: number | null; diff: string[] };
    expect(round.kind).toBe("refine");
    expect(round.basedOn).toBeNull();
    expect(round.diff[0].startsWith("Platte: at")).toBe(true);
  });

  it("shows the no-endpoint empty state, and sending works again once an endpoint exists", async () => {
    let configured = false;
    const good = answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}');
    const { view } = makeView(async (req, h) =>
      configured
        ? good(req, h)
        : { ok: false, kind: "no-endpoint", detail: "disabled", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: {} },
    );
    await view.onOpen();
    expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(true);
    await send(view, "a box");
    expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(false);
    expect(view.state().rounds.rounds).toHaveLength(0);
    // Kein Sackgasse: nach der Konfiguration geht Senden wieder, der Empty-State verschwindet.
    expect(one(view, "tdcb-prompt-send").disabled).toBe(false);
    configured = true;
    await send(view, "a box");
    expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(true);
    expect(view.state().rounds.rounds).toHaveLength(1);
  });

  it("aborts a running request on close and writes nothing afterwards", async () => {
    let seen: AbortSignal | undefined;
    const good = answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}');
    // Haengt, bis abgebrochen wird — und liefert DANN ein brauchbares Ergebnis: schriebe die View nach dem
    // Schliessen noch eine Runde, ginge dieses Ergebnis durch.
    const { view } = makeView(async (req, h) => {
      seen = h.signal;
      await new Promise<void>((resolve) => h.signal?.addEventListener("abort", () => resolve()));
      return good(req, {});
    });
    await view.onOpen();
    one(view, "tdcb-prompt-input").value = "a box";
    one(view, "tdcb-prompt-send").click();
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(view.running()).toBe(true);
    await view.onClose();
    expect(seen?.aborted).toBe(true);
    await view.settled();
    expect(view.running()).toBe(false);
    expect(view.state().rounds.rounds).toHaveLength(0);
  });

  it("keeps the target while rounds are open", async () => {
    const { view } = makeView(answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}'));
    await view.onOpen();
    await send(view, "a box");
    view.setTarget(OTHER);
    expect(view.state().target).toEqual({ kind: "new" });
    expect(one(view, "tdcb-prompt-target").textContent).toContain("Target kept");
  });

  it("applies via deps.accept and clears the rounds", async () => {
    const accept = vi.fn(async () => ({ ok: true, message: "n.md" }));
    const { view } = makeView(answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}'), { accept });
    await view.onOpen();
    await send(view, "a box");
    expect(view.state().rounds.rounds).toHaveLength(1);
    one(view, "tdcb-prompt-apply").click();
    await view.settled();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(view.state().rounds.rounds).toHaveLength(0);
    expect(statusText(view)).toBe("Applied to n.md.");
  });

  // Eine Anfrage, die haengt, bis der Test sie freigibt.
  function held(content: string) {
    let release: () => void = () => {};
    const good = answer(content);
    const complete: Complete = (req, h) => new Promise((resolve) => { release = () => void good(req, h).then(resolve); });
    return { complete, release: () => release(), started: () => release !== undefined };
  }

  it("keeps target new while a create request runs, and the round belongs to new", async () => {
    const h = held('{"parts":[{"name":"A","shape":"box","size":[1]}]}');
    const { view } = makeView(h.complete);
    await view.onOpen();
    one(view, "tdcb-prompt-input").value = "a box";
    one(view, "tdcb-prompt-send").click();
    expect(view.running()).toBe(true);
    view.setTarget(BLOCK);
    expect(view.state().target).toEqual({ kind: "new" });
    expect(one(view, "tdcb-prompt-target").textContent).toContain("Target kept");
    h.release();
    await view.settled();
    expect(view.state().rounds.rounds).toHaveLength(1);
    expect(view.state().target).toEqual({ kind: "new" });
  });

  it("keeps target A while a refine request runs and B is offered", async () => {
    const A: PanelTarget = { kind: "shapes-block", path: "a.md", lineStart: 0, lineEnd: 2, label: "A" };
    const B: PanelTarget = { kind: "shapes-block", path: "b.md", lineStart: 0, lineEnd: 2, label: "B" };
    const h = held('{"changes":[{"op":"change","name":"Platte","position":[0,0.925,0]}]}');
    const { view } = makeView(h.complete, { readTargetText: vi.fn(async () => TABLE) });
    await view.onOpen();
    view.setTarget(A);
    one(view, "tdcb-prompt-input").value = "raise";
    one(view, "tdcb-prompt-send").click();
    await vi.waitFor(() => expect(view.running()).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    view.setTarget(B);
    expect(view.state().target).toEqual(A);
    h.release();
    await view.settled();
    expect(view.state().target).toEqual(A);
    expect(view.state().rounds.rounds).toHaveLength(1);
  });

  it("adds no round when the target changed under the request by other means", async () => {
    const h = held('{"parts":[{"name":"A","shape":"box","size":[1]}]}');
    const { view } = makeView(h.complete);
    await view.onOpen();
    one(view, "tdcb-prompt-input").value = "a box";
    one(view, "tdcb-prompt-send").click();
    (view as any).panel = { ...view.state(), target: BLOCK };
    h.release();
    await view.settled();
    expect(view.state().rounds.rounds).toHaveLength(0);
    expect(statusText(view)).toContain("target changed");
  });

  it("recovers when readTargetText rejects", async () => {
    const readTargetText = vi.fn(async () => { throw new Error("disk gone"); });
    const { view } = makeView(answer("{}"), { readTargetText });
    await view.onOpen();
    view.setTarget(BLOCK);
    await send(view, "raise");
    expect(view.running()).toBe(false);
    expect(statusText(view)).toContain("disk gone");
    expect(one(view, "tdcb-prompt-send").disabled).toBe(false);
  });

  it("shows an error and keeps the rounds when accept rejects", async () => {
    const accept = vi.fn(async () => { throw new Error("write failed"); });
    const { view } = makeView(answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}'), { accept });
    await view.onOpen();
    await send(view, "a box");
    one(view, "tdcb-prompt-apply").click();
    await view.settled();
    expect(statusText(view)).toContain("write failed");
    expect(view.state().rounds.rounds).toHaveLength(1);
  });

  it("writes no round when the request was aborted, even if the result arrives ok", async () => {
    const h = held('{"parts":[{"name":"A","shape":"box","size":[1]}]}');
    const { view } = makeView(h.complete);
    await view.onOpen();
    one(view, "tdcb-prompt-input").value = "a box";
    one(view, "tdcb-prompt-send").click();
    one(view, "tdcb-prompt-stop").click();
    h.release();
    await view.settled();
    expect(view.state().rounds.rounds).toHaveLength(0);
    expect(statusText(view)).toBe("Stopped.");
  });

  it("reports a truncated answer as cut off", async () => {
    const { view } = makeView(async () => ({ ok: true, content: '{"parts":[', reasoning: "", toolCalls: [], truncated: true, streamed: true, timing: TIMING, facts: null, deviations: [], source: {} }));
    await view.onOpen();
    await send(view, "a box");
    expect(statusText(view)).toContain("cut off");
    expect(view.state().rounds.rounds).toHaveLength(0);
  });

  it("survives a rejecting model list and a rejecting persistModel", async () => {
    const { view, llm } = makeView(answer("{}"), { persistModel: vi.fn(async () => { throw new Error("save failed"); }) });
    llm.models.mockRejectedValue(new Error("offline"));
    await view.onOpen();
    await vi.waitFor(() => expect(statusText(view)).toContain("offline"));
    await (view as any).chooseModel("x");
    expect(statusText(view)).toContain("save failed");
  });
});
