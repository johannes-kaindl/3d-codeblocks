import { describe, expect, it } from "vitest";
import { EditSession } from "../../src/core/edit-session";
import type { EditableNode } from "../../src/core/gltf-patch";

const trs = (t: [number, number, number], s: [number, number, number] = [1, 1, 1]) => ({
  translation: t,
  scale: s,
});

function nodes(): EditableNode[] {
  return [
    { index: 0, name: "privat-herd", base: trs([1, 0, 2]), lock: null },
    { index: 2, name: "privat-bad", base: trs([-3, 0, 1]), lock: null },
    { index: 3, name: "env__gelaende", base: trs([0, -0.1, 0]), lock: "prefix" },
  ];
}

describe("EditSession", () => {
  it("startet sauber: nicht dirty, keine Aenderungen, current = base", () => {
    const s = new EditSession(nodes());
    expect(s.dirty).toBe(false);
    expect(s.changes()).toEqual([]);
    expect(s.current(0)).toEqual(trs([1, 0, 2]));
  });

  it("set macht dirty und erscheint in changes()", () => {
    const s = new EditSession(nodes());
    s.set(0, trs([4, 0, 2]));
    expect(s.dirty).toBe(true);
    expect(s.changes()).toEqual([{ index: 0, translation: [4, 0, 2], scale: [1, 1, 1] }]);
  });

  it("set auf gesperrtem Node wird ignoriert", () => {
    const s = new EditSession(nodes());
    s.set(3, trs([9, 9, 9]));
    expect(s.dirty).toBe(false);
    expect(s.isSelectable(3)).toBe(false);
  });

  it("resetNode stellt base wieder her", () => {
    const s = new EditSession(nodes());
    s.set(0, trs([4, 0, 2]));
    s.resetNode(0);
    expect(s.dirty).toBe(false);
    expect(s.current(0)).toEqual(trs([1, 0, 2]));
  });

  it("markSaved: dirty faellt, changes() bleibt (Patch vergleicht gegen ORIGINAL)", () => {
    const s = new EditSession(nodes());
    s.set(0, trs([4, 0, 2]));
    s.markSaved();
    expect(s.dirty).toBe(false);
    expect(s.changes()).toHaveLength(1);
    s.set(2, trs([-5, 0, 1]));
    expect(s.dirty).toBe(true);
  });

  it("applyOverlay setzt per Name und zaehlt Verlorene; Overlay macht dirty (Spec §4)", () => {
    const s = new EditSession(nodes());
    const result = s.applyOverlay(
      new Map([
        ["privat-herd", trs([7, 0, 2])],
        ["abgerissen", trs([0, 0, 0])],
        ["env__gelaende", trs([9, 9, 9])], // gesperrt → verloren
      ]),
    );
    expect(result.applied).toBe(1);
    expect(result.lost.sort()).toEqual(["abgerissen", "env__gelaende"]);
    expect(s.dirty).toBe(true);
    expect(s.current(0)).toEqual(trs([7, 0, 2]));
  });

  it("editsByName liefert die Abweichungen vom Original fuers Reload-Reapply", () => {
    const s = new EditSession(nodes());
    s.set(0, trs([4, 0, 2]));
    expect([...s.editsByName().entries()]).toEqual([["privat-herd", trs([4, 0, 2])]]);
  });
});
