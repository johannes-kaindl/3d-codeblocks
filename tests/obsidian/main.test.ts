import { describe, expect, it, vi } from "vitest";
import { isPanelVisible } from "../../src/main";

// Regressionstest fuer Finding 2 (Whole-Branch-Review 2026-07-25): ein Leaf allein
// (getLeavesOfType(...).length > 0) reicht nicht -- Sidebar-Leaves ueberleben in
// Obsidians Layout auch ueber Neustarts hinweg, selbst wenn die rechte Leiste
// eingeklappt ist. Ohne die Collapsed-Pruefung gilt die Sidebar nach dem ERSTEN
// Oeffnen fuer immer als "offen": die Toolbar (Ausweichloesung bei geschlossener
// Sidebar) erscheint dann nie wieder, waehrend das Panel selbst unsichtbar bleibt.
function fakeWorkspace(leafCount: number, collapsed: boolean) {
  return {
    getLeavesOfType: vi.fn().mockReturnValue(new Array(leafCount).fill({})),
    rightSplit: { collapsed },
  };
}

describe("isPanelVisible", () => {
  it("is false when there is no panel leaf at all", () => {
    expect(isPanelVisible(fakeWorkspace(0, false))).toBe(false);
  });

  it("is true when a panel leaf exists and the right split is expanded", () => {
    expect(isPanelVisible(fakeWorkspace(1, false))).toBe(true);
  });

  it("is false when a panel leaf exists but the right split is collapsed", () => {
    // Der eigentliche Regressionsfall: ein Leaf, das seit einer frueheren Sitzung im
    // Layout haengt, aber gerade eingeklappt ist.
    expect(isPanelVisible(fakeWorkspace(1, true))).toBe(false);
  });

  it("is false when the right split is collapsed even with several leaves", () => {
    expect(isPanelVisible(fakeWorkspace(3, true))).toBe(false);
  });
});
