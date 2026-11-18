// Das Prompt-Panel dieses Plugins nach K9 Etappe 3: Lauf (`createShapesRun`), Schreibwege (`shapesWays`), Texte und die dünne Ansicht über dem Kit-Rahmen.
// Was früher hier stand und jetzt im Kit steht (Handvergleich des Laufs, Sperren, Zeichnen der acht Stationen, Modellzeile, Hub), prüft das Kit
// (`obsidian-kit` `tests/prompt-panel*.test.ts`, `code-kit` `tests/panel-host.test.ts`) und der GUI-Smoke dieses Plugins (PP2 bis PP33); die Liste der
// entfallenen Tests steht in der Commit-Nachricht. Hier bleibt, was `shapes` ist, und der Beweis, dass die Verdrahtung den Rahmen richtig anschließt.
import { describe, expect, it, vi } from "vitest";
import { makeFakeApp, makeFakeEl } from "../__mocks__/obsidian";
import { createShapesRun, promptPanelStrings, PromptPanelView, shapesWays, type PromptPanelDeps } from "../../src/obsidian/prompt-panel";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import { INITIAL_PANEL, type PanelState, type PanelTarget, type ShapesRound } from "../../src/core/shapes/panel-state";
import { createPanelHost } from "../../src/vendor/kit/panel-host";
import { clearRounds, pushRound, EMPTY_ROUNDS } from "../../src/vendor/kit/rounds";
import { PANEL_TEXTS } from "../../src/i18n/strings";
import { setLang } from "../../src/i18n/t";

vi.mock("../../src/vendor/kit-obsidian/prompt-panel", () => ({ buildPromptPanel: vi.fn() }));
import { buildPromptPanel } from "../../src/vendor/kit-obsidian/prompt-panel";

const MODEL = "tiny/model";
const TABLE = "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b";
const TIMING = { startedAt: 0, firstTokenAt: 0, endedAt: 0 };
const PARTS = '{"parts":[{"name":"A","shape":"box","size":[1]}]}';
const CHANGES = '{"changes":[{"op":"change","name":"Platte","position":[0,0.925,0]}]}';

const BLOCK: PanelTarget = { kind: "block", path: "n.md", lineStart: 3, lineEnd: 6, label: "Table", body: "" };
const FILE: PanelTarget = { kind: "file", path: "a.shapes", label: "a" };
const OTHER: PanelTarget = { kind: "other", label: "Elsewhere" };

type Handlers = { onToken?: (t: string) => void; onReasoning?: (t: string) => void; onContentReset?: () => void; signal?: AbortSignal };
type Complete = (req: { messages?: unknown[] }, h: Handlers) => Promise<unknown>;

const okResult = (content: string, extra: Record<string, unknown> = {}) => ({
  ok: true, content, reasoning: "", toolCalls: [], truncated: false, streamed: true, timing: TIMING, facts: null, deviations: [], source: {}, ...extra,
});

/** Antwort wie die Kit-Verbindung sie liefert: Text stueckweise ueber onToken, dann das Ergebnis. */
function answer(content: string): Complete {
  return async (_req, h) => {
    for (let i = 0; i < content.length; i += 7) h.onToken?.(content.slice(i, i + 7));
    return okResult(content);
  };
}

/** Haengt, bis `release()`; liefert dann das Ergebnis. */
function held(content: string) {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const startedP = new Promise<void>((resolve) => { started = resolve; });
  const good = answer(content);
  const complete: Complete = (req, h) => new Promise((resolve) => { release = () => void good(req, h).then(resolve); started(); });
  /** `started`: die Anfrage hängt (ein Lauf, der vorher ein Ziel liest, erreicht sie erst nach einem await). */
  return { complete, release: () => release(), started: startedP };
}

function makeLlm(complete: Complete) {
  const chosen = { model: MODEL };
  return {
    complete: vi.fn(complete),
    source: vi.fn(() => ({ family: null, familySource: "none", backend: "unknown", backendSource: "none", model: chosen.model, sentModel: chosen.model })),
  };
}

