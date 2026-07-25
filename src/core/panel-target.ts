// Wo die Bedienung erscheint. Pure.
//
// Uebernommen von `vim-dojo/src/hudPlacement.ts` (resolveHudTarget) — dort entschied
// dieselbe Frage zwischen Sidebar-Pane und schwebender Box. Ein `dismissed`-Zustand
// fehlt hier bewusst: vim-dojos Box schwebt ueber fremdem Editortext und muss
// wegklickbar sein, unsere Leiste liegt im eigenen Kasten und verdeckt nichts.

/** Nutzer-Einstellung. */
export type PanelPlacement = "sidebar" | "toolbar" | "auto";

/** Die Flaeche, auf der die Bedienung im aktuellen Zustand tatsaechlich erscheint. */
export type PanelTarget = "panel" | "toolbar" | "none";

export function resolvePanelTarget(
  placement: PanelPlacement,
  panelVisible: boolean,
): PanelTarget {
  if (placement === "sidebar") return panelVisible ? "panel" : "none";
  if (placement === "toolbar") return "toolbar";
  return panelVisible ? "panel" : "toolbar";
}
