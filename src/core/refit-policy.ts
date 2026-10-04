// Wann zieht der Viewport die Kamera nach, wenn sich der Container aendert? Pure.
// Regel: ein Blick, den der Nutzer NICHT bewegt hat, wird bei jeder Groessenaenderung neu eingepasst — der
// Modellmittelpunkt bleibt im Zentrum des Panes, der Abstand folgt dem neuen Seitenverhaeltnis. Ein bewusst
// bewegter Blick (Orbit/Pan/Zoom) bleibt dagegen stehen, damit eine Seitenleiste ihn nicht wegreisst.
// (Vorher gab es ein „Layout steht“-Tor: nach zwei gleich grossen Messungen zog der Fit nie wieder nach, und
// ein Wechsel Split → Modell oder Sidebar ein/aus liess den Blick auf der alten Groesse stehen.)

export interface PaneSize {
  width: number;
  height: number;
}

export interface RefitState {
  userMoved: boolean;
  hasBounds: boolean;
  /** Containergroesse beim letzten Einpassen; `null` = noch nie eingepasst. */
  lastFit: PaneSize | null;
  now: PaneSize;
}

export function needsRefit(s: RefitState): boolean {
  if (s.userMoved || !s.hasBounds) return false;
  if (s.now.width <= 0 || s.now.height <= 0) return false;
  return s.lastFit === null || s.lastFit.width !== s.now.width || s.lastFit.height !== s.now.height;
}