/** Der Halter dieses Plugins mit dem echten Lauf, ohne Obsidian (der Kern ist rein, die Verdrahtung mit Statusleiste steht in `main.test.ts`). */
function makeHost(complete: Complete, readTargetText: (t: PanelTarget) => Promise<string | null> = async () => null, initial: PanelState = INITIAL_PANEL) {
  const llm = makeLlm(complete);
  const host = createPanelHost<PanelState>(
    {
      fresh: (target) => ({ target, rounds: clearRounds() }),
      run: createShapesRun({ llm: llm as never, readTargetText }),
      model: () => MODEL,
      strings: { running: (m) => `Asking ${m}`, aborted: "Stopped.", noEndpoint: "No language model is set up yet." },
    },
    initial,
  );
  return { host, llm, readTargetText };
}

async function send(host: ReturnType<typeof makeHost>["host"], text: string): Promise<void> {
  expect(host.start(text)).toBe(true);
  await host.settled();
}

const roundsOf = (host: ReturnType<typeof makeHost>["host"]): readonly ShapesRound[] => host.session().rounds.rounds;

describe("createShapesRun — der Lauf", () => {
  it("creates a round from a parts answer and says what to do next (create → press New for another model)", async () => {
    const { host } = makeHost(answer(PARTS));
    await send(host, "a box");
    expect(roundsOf(host)).toHaveLength(1);
    expect((roundsOf(host)[0] as { text: string }).text).toBe("box A size 1 1 1"); // formatShapes schreibt size [1] als Würfel aus
    expect(roundsOf(host)[0]).toMatchObject({ kind: "create", instruction: "a box", model: MODEL });
    expect(host.live().status).toEqual({ phase: "ok", text: "Done — check the preview, then apply or change further, or press New to start another model." });
  });

  it("after a refine round the status does not point to New", async () => {
    const { host } = makeHost(answer(CHANGES), async () => TABLE, { target: BLOCK, rounds: EMPTY_ROUNDS });
    await send(host, "raise");
    expect(roundsOf(host)).toHaveLength(1);
    expect(host.live().status).toEqual({ phase: "ok", text: "Done — check the preview, then apply or change further." });
  });

  it("refines on the text of the target and stores a readable diff", async () => {
    const { host, readTargetText } = makeHost(answer(CHANGES), vi.fn(async () => TABLE), { target: BLOCK, rounds: EMPTY_ROUNDS });
    await send(host, "raise the top");
    expect(readTargetText).toHaveBeenCalledWith(BLOCK);
    const round = roundsOf(host)[0] as { kind: string; basedOn: number | null; diff: string[]; instruction: string };
    expect(round.kind).toBe("refine");
    expect(round.basedOn).toBeNull();
    expect(round.instruction).toBe("raise the top");
    expect(round.diff[0]?.startsWith("Platte: at")).toBe(true);
  });

  it("a second refine builds on the ACTIVE round, not on the target (basedOn names the round)", async () => {
    const seen: string[] = [];
    const { host } = makeHost(async (req, h) => {
      seen.push(JSON.stringify(req.messages));
      return answer(seen.length === 1 ? PARTS : '{"changes":[{"op":"change","name":"A","size":[2]}]}')(req, h);
    });
    await send(host, "a box");
    await send(host, "make it bigger");
    expect(roundsOf(host)).toHaveLength(2);
    expect(roundsOf(host)[1]).toMatchObject({ kind: "refine", basedOn: 0 });
    // Die zweite Anfrage trägt die Teile der ersten Runde (als JSON im Auftrag) und den Änderungswunsch.
    expect(seen[1]).toContain('\\"name\\":\\"A\\"');
    expect(seen[1]).toContain("make it bigger");
  });

  it("turns an unusable answer into an error with the hint, no round, and keeps the raw text for the person to see", async () => {
    const { host } = makeHost(answer("Sorry, I cannot"));
    await send(host, "a box");
    expect(roundsOf(host)).toHaveLength(0);
    expect(host.live().status.phase).toBe("error");
    expect(host.live().status.text).toContain("no JSON in the answer");
    expect(host.live().status.text).toContain("measured best");
    // Der Rohtext bleibt im Puffer stehen (der Rahmen zeigt ihn im Antwortbereich).
    expect(host.live().answer).toBe("Sorry, I cannot");
  });

  it("after a success the raw answer is gone from the buffer (the round and the preview show the result)", async () => {
    const { host } = makeHost(answer(PARTS));
    await send(host, "a box");
    expect(host.live().answer).toBe("");
  });

  it("uses what was streamed when the final content is empty, and forgets it when the client says it was thinking (Gemma 4 without an opener)", async () => {
    const streamed = makeHost(async (_req, h) => {
      h.onToken?.(PARTS);
      return okResult("");
    });
    await send(streamed.host, "a box");
    expect(roundsOf(streamed.host)).toHaveLength(1);
    const reset = makeHost(async (_req, h) => {
      h.onToken?.("Let me think about the table.");
      h.onContentReset?.();
      return okResult("");
    });
    await send(reset.host, "a box");
    // Nach dem Rücksetzen bleibt nichts zum Lesen: keine Runde, und die Anzeige trägt den Denktext nicht mehr als Antwort.
    expect(roundsOf(reset.host)).toHaveLength(0);
    expect(reset.host.live().answer).toBe("");
  });

  it("reports a request cancelled by the client as stopped", async () => {
    const { host } = makeHost(async () => ({ ok: false, kind: "aborted", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: {} }));
    await send(host, "a box");
    expect(host.live().status).toEqual({ phase: "idle", text: "Stopped." });
    expect(roundsOf(host)).toHaveLength(0);
  });

  it("aborting stops the request and writes no round, even if the result still arrives ok", async () => {
    const h = held(PARTS);
    let seen: AbortSignal | undefined;
    const { host } = makeHost((req, handlers) => { seen = handlers.signal; return h.complete(req, handlers); });
    expect(host.start("a box")).toBe(true);
    expect(host.running()).toBe(true);
    host.abort();
    expect(seen?.aborted).toBe(true);
    h.release();
    await host.settled();
    expect(roundsOf(host)).toHaveLength(0);
    expect(host.live().status).toEqual({ phase: "idle", text: "Stopped." });
  });

  it("a destroyed host writes nothing and aborts the request (the plugin was unloaded during the run)", async () => {
    const h = held(PARTS);
    let seen: AbortSignal | undefined;
    const { host } = makeHost((req, handlers) => { seen = handlers.signal; return h.complete(req, handlers); });
    host.start("a box");
    host.destroy();
    expect(seen?.aborted).toBe(true);
    h.release();
    await host.settled();
    expect(host.session().rounds.rounds).toHaveLength(0);
  });

  it("shows the no-endpoint reason (a manager code gets its text), and sending works again once an endpoint exists", async () => {
    let configured = false;
    const good = answer(PARTS);
    const { host } = makeHost(async (req, h) =>
      configured
        ? good(req, h)
        : { ok: false, kind: "no-endpoint", detail: "disabled", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: { kind: "manager" } },
    );
    await send(host, "a box");
    // `disabled` ist ein Code des Managers: der Nutzer liest, wo er es behebt, nicht den rohen Code.
    expect(host.live().noEndpoint).toContain("switched off in the LLM Endpoint Manager");
    expect(host.live().status.phase).toBe("error");
    expect(roundsOf(host)).toHaveLength(0);
    // Keine Sackgasse: nach der Konfiguration geht Senden wieder, der Zustand verschwindet.
    configured = true;
    await send(host, "a box");
    expect(host.live().noEndpoint).toBeNull();
    expect(roundsOf(host)).toHaveLength(1);
  });

  it("no-endpoint from the local list keeps the plain reason, even when it looks like a manager code", async () => {
    const { host } = makeHost(async () => ({ ok: false, kind: "no-endpoint", detail: "disabled", partial: "", reasoning: "", timing: TIMING, facts: null, deviations: [], source: { kind: "local" } }));
    await send(host, "a box");
    expect(host.live().noEndpoint).toBe("Reason: disabled");
  });

  it("reports a truncated answer as cut off, without a round", async () => {
    const { host } = makeHost(async () => okResult('{"parts":[', { truncated: true }));
    await send(host, "a box");
    expect(host.live().status.text).toContain("cut off");
    expect(roundsOf(host)).toHaveLength(0);
  });

  it("recovers when readTargetText rejects: the error is the status, the run ends, the panel is free again", async () => {
    const { host } = makeHost(answer("{}"), async () => { throw new Error("disk gone"); }, { target: BLOCK, rounds: EMPTY_ROUNDS });
    await send(host, "raise");
    expect(host.running()).toBe(false);
    expect(host.live().status).toEqual({ phase: "error", text: "disk gone" });
    expect(host.start("raise again")).toBe(true);
    await host.settled();
  });

  it("a refine of a block whose text is gone says so (click it again); of a file, the model is gone", async () => {
    const block = makeHost(answer(CHANGES), async () => null, { target: BLOCK, rounds: EMPTY_ROUNDS });
    await send(block.host, "raise");
    expect(block.host.live().status.text).toBe(PANEL_TEXTS.blockGone);
    const file = makeHost(answer(CHANGES), async () => null, { target: FILE, rounds: EMPTY_ROUNDS });
    await send(file.host, "raise");
    expect(file.host.live().status.text).toBe(PANEL_TEXTS.modelGone);
    expect(roundsOf(file.host)).toHaveLength(0);
  });

  it("a request with no usable change (the answer changes nothing) is an error, not a round", async () => {
    const { host } = makeHost(answer('{"changes":[{"op":"change","name":"Platte","position":[0,0.725,0]}]}'), async () => TABLE, { target: BLOCK, rounds: EMPTY_ROUNDS });
    await send(host, "raise");
    expect(roundsOf(host)).toHaveLength(0);
    expect(host.live().status.text).toContain(PANEL_TEXTS.answerChangesNothing);
  });

  it("keeps target new while a create request runs: the offered target is held, the round belongs to new", async () => {
    const h = held(PARTS);
    const { host } = makeHost(h.complete);
    host.start("a box");
    host.offer(BLOCK);
    expect(host.session().target).toEqual({ kind: "new" });
    expect(host.kept()).toBe(true);
    h.release();
    await host.settled();
    expect(host.session().target).toEqual({ kind: "new" });
    expect(roundsOf(host)).toHaveLength(1);
    expect(host.offered()).toEqual(BLOCK);
  });

  it("keeps target A while a refine request runs and B is offered; a round is open, so Discard takes B", async () => {
    const h = held(CHANGES);
    const { host } = makeHost(h.complete, async () => TABLE, { target: BLOCK, rounds: EMPTY_ROUNDS });
    host.start("raise");
    host.offer(FILE);
    await h.started;
    h.release();
    await host.settled();
    expect(roundsOf(host)).toHaveLength(1);
    expect(host.session().target).toEqual(BLOCK);
    expect(host.kept()).toBe(true);
    host.discard();
    expect(host.session().target).toEqual(FILE);
    expect(roundsOf(host)).toHaveLength(0);
  });

  it("a target of kind other cannot be sent to", () => {
    const { host } = makeHost(answer(PARTS), async () => null, { target: OTHER, rounds: EMPTY_ROUNDS });
    expect(host.start("x")).toBe(false);
  });
});

