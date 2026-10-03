import { describe, expect, it } from "vitest";
import {
  acceptText,
  baseTextForRefine,
  chainOf,
  followTarget,
  INITIAL_PANEL,
  type PanelState,
  type PanelTarget,
  type ShapesRound,
} from "../../../src/core/shapes/panel-state";
import { pushRound, selectRound, type Rounds } from "../../../src/vendor/kit/rounds";
import type { RawChange } from "../../../src/core/shapes/protocol";

const deepFreeze = <T>(o: T): T => {
  if (typeof o === "object" && o !== null && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

const BLOCK: PanelTarget = { kind: "shapes-block", path: "n.md", lineStart: 2, lineEnd: 5, label: "Tisch" };
const OTHER: PanelTarget = { kind: "shapes-file", path: "x.shapes", label: "x" };
const TABLE = "box Platte size 1.2 0.05 0.7 at 0 0.725 0\nbox Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3";

const refine = (instruction: string, changes: RawChange[], basedOn: number | null, text = ""): ShapesRound => ({
  kind: "refine",
  instruction,
  changes,
  basedOn,
  text,
  diff: [],
  model: "m",
  at: 0,
});
const create = (text: string): ShapesRound => ({ kind: "create", instruction: "t", text, model: "m", at: 0 });
const chainRounds = (...rs: ShapesRound[]): Rounds<ShapesRound> => rs.reduce((acc, r) => pushRound(acc, r), INITIAL_PANEL.rounds as Rounds<ShapesRound>);
const up = (name: string, y: number): RawChange => ({ op: "change", name, at: [0, y, 0] });

describe("followTarget", () => {
  it("follows while there are no rounds", () => {
    expect(followTarget(INITIAL_PANEL, BLOCK)).toEqual({ state: { ...INITIAL_PANEL, target: BLOCK }, kept: false });
  });
  it("keeps the target while rounds are open and reports kept for a different target", () => {
    const s: PanelState = { target: BLOCK, rounds: chainRounds(refine("x", [], null, TABLE)) };
    expect(followTarget(s, OTHER)).toEqual({ state: s, kept: true });
  });
  it("equal target with rounds open: same state, kept false", () => {
    const s: PanelState = { target: BLOCK, rounds: chainRounds(refine("x", [], null, TABLE)) };
    const r = followTarget(s, { ...BLOCK, label: "other label" });
    expect(r.kept).toBe(false);
    expect(r.state).toBe(s);
  });
  it("a block with moved lines counts as a different target while rounds are open", () => {
    const s: PanelState = { target: BLOCK, rounds: chainRounds(refine("x", [], null, TABLE)) };
    expect(followTarget(s, { ...BLOCK, lineStart: 4, lineEnd: 7 }).kept).toBe(true);
    expect(followTarget(s, { ...BLOCK, path: "m.md" }).kept).toBe(true);
  });
  it("other/new targets compare by kind and label", () => {
    const s: PanelState = { target: { kind: "new" }, rounds: chainRounds(create("box A size 1")) };
    expect(followTarget(s, { kind: "new" }).kept).toBe(false);
    expect(followTarget(s, { kind: "other", label: "a" }).kept).toBe(true);
    const o: PanelState = { target: { kind: "other", label: "a" }, rounds: s.rounds };
    expect(followTarget(o, { kind: "other", label: "a" }).kept).toBe(false);
    expect(followTarget(o, { kind: "other", label: "b" }).kept).toBe(true);
  });
  it("does not mutate", () => {
    const s = deepFreeze<PanelState>({ target: BLOCK, rounds: chainRounds(refine("x", [], null, TABLE)) });
    expect(() => followTarget(s, OTHER)).not.toThrow();
    expect(() => followTarget(deepFreeze({ ...INITIAL_PANEL }), BLOCK)).not.toThrow();
  });
});

describe("chainOf", () => {
  it("is empty for no rounds", () => {
    expect(chainOf(INITIAL_PANEL.rounds)).toEqual([]);
  });
  it("follows basedOn back to the first round (selected middle round)", () => {
    const r = chainRounds(refine("a", [], null), refine("b", [], 0), refine("c", [], 1));
    expect(chainOf(selectRound(r, 1)).map((x) => x.instruction)).toEqual(["a", "b"]);
    expect(chainOf(r).map((x) => x.instruction)).toEqual(["a", "b", "c"]);
  });
  it("diamond: two refines on the same earlier round do not see each other", () => {
    const r = chainRounds(refine("a", [], null), refine("b", [], 0), refine("c", [], 0));
    expect(chainOf(r).map((x) => x.instruction)).toEqual(["a", "c"]);
    expect(chainOf(selectRound(r, 1)).map((x) => x.instruction)).toEqual(["a", "b"]);
  });
  it("a refine with basedOn null refines the target: chain stops there", () => {
    const r = chainRounds(refine("a", [], null), refine("b", [], null));
    expect(chainOf(r).map((x) => x.instruction)).toEqual(["b"]);
  });
  it("cycle: terminates with the exact partial chain", () => {
    const cyc = deepFreeze<Rounds<ShapesRound>>({ rounds: [refine("a", [], 1), refine("b", [], 0)], active: 1 });
    expect(chainOf(cyc).map((x) => x.instruction)).toEqual(["a", "b"]);
  });
  it("self reference and out-of-range basedOn terminate with the partial chain", () => {
    const self = deepFreeze<Rounds<ShapesRound>>({ rounds: [refine("a", [], 0)], active: 0 });
    expect(chainOf(self).map((x) => x.instruction)).toEqual(["a"]);
    expect(chainOf(chainRounds(refine("a", [], 7))).map((x) => x.instruction)).toEqual(["a"]);
  });
});

describe("acceptText", () => {
  it("re-applies the chain to the CURRENT text, keeping hand edits elsewhere", () => {
    const rounds = chainRounds(refine("higher", [{ op: "change", name: "Platte", at: [0, 0.925, 0] }], null, "stale stored text"), refine("black", [{ op: "change", name: "Bein-1", color: "#000000" }], 0, "stale stored text"));
    const handEdited = TABLE.replace("0.05 0.7 0.05", "0.06 0.7 0.06");
    expect(acceptText(deepFreeze(rounds), handEdited)).toEqual({
      ok: true,
      unchanged: false,
      text: "box Platte size 1.2 0.05 0.7 at 0 0.925 0\nbox Bein-1 size 0.06 0.7 0.06 at -0.55 0.35 -0.3 color #000000",
    });
  });

  it("follows the chosen round's chain, not the last round", () => {
    let rounds = chainRounds(refine("a", [up("Platte", 1)], null), refine("b", [up("Platte", 2)], null));
    rounds = selectRound(rounds, 0);
    expect(chainOf(rounds).map((r) => r.instruction)).toEqual(["a"]);
    expect(acceptText(rounds, TABLE)).toMatchObject({ ok: true, text: expect.stringContaining("at 0 1 0") });
  });

  it("diamond: the active branch is applied, the sibling is not", () => {
    const rounds = chainRounds(refine("a", [up("Platte", 1)], null), refine("b", [{ op: "change", name: "Bein-1", color: "#111111" }], 0), refine("c", [{ op: "change", name: "Bein-1", color: "#222222" }], 0));
    const r = acceptText(rounds, TABLE);
    expect(r).toEqual({
      ok: true,
      unchanged: false,
      text: "box Platte size 1.2 0.05 0.7 at 0 1 0\nbox Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3 color #222222",
    });
  });

  it("selected middle round: later rounds are not applied", () => {
    const rounds = selectRound(chainRounds(refine("a", [up("Platte", 1)], null), refine("b", [up("Platte", 2)], 0)), 0);
    expect(acceptText(rounds, TABLE)).toMatchObject({ ok: true, text: expect.stringContaining("at 0 1 0") });
  });

  it("starts a new model from its create round and ignores the current text", () => {
    const rounds = chainRounds(create("box A size 1"), refine("up", [up("A", 1)], 0));
    const expected = { ok: true, unchanged: false, text: "box A size 1 1 1 at 0 1 0" };
    expect(acceptText(rounds, null)).toEqual(expected);
    expect(acceptText(rounds, TABLE)).toEqual(expected);
  });

  it("a create round alone returns its text", () => {
    expect(acceptText(chainRounds(create("box A size 1")), null)).toEqual({ ok: true, unchanged: false, text: "box A size 1" });
  });

  it("pure refine chain with no current text: the model is gone", () => {
    const rounds = chainRounds(refine("x", [up("Platte", 1)], null));
    expect(acceptText(rounds, null)).toEqual({ ok: false, problems: ["the model to change is gone"] });
  });

  it("refuses when a hand edit removed a part the chain touches — lists the problem, returns no text", () => {
    const rounds = chainRounds(refine("x", [{ op: "change", name: "Bein-1", color: "#000000" }], null));
    const r = acceptText(rounds, "box Platte size 1");
    expect(r).toEqual({ ok: false, problems: ["round 1: change 1: no part named `Bein-1` (available: Platte)"] });
    expect(r).not.toHaveProperty("text");
  });

  it("a failing step aborts the whole chain (no partial application, no skipped round)", () => {
    const rounds = chainRounds(refine("a", [{ op: "change", name: "Weg", color: "#000000" }], null), refine("b", [up("Platte", 1)], 0));
    const r = acceptText(rounds, TABLE);
    expect(r).toEqual({ ok: false, problems: ["round 1: change 1: no part named `Weg` (available: Platte, Bein-1)"] });
    expect(r).not.toHaveProperty("text");
  });

  it("refuses a step whose values became invalid after a hand edit", () => {
    const rounds = chainRounds(refine("x", [{ op: "change", name: "Platte", color: "red" }], null));
    expect(acceptText(rounds, TABLE)).toEqual({ ok: false, problems: ["round 1: change 1: `Platte`: `color` needs a hex colour like #8b5a2b"] });
  });

  it("refuses an ambiguous name after a hand edit", () => {
    const rounds = chainRounds(refine("x", [up("bein 1", 1)], null));
    const text = "box Bein-1 size 1\nbox bein_1 size 1";
    expect(acceptText(rounds, text)).toEqual({ ok: false, problems: ["round 1: change 1: `bein 1` matches more than one part: Bein-1, bein_1"] });
  });

  it("refuses a strict add that clashes with a hand-added part", () => {
    const rounds = chainRounds(refine("x", [{ op: "add", part: { op: "add", name: "Neu", shape: "box", size: [1, 1, 1] } }], null));
    expect(acceptText(rounds, `${TABLE}\nbox Neu size 1`)).toEqual({
      ok: false,
      problems: ["round 1: change 1 (add): a part named `Neu` already exists — remove it first or pick another name"],
    });
  });

  it("basedOn out of range: names both list numbers", () => {
    expect(acceptText(chainRounds(refine("a", [up("Platte", 1)], 9)), TABLE)).toEqual({
      ok: false,
      problems: ["the round chain is broken (round 1 refers to round 10 which does not exist)"],
    });
  });
  it("forward and self references are told apart from missing rounds", () => {
    const cyc = deepFreeze<Rounds<ShapesRound>>({ rounds: [refine("a", [], 1), refine("b", [], 0)], active: 1 });
    expect(acceptText(cyc, TABLE)).toEqual({ ok: false, problems: ["the round chain is broken (round 1 points forward to round 2)"] });
    const self = deepFreeze<Rounds<ShapesRound>>({ rounds: [refine("a", [], 0)], active: 0 });
    expect(acceptText(self, TABLE)).toEqual({ ok: false, problems: ["the round chain is broken (round 1 points to itself)"] });
  });

  it("problem numbers are LIST numbers as the panel shows them", () => {
    const miss = { op: "change", name: "Weg", color: "#000000" } as const;
    const msg = (n: string): string => `round ${n}: change 1: no part named \`Weg\` (available: Platte, Bein-1)`;
    // diamond: c (list 3) is active, chain a -> c; the chain position of c is 2
    const diamond = chainRounds(refine("a", [up("Platte", 1)], null), refine("b", [up("Platte", 2)], 0), refine("c", [miss], 0));
    expect(acceptText(diamond, TABLE)).toEqual({ ok: false, problems: [msg("3")] });
    // step back to round 1, refine from it: round 3 builds on 1 while round 2 stays in the list
    const stepped = chainRounds(refine("a", [up("Platte", 1)], null), refine("b", [up("Platte", 2)], 0));
    const refined = pushRound(selectRound(stepped, 0), refine("c", [miss], 0));
    expect(acceptText(refined, TABLE)).toEqual({ ok: false, problems: [msg("3")] });
    // single round that is the 5th in the list
    const five = chainRounds(refine("1", [], null), refine("2", [], null), refine("3", [], null), refine("4", [], null), refine("5", [miss], null));
    expect(acceptText(five, TABLE)).toEqual({ ok: false, problems: [msg("5")] });
  });

  it("an active index outside the list is a broken chain, not a crash", () => {
    const bad = deepFreeze<Rounds<ShapesRound>>({ rounds: [], active: 3 });
    expect(acceptText(bad, TABLE).ok).toBe(false);
  });

  it("refuses an empty selection", () => {
    expect(acceptText(INITIAL_PANEL.rounds, TABLE)).toEqual({ ok: false, problems: ["nothing to apply"] });
  });

  it("a chain that changes nothing is ok but flagged unchanged", () => {
    const rounds = chainRounds(refine("noop", [{ op: "change", name: "Platte" }], null));
    expect(acceptText(rounds, TABLE)).toEqual({ ok: true, unchanged: true, text: TABLE });
    const empty = chainRounds(refine("noop", [], null));
    expect(acceptText(empty, TABLE)).toEqual({ ok: true, unchanged: true, text: TABLE });
  });

  it("a create chain equal to the current text is flagged unchanged", () => {
    expect(acceptText(chainRounds(create(TABLE)), TABLE)).toEqual({ ok: true, unchanged: true, text: TABLE });
  });

  it("does not throw on malformed stored changes", () => {
    const bad = chainRounds(refine("x", null as unknown as RawChange[], null));
    expect(acceptText(bad, TABLE).ok).toBe(false);
  });
});

describe("baseTextForRefine", () => {
  it("is the active round's text, else the target's current text", () => {
    expect(baseTextForRefine({ target: BLOCK, rounds: INITIAL_PANEL.rounds }, TABLE)).toBe(TABLE);
    const s: PanelState = { target: BLOCK, rounds: chainRounds(refine("x", [], null, "box Z size 1")) };
    expect(baseTextForRefine(s, TABLE)).toBe("box Z size 1");
  });
  it("follows the selected round", () => {
    const s: PanelState = { target: BLOCK, rounds: selectRound(chainRounds(refine("a", [], null, "box A size 1"), refine("b", [], 0, "box B size 1")), 0) };
    expect(baseTextForRefine(s, TABLE)).toBe("box A size 1");
  });
  it("is null when neither exists", () => {
    expect(baseTextForRefine({ target: BLOCK, rounds: INITIAL_PANEL.rounds }, null)).toBeNull();
  });
  it("target new without rounds: null even with a current text", () => {
    expect(baseTextForRefine(INITIAL_PANEL, TABLE)).toBeNull();
    expect(baseTextForRefine(INITIAL_PANEL, null)).toBeNull();
  });
  it("target new with rounds uses the active round", () => {
    const s: PanelState = { target: { kind: "new" }, rounds: chainRounds(create("box A size 1")) };
    expect(baseTextForRefine(s, null)).toBe("box A size 1");
  });
});
