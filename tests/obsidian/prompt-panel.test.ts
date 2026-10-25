import { describe, expect, it, vi } from "vitest";
import { PromptPanelView } from "../../src/obsidian/prompt-panel";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import type { PanelTarget } from "../../src/core/shapes/panel-state";

const MODEL = "tiny/model";
const TABLE = "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b";
const TIMING = { startedAt: 0, firstTokenAt: 0, endedAt: 0 };

const BLOCK: PanelTarget = { kind: "shapes-block", path: "n.md", lineStart: 3, lineEnd: 6, label: "Table", body: "" };
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
  const chosen = { model: MODEL };
  const think = { level: "off" as string, family: null as string | null, picker: false };
  const loadModel = vi.fn().mockResolvedValue({ object: {}, cameras: [] });
  const llm = {
    complete: vi.fn(complete),
    models: vi.fn(async () => ({ models: [MODEL], reachable: true })),
    invalidate: vi.fn(),
    setModel: vi.fn(async (m: string) => { chosen.model = m; }),
    modelInUse: vi.fn(() => chosen.model),
    source: vi.fn(() => ({ family: null, familySource: "none", backend: "unknown", backendSource: "none", model: chosen.model, sentModel: chosen.model })),
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
    thinking: {
      family: () => think.family,
      current: () => think.level,
      onLevel: () => "low",
      setLevel: vi.fn(async (l: string) => { think.level = l; }),
      levelPicker: () => think.picker,
    },
    readTargetText: vi.fn(async (): Promise<string | null> => null),
    accept: vi.fn(async () => ({ ok: false, message: "not wired" })),
    openSettings: vi.fn(),
    confirm: vi.fn(async () => true),
    managerPresent: () => false,
    ...extra,
  };
  const view = new PromptPanelView({ app: undefined } as never, deps as never);
  return { view, deps, llm, loadModel, chosen, think };
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

  it("after a create round the status points to New for another model; after a refine round it does not", async () => {
    const created = makeView(answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}'));
    await created.view.onOpen();
    await send(created.view, "a box");
    expect(statusText(created.view)).toBe("Done — check the preview, then apply or change further, or press New to start another model.");
    const refined = makeView(answer('{"changes":[{"op":"change","name":"Platte","position":[0,0.925,0]}]}'), { readTargetText: vi.fn(async () => TABLE) });
    await refined.view.onOpen();
    refined.view.setTarget(BLOCK);
    await send(refined.view, "raise");
    expect(refined.view.state().rounds.rounds).toHaveLength(1);
    expect(statusText(refined.view)).toBe("Done — check the preview, then apply or change further.");
    expect(statusText(refined.view)).not.toContain("press New");
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
        : { ok: false, kind: "no-endpoint", detail: "disabled", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: { kind: "manager" } },
    );
    await view.onOpen();
    expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(true);
    await send(view, "a box");
    expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(false);
    // `disabled` ist ein Code des Managers: der Nutzer liest, wo er es behebt, nicht den rohen Code.
    expect(one(view, "tdcb-prompt-empty-detail").textContent).toContain("switched off in the LLM Endpoint Manager");
    expect(view.state().rounds.rounds).toHaveLength(0);
    // Kein Sackgasse: nach der Konfiguration geht Senden wieder, der Empty-State verschwindet.
    expect(one(view, "tdcb-prompt-send").disabled).toBe(false);
    configured = true;
    await send(view, "a box");
    expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(true);
    expect(view.state().rounds.rounds).toHaveLength(1);
  });

  it("no-endpoint from the local list keeps the plain reason, even when it looks like a manager code", async () => {
    const { view } = makeView(async () => ({ ok: false, kind: "no-endpoint", detail: "disabled", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: { kind: "local" } }));
    await view.onOpen();
    await send(view, "a box");
    expect(one(view, "tdcb-prompt-empty-detail").textContent).toBe("Reason: disabled");
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
    const accept = vi.fn(async () => ({ ok: true, message: "Applied to n.md." }));
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

  it("shows the real acceptPanel messages unchanged in the status line (no doubled prefix)", async () => {
    const { acceptPanel } = await import("../../src/obsidian/panel-accept");
    const inserted: string[] = [];
    const view0 = { file: { path: "n.md" }, getMode: () => "source", editor: { somethingSelected: () => false, getCursor: () => ({ line: 0, ch: 0 }), getValue: () => "", replaceSelection: (t: string) => { inserted.push(t); } } };
    const env = {
      app: {} as never,
      ports: { editorFor: () => null, vault: { read: async () => "", process: async () => {} } },
      settings: () => DEFAULT_SETTINGS,
      lastEditor: () => view0 as never,
    };
    const { view } = makeView(answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}'), { accept: (s: never) => acceptPanel(env, s) });
    await view.onOpen();
    await send(view, "a box");
    one(view, "tdcb-prompt-apply").click();
    await view.settled();
    expect(inserted).toHaveLength(1);
    expect(statusText(view)).toBe("Applied to the open note as a code block at the cursor.");
    // Fehlerfall: die Meldung steht genauso unveraendert da.
    view0.getMode = () => "preview";
    await send(view, "another box");
    one(view, "tdcb-prompt-apply").click();
    await view.settled();
    expect(statusText(view)).toBe("The open note is in reading view — switch to editing view to insert a code block.");
  });

  describe("block target lifecycle (fingerprint)", () => {
    const CHANGE = '{"changes":[{"op":"change","name":"Platte","position":[0,0.925,0]}]}';
    const B0: PanelTarget = { kind: "shapes-block", path: "n.md", lineStart: 3, lineEnd: 5, label: "Table", body: TABLE };
    it("a fresh fingerprint offered while rounds are open is kept; Discard adopts it and the next change builds on the fresh text", async () => {
      const fresh = { ...B0, body: `${TABLE}\nbox X size 1 at 0 0 0` };
      const read = vi.fn(async (t: PanelTarget) => (t === fresh ? fresh.body : TABLE));
      const { view } = makeView(answer(CHANGE), { readTargetText: read });
      await view.onOpen();
      view.setTarget(B0);
      await send(view, "raise");
      expect(view.state().rounds.rounds).toHaveLength(1);
      view.setTarget(fresh);
      expect(one(view, "tdcb-prompt-target").textContent).toContain("Target kept");
      expect(view.state().target).toBe(B0);
      one(view, "tdcb-prompt-discard").click();
      await vi.waitFor(() => expect(view.state().rounds.rounds).toHaveLength(0));
      expect(view.state().target).toBe(fresh);
      await send(view, "raise again");
      expect(read).toHaveBeenLastCalledWith(fresh);
      expect((view.state().rounds.rounds[0] as { text: string }).text).toContain("box X");
    });
    it("Apply of a block adopts the retarget, so a second change and a second apply work", async () => {
      const retarget = { ...B0, body: "box Platte size 1 at 0 0.925 0", lineEnd: 4 };
      const accept = vi.fn(async () => ({ ok: true, message: "Applied to Table.", retarget }));
      const read = vi.fn(async () => TABLE);
      const { view } = makeView(answer(CHANGE), { accept, readTargetText: read });
      await view.onOpen();
      view.setTarget(B0);
      await send(view, "raise");
      one(view, "tdcb-prompt-apply").click();
      await view.settled();
      expect(view.state().target).toBe(retarget);
      expect(view.state().rounds.rounds).toHaveLength(0);
      await send(view, "again");
      expect(read).toHaveBeenLastCalledWith(retarget);
      one(view, "tdcb-prompt-apply").click();
      await view.settled();
      expect(accept).toHaveBeenCalledTimes(2);
      expect((accept.mock.calls[1] as unknown as [{ target: PanelTarget }])[0].target).toBe(retarget);
    });
    it("a failed apply keeps target and rounds (no retarget)", async () => {
      const accept = vi.fn(async () => ({ ok: false, message: "The block changed — nothing was applied." }));
      const { view } = makeView(answer(CHANGE), { accept, readTargetText: vi.fn(async () => TABLE) });
      await view.onOpen();
      view.setTarget(B0);
      await send(view, "raise");
      one(view, "tdcb-prompt-apply").click();
      await view.settled();
      expect(view.state().target).toBe(B0);
      expect(view.state().rounds.rounds).toHaveLength(1);
      expect(statusText(view)).toBe("The block changed — nothing was applied.");
    });
    it("tells a block target to click the block again when its text is gone", async () => {
      const { view } = makeView(answer(CHANGE), { readTargetText: vi.fn(async () => null) });
      await view.onOpen();
      view.setTarget(B0);
      await send(view, "raise");
      expect(statusText(view)).toBe("The block changed or moved — click it again (toolbar button).");
    });
    it("other targets keep the old wording", async () => {
      const { view } = makeView(answer(CHANGE), { readTargetText: vi.fn(async () => null) });
      await view.onOpen();
      view.setTarget({ kind: "shapes-file", path: "x.shapes", label: "x" });
      await send(view, "raise");
      expect(statusText(view)).toBe("The model to change is gone.");
    });
    it("a target offered during a run that produced no round is adopted afterwards", async () => {
      const h = held("Sorry, I cannot");
      const { view } = makeView(h.complete);
      await view.onOpen();
      one(view, "tdcb-prompt-input").value = "a box";
      one(view, "tdcb-prompt-send").click();
      await vi.waitFor(() => expect(view.running()).toBe(true));
      view.setTarget(B0);
      expect(view.state().target).toEqual({ kind: "new" });
      h.release();
      await view.settled();
      expect(view.state().rounds.rounds).toHaveLength(0);
      expect(view.state().target).toBe(B0);
    });
  });

  describe("double apply", () => {
    it("blocks a second Apply, Discard, New and Send while the first apply runs: exactly one accept call", async () => {
      let release: (v: { ok: boolean; message: string }) => void = () => {};
      const accept = vi.fn(() => new Promise<{ ok: boolean; message: string }>((res) => { release = res; }));
      const { view } = makeView(answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}'), { accept });
      await view.onOpen();
      await send(view, "a box");
      const apply = one(view, "tdcb-prompt-apply");
      apply.click();
      apply.click();
      expect(accept).toHaveBeenCalledTimes(1);
      expect(apply.disabled).toBe(true);
      expect(one(view, "tdcb-prompt-discard").disabled).toBe(true);
      expect(one(view, "tdcb-prompt-new").disabled).toBe(true);
      expect(one(view, "tdcb-prompt-send").disabled).toBe(true);
      release({ ok: true, message: "Applied to x." });
      await view.settled();
      expect(accept).toHaveBeenCalledTimes(1);
      expect(one(view, "tdcb-prompt-new").disabled).toBe(false);
      expect(one(view, "tdcb-prompt-send").disabled).toBe(false);
    });
    it("releases the lock after a rejected accept", async () => {
      const accept = vi.fn(async () => { throw new Error("boom"); });
      const { view } = makeView(answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}'), { accept });
      await view.onOpen();
      await send(view, "a box");
      one(view, "tdcb-prompt-apply").click();
      await view.settled();
      expect(statusText(view)).toBe("boom");
      expect(one(view, "tdcb-prompt-apply").disabled).toBe(false);
    });
  });

  describe("example empty state (.tdcb-prompt-examples)", () => {
    const shown = (view: PromptPanelView): boolean => !hasClass(one(view, "tdcb-prompt-examples"), "is-hidden");
    const BOX = '{"parts":[{"name":"A","shape":"box","size":[1]}]}';
    it("is visible for an empty panel with target new, and carries the examples text", async () => {
      const { view } = makeView(answer(BOX));
      await view.onOpen();
      expect(shown(view)).toBe(true);
      expect(one(view, "tdcb-prompt-examples").textContent).toContain("snowman");
    });
    it("is gone while a request runs and after the first round, and for another target", async () => {
      const h = held(BOX);
      const { view } = makeView(h.complete, { readTargetText: vi.fn(async () => TABLE) });
      await view.onOpen();
      one(view, "tdcb-prompt-input").value = "a box";
      one(view, "tdcb-prompt-send").click();
      await vi.waitFor(() => expect(view.running()).toBe(true));
      expect(shown(view)).toBe(false);
      h.release();
      await view.settled();
      expect(shown(view)).toBe(false);
      // Nach Verwerfen (Runden weg, Ziel neu) kommt er wieder.
      one(view, "tdcb-prompt-discard").click();
      await vi.waitFor(() => expect(view.state().rounds.rounds).toHaveLength(0));
      expect(shown(view)).toBe(true);
      view.setTarget({ kind: "shapes-file", path: "x.shapes", label: "x" });
      expect(shown(view)).toBe(false);
    });
    it("yields to the no-endpoint empty state when both would apply", async () => {
      const { view } = makeView(async () => ({ ok: false, kind: "no-endpoint", detail: "off", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: {} }));
      await view.onOpen();
      await send(view, "a box");
      expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(false);
      expect(shown(view)).toBe(false);
    });
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
    const A: PanelTarget = { kind: "shapes-block", path: "a.md", lineStart: 0, lineEnd: 2, label: "A", body: "" };
    const B: PanelTarget = { kind: "shapes-block", path: "b.md", lineStart: 0, lineEnd: 2, label: "B", body: "" };
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

  describe("model row (kit model-bar)", () => {
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const pick = async (view: PromptPanelView, value: string): Promise<void> => {
      const sel = one(view, "okit-model-bar-select");
      sel.value = value;
      (sel._listeners["change"] ?? []).forEach((cb: () => void) => cb());
      await tick();
    };

    it("one row above the quality line: the models of the endpoint, Automatic, the chosen one; the home-made row is gone", async () => {
      const { view, llm } = makeView(answer("{}"));
      llm.models.mockResolvedValue({ models: ["a", "b"], reachable: true });
      await view.onOpen();
      await tick();
      expect(findAll((view as any).contentEl, "okit-model-bar")).toHaveLength(1);
      const texts = (one(view, "okit-model-bar-select").children as any[]).map((o) => o.textContent);
      expect(texts).toEqual(expect.arrayContaining(["Automatic", "a", "b"]));
      expect(findAll((view as any).contentEl, "tdcb-prompt-model")).toHaveLength(0);
      expect(findAll((view as any).contentEl, "tdcb-prompt-refresh")).toHaveLength(0);
    });

    it("the model choice goes to the connection (setModel), nothing else is stored, \"Automatic\" is allowed", async () => {
      const { view, llm } = makeView(answer("{}"));
      llm.models.mockResolvedValue({ models: ["qwen-x"], reachable: true });
      await view.onOpen();
      await tick();
      await pick(view, "qwen-x");
      expect(llm.setModel).toHaveBeenCalledWith("qwen-x");
      await pick(view, "");
      expect(llm.setModel).toHaveBeenLastCalledWith("");
    });

    it("a change redraws the header: the quality line follows the model", async () => {
      const { view, llm } = makeView(answer("{}"));
      llm.models.mockResolvedValue({ models: ["qwen/qwen3.8-27b", "other"], reachable: true });
      await view.onOpen();
      await tick();
      const before = one(view, "tdcb-prompt-quality-label").textContent;
      await pick(view, "qwen/qwen3.8-27b");
      expect(one(view, "tdcb-prompt-quality-label").textContent).not.toBe(before);
    });

    it("survives a rejecting model list and a rejecting setModel: both are shown, not swallowed", async () => {
      const { view, llm } = makeView(answer("{}"));
      llm.setModel.mockRejectedValue(new Error("save failed"));
      llm.models.mockRejectedValue(new Error("offline"));
      await view.onOpen();
      await vi.waitFor(() => expect(statusText(view)).toContain("offline"));
      await pick(view, "x");
      expect(statusText(view)).toContain("save failed");
    });

    it("the row is locked while a request runs and while Apply runs, free again afterwards", async () => {
      let during: boolean | null = null;
      let view!: PromptPanelView;
      const made = makeView(async (_req, h) => {
        during = one(view, "okit-model-bar-select").disabled === true && one(view, "okit-model-bar-refresh").disabled === true;
        return answer('{"parts":[{"name":"A","shape":"box","size":[1]}]}')(_req, h);
      });
      view = made.view;
      await view.onOpen();
      await tick();
      expect(one(view, "okit-model-bar-select").disabled).toBe(false);
      await send(view, "a box");
      expect(during).toBe(true);
      expect(one(view, "okit-model-bar-select").disabled).toBe(false);
      // Apply: gesperrt, solange accept noch laeuft
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => { release = r; });
      let lockedInApply: boolean | null = null;
      made.deps.accept.mockImplementation(async () => {
        lockedInApply = one(view, "okit-model-bar-select").disabled === true;
        await gate;
        return { ok: true, message: "ok" };
      });
      one(view, "tdcb-prompt-apply").click();
      await tick();
      release();
      await view.settled();
      await tick();
      expect(lockedInApply).toBe(true);
    });

    it("reloading the list resets an earlier \"no endpoint\": the empty state is hidden again", async () => {
      const { view, llm } = makeView(answer("{}"));
      await view.onOpen();
      await tick();
      (view as any).noEndpoint = true;
      (view as any).renderControls();
      expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(false);
      llm.models.mockClear();
      one(view, "okit-model-bar-refresh").click();
      await tick();
      expect(llm.models).toHaveBeenCalledWith({ force: true });
      expect(hasClass(one(view, "tdcb-prompt-empty"), "is-hidden")).toBe(true);
    });

    it("update() redraws the row from the state (model changed in the settings) without a request", async () => {
      const { view, llm, chosen } = makeView(answer("{}"));
      llm.models.mockResolvedValue({ models: ["a", "b"], reachable: true });
      await view.onOpen();
      await tick();
      llm.models.mockClear();
      chosen.model = "b";
      view.refreshModelBar();
      expect(one(view, "okit-model-bar-select").value).toBe("b");
      expect(llm.models).not.toHaveBeenCalled();
    });

    it("onClose unregisters the row: a late list does not draw and the root is gone", async () => {
      const { view, llm } = makeView(answer("{}"));
      await view.onOpen();
      await tick();
      const sel = one(view, "okit-model-bar-select");
      const before = (sel.children as any[]).map((o) => o.textContent);
      let finish: (r: { models: string[]; reachable: boolean }) => void = () => {};
      llm.models.mockImplementation(() => new Promise((r) => { finish = r; }));
      one(view, "okit-model-bar-refresh").click();
      await view.onClose();
      finish({ models: ["late"], reachable: true });
      await tick();
      expect((sel.children as any[]).map((o) => o.textContent)).toEqual(before);
      expect(findAll((view as any).contentEl, "okit-model-bar")).toHaveLength(0);
    });

    it("the thinking control stands IN the row and switches through deps.thinking.setLevel", async () => {
      const { view, deps, think } = makeView(answer("{}"));
      think.family = "qwen3.8";
      await view.onOpen();
      await tick();
      const bar = one(view, "okit-model-bar");
      const toggles = findAll(bar, "okit-thinking-toggle");
      expect(toggles).toHaveLength(1);
      expect(findAll((view as any).contentEl, "okit-thinking-toggle")).toHaveLength(1);
      toggles[0].click();
      await tick();
      expect(deps.thinking.setLevel).toHaveBeenCalledWith("low");
    });
  });
});