describe("shapesWays — die Schreibwege", () => {
  const round = (text = "box A size 1 1 1"): ShapesRound => ({ kind: "create", instruction: "x", text, model: "m", at: 1 });
  const stateOf = (target: PanelTarget, ...rs: ShapesRound[]): PanelState => ({ target, rounds: rs.reduce((a, r) => pushRound(a, r), EMPTY_ROUNDS as PanelState["rounds"]) });
  const md = (reading = false) => ({ file: { path: "n.md" }, getMode: () => (reading ? "preview" : "source"), editor: {} });
  const base = (over: Partial<Parameters<typeof shapesWays>[1]> = {}) => ({ primary: "block" as const, lastEditor: () => md() as never, app: makeFakeApp() as never, ...over });

  it("a new target has two buttons, block at the cursor and file; the setting picks the main button (the first)", () => {
    const s = stateOf({ kind: "new" }, round());
    expect(shapesWays(s, base()).map((w) => [w.id, w.where, w.label])).toEqual([["block", "block", PANEL_TEXTS.acceptBlock], ["file", "file", PANEL_TEXTS.acceptFile]]);
    expect(shapesWays(s, base({ primary: "file" })).map((w) => w.id)).toEqual(["file", "block"]);
  });

  it("an existing block or file has one way, Apply", () => {
    for (const target of [BLOCK, FILE]) {
      const ways = shapesWays(stateOf(target, round()), base());
      expect(ways.map((w) => [w.id, w.where, w.label])).toEqual([["apply", undefined, PANEL_TEXTS.accept]]);
    }
  });

  it("the block way names its reason when no note is open or the note is in reading view; the file way never needs a note", () => {
    const s = stateOf({ kind: "new" }, round());
    const open = shapesWays(s, base());
    expect(open[0]?.blockedReason?.(s)).toBeNull();
    const none = shapesWays(s, base({ lastEditor: () => null }));
    expect(none[0]?.blockedReason?.(s)).toBe(PANEL_TEXTS.noNoteOpen);
    const reading = shapesWays(s, base({ lastEditor: () => md(true) as never }));
    expect(reading[0]?.blockedReason?.(s)).toBe(PANEL_TEXTS.noteInReadingView);
    expect(none[1]?.blockedReason).toBeUndefined();
  });

  it("the kind follows the chain: a chain that starts with create is create, a refine chain is refine", () => {
    const create = stateOf({ kind: "new" }, round());
    expect(shapesWays(create, base())[0]?.kind(create)).toBe("create");
    const refine = stateOf(BLOCK, { kind: "refine", instruction: "x", changes: [], basedOn: null, text: TABLE, diff: [], model: "m", at: 1 });
    expect(shapesWays(refine, base())[0]?.kind(refine)).toBe("refine");
  });

  it("every way carries a description without beforeWrite (the frame sets the snapshot)", () => {
    const s = stateOf({ kind: "new" }, round());
    for (const w of shapesWays(s, base())) expect(w.spec).not.toHaveProperty("beforeWrite");
  });

  describe("prepare: open .shapes views are saved before writing (only for a file target)", () => {
    const withViews = (views: { path: string; save: () => Promise<void> }[]) => {
      const app = makeFakeApp();
      app.workspace.getLeavesOfType = vi.fn((t: string) => (t === "tdcb-shapes-file" ? views.map((v) => ({ view: { file: { path: v.path }, save: v.save, getViewData: () => "" } })) : []));
      return app;
    };
    it("saves the open view of the target file, not another file's", async () => {
      const mine = vi.fn(async () => {});
      const other = vi.fn(async () => {});
      const app = withViews([{ path: "a.shapes", save: mine }, { path: "b.shapes", save: other }]);
      const s = stateOf(FILE, round());
      await shapesWays(s, base({ app: app as never }))[0]!.prepare!(s);
      expect(mine).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
    });
    it("a view that cannot save aborts the write with its message (nothing is written)", async () => {
      const app = withViews([{ path: "a.shapes", save: async () => { throw new Error("disk full"); } }]);
      const s = stateOf(FILE, round());
      await expect(shapesWays(s, base({ app: app as never }))[0]!.prepare!(s)).rejects.toThrow("disk full");
    });
    it("a block target and a new target touch no view", async () => {
      const save = vi.fn(async () => {});
      const app = withViews([{ path: "a.shapes", save }]);
      for (const target of [BLOCK, { kind: "new" } as PanelTarget]) {
        const s = stateOf(target, round());
        await shapesWays(s, base({ app: app as never }))[0]!.prepare!(s);
      }
      expect(save).not.toHaveBeenCalled();
    });
  });
});

describe("Texte des Rahmens", () => {
  it("overrides only what is ours: the name of the target, the placeholders, the examples and the unsupported-target text", () => {
    setLang("en");
    const s = promptPanelStrings();
    expect(Object.keys(s).sort()).toEqual(["emptyText", "examples", "placeholderCreate", "placeholderRefine", "targetNew", "unsupported"]);
    expect(s.targetNew).toBe("New model");
    expect(s.examples).toEqual(["A snowman from three spheres with a cone nose.", "A bookshelf with three shelves, 1.8 m high."]);
    expect(s.unsupported?.("glTF")).toBe("glTF can't be changed by prompt.");
  });
});

describe("PromptPanelView — die Ansicht schließt den Kit-Rahmen richtig an", () => {
  function makeView(extra: Partial<PromptPanelDeps> = {}) {
    const host = makeHost(answer(PARTS)).host as never;
    const llm = makeLlm(answer(PARTS));
    const panel = { requestClose: vi.fn(async () => {}), refreshModelBar: vi.fn(), refreshAccept: vi.fn(), reloadModels: vi.fn(), settled: vi.fn(async () => {}), destroy: vi.fn() };
    vi.mocked(buildPromptPanel).mockReset();
    vi.mocked(buildPromptPanel).mockReturnValue(panel as never);
    const accept = { app: makeFakeApp(), ports: {}, lastEditor: () => null, strings: {}, readingMode: "refuse" };
    const deps = {
      settings: () => DEFAULT_SETTINGS,
      factory: { isWebGLAvailable: () => true, create: () => ({ setModel: vi.fn(), setView: vi.fn(), getView: vi.fn(() => null), setColors: vi.fn(), resize: vi.fn(), resetCamera: vi.fn(), capturePoster: () => "", dispose: vi.fn() }) },
      budget: { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() },
      loadModel: vi.fn().mockResolvedValue({ object: {}, cameras: [] }),
      readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
      host,
      llm,
      thinking: { family: () => null, current: () => "off", onLevel: () => "low", setLevel: vi.fn(), levelPicker: () => false },
      readTargetText: vi.fn(async () => null),
      openSettings: vi.fn(),
      accept,
      primaryWay: () => "block" as const,
      pluginId: "three-d-codeblocks",
      ...extra,
    };
    const view = new PromptPanelView({ app: makeFakeApp() } as never, deps as never);
    return { view, deps, host: deps.host, panel, accept };
  }
  const built = () => vi.mocked(buildPromptPanel).mock.calls[0]!;

  it("onOpen builds the frame in the content element, on the plugin's host, with the plugin id for the snapshot and the plugin's own texts", async () => {
    const { view, host, deps, accept } = makeView();
    await view.onOpen();
    const [root, usedHost, frameDeps] = built();
    expect(root).toBe((view as unknown as { contentEl: unknown }).contentEl);
    expect(usedHost).toBe(host);
    expect(frameDeps).toMatchObject({ pluginId: "three-d-codeblocks", accept, lang: "en", llm: deps.llm });
    expect(Object.keys(frameDeps.strings ?? {}).sort()).toEqual(Object.keys(promptPanelStrings()).sort());
    expect(frameDeps.strings?.targetNew).toBe(PANEL_TEXTS.targetNew);
    // Die Kit-Wahl „Block oder Datei“ und die Einstellung des Plugins gehen nie in den Rahmen (beide Wege sind Knöpfe).
    expect(Object.keys(frameDeps.accept)).not.toContain("settings");
    expect(Object.keys(frameDeps.accept)).not.toContain("choose");
  });

  it("onClose asks first (requestClose), then lets go (destroy) — the dialog runs on after destroy and reaches the host, not the frame", async () => {
    const { view, panel } = makeView();
    await view.onOpen();
    await view.onClose();
    expect(panel.requestClose).toHaveBeenCalledTimes(1);
    expect(panel.destroy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(panel.requestClose).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(panel.destroy).mock.invocationCallOrder[0]!);
    // Zweimal schließen tut nichts mehr.
    await view.onClose();
    expect(panel.destroy).toHaveBeenCalledTimes(1);
  });

  it("closing the view does not abort the run or drop the rounds: the host belongs to the plugin, not to the view", async () => {
    const h = held(PARTS);
    const { view, host } = makeView({ host: makeHost(h.complete).host as never });
    await view.onOpen();
    expect(view.running()).toBe(false);
    host.start("a box");
    expect(view.running()).toBe(true);
    await view.onClose();
    expect(view.running()).toBe(true);
    h.release();
    await host.settled();
    expect(view.state().rounds.rounds).toHaveLength(1);
  });

  it("state() and running() read the host; refresh calls go to the frame and are harmless before onOpen", async () => {
    const { view, host, panel } = makeView();
    expect(() => { view.refreshModelBar(); view.reloadModels(); view.refreshAccept(); }).not.toThrow();
    await view.onOpen();
    expect(view.state()).toBe(host.session());
    view.refreshModelBar();
    view.reloadModels();
    view.refreshAccept();
    expect(panel.refreshModelBar).toHaveBeenCalledTimes(1);
    expect(panel.reloadModels).toHaveBeenCalledTimes(1);
    expect(panel.refreshAccept).toHaveBeenCalledTimes(1);
  });

  it("opening twice lets the first frame go (one frame per view)", async () => {
    const { view, panel } = makeView();
    await view.onOpen();
    await view.onOpen();
    expect(panel.destroy).toHaveBeenCalledTimes(1);
  });

  describe("slots", () => {
    const slotsOf = async (extra: Partial<PromptPanelDeps> = {}) => {
      const made = makeView(extra);
      await made.view.onOpen();
      return { ...made, slots: built()[3] };
    };
    const refineRound: ShapesRound = { kind: "refine", instruction: "raise", changes: [], basedOn: null, text: TABLE, diff: ["Platte: at 0 0.725 0 → 0 0.925 0"], model: "m", at: 1 };
    const createRound: ShapesRound = { kind: "create", instruction: "a table", text: TABLE, model: "m", at: 1 };

    it("labels the rounds with their number and instruction; the meta line says new or the number of changes", async () => {
      const { slots } = await slotsOf();
      expect(slots.roundLabel(createRound, 0)).toBe("1. a table");
      expect(slots.roundLabel(refineRound, 2)).toBe("3. raise");
      expect(slots.roundMeta(createRound)).toBe("new");
      expect(slots.roundMeta(refineRound)).toBe("1 change(s)");
      expect(slots.roundText(refineRound)).toBe(TABLE);
    });

    it("lists the changes of a refine round under a heading, and nothing for a create round or none", async () => {
      const { slots } = await slotsOf();
      const host = makeFakeEl();
      slots.renderChanges(host, createRound, INITIAL_PANEL, {} as never);
      slots.renderChanges(host, null, INITIAL_PANEL, {} as never);
      expect(host.children).toHaveLength(0);
      slots.renderChanges(host, refineRound, INITIAL_PANEL, {} as never);
      expect(host.children.map((c: { className: string }) => c.className)).toEqual(["tdcb-prompt-diff-heading", "tdcb-prompt-diff"]);
      expect(host.children[1].children.map((li: { textContent: string }) => li.textContent)).toEqual(["Platte: at 0 0.725 0 → 0 0.925 0"]);
    });

    it("the quality line is the plugin's own measurement", async () => {
      const { slots } = await slotsOf();
      expect(slots.quality("unknown/model", "create")).toMatchObject({ measured: false });
      expect(slots.quality("unknown/model", "create").text).toContain("Not measured for this model");
    });

    it("the write ways follow the setting for the main button", async () => {
      const { slots } = await slotsOf({ primaryWay: () => "file" });
      const s: PanelState = { target: { kind: "new" }, rounds: pushRound(EMPTY_ROUNDS as PanelState["rounds"], createRound) };
      expect(slots.acceptWays(s).map((w: { id: string }) => w.id)).toEqual(["file", "block"]);
    });

    describe("a preview drawn earlier never overwrites a newer one (K9 Review: the old panel had no ticket)", () => {
      /** loadModel, dessen Antworten der Test einzeln freigibt. */
      function deferredLoads() {
        const pending: { resolve: (v: unknown) => void }[] = [];
        const loadModel = vi.fn(() => new Promise((resolve) => { pending.push({ resolve }); }));
        return { loadModel, finish: (i: number) => pending[i]!.resolve({ object: { i }, cameras: [] }) };
      }
      const viewports: { setModel: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];
      const factory = {
        isWebGLAvailable: () => true,
        create: () => {
          const vp = { setModel: vi.fn(), dispose: vi.fn(), setView: vi.fn(), getView: vi.fn(() => null), setColors: vi.fn(), resize: vi.fn(), resetCamera: vi.fn(), capturePoster: () => "" };
          viewports.push(vp);
          return vp;
        },
      };

      it("the older draw finishing last neither shows its model nor keeps its viewport; the newer draw's viewport stays", async () => {
        viewports.length = 0;
        const loads = deferredLoads();
        const { slots, view } = await slotsOf({ loadModel: loads.loadModel as never, factory: factory as never });
        const rd = (n: number): ShapesRound => ({ kind: "create", instruction: String(n), text: `box A${n} size 1 1 1`, model: "m", at: n });
        const first = slots.renderPreview(makeFakeEl(), rd(1), "box A1 size 1 1 1", { current: () => false });
        // Die ältere Vorschau lädt schon, wenn die neuere beginnt (sonst kommt die ältere nie bis zum Laden: der Abbau der Hülle fängt sie vorher).
        await vi.waitFor(() => expect(loads.loadModel).toHaveBeenCalledTimes(1));
        const second = slots.renderPreview(makeFakeEl(), rd(2), "box A2 size 1 1 1", { current: () => true });
        await vi.waitFor(() => expect(loads.loadModel).toHaveBeenCalledTimes(2));
        // Die neuere Vorschau wird zuerst fertig, die ältere zuletzt.
        loads.finish(1);
        await second;
        loads.finish(0);
        await first;
        // Gezeigt wird genau ein Modell, das der neueren Runde; der Viewport der älteren (falls er je entstand) ist freigegeben.
        const shown = viewports.filter((v) => v.setModel.mock.calls.length > 0);
        expect(shown.map((v) => (v.setModel.mock.calls[0]![0] as { i: number }).i)).toEqual([1]);
        expect(shown.filter((v) => v.dispose.mock.calls.length === 0)).toHaveLength(1);
        expect((view as unknown as { previewHost: unknown }).previewHost).not.toBeNull();
        await view.onClose();
        expect(viewports.every((v) => v.dispose.mock.calls.length > 0 || v.setModel.mock.calls.length === 0)).toBe(true);
      });

      it("a preview with no round or no text draws nothing and gives the earlier viewport back", async () => {
        viewports.length = 0;
        const loads = deferredLoads();
        const { slots } = await slotsOf({ loadModel: loads.loadModel as never, factory: factory as never });
        const drawn = slots.renderPreview(makeFakeEl(), createRound, TABLE, { current: () => true });
        await vi.waitFor(() => expect(loads.loadModel).toHaveBeenCalledTimes(1));
        loads.finish(0);
        await drawn;
        const created = viewports.length;
        await slots.renderPreview(makeFakeEl(), null, null, { current: () => true });
        expect(viewports.length).toBe(created);
        expect(viewports.at(-1)!.dispose).toHaveBeenCalled();
      });
    });
  });
});
