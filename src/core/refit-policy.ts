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

/** Der Zustand dahinter, rein und ohne WebGL testbar; `Viewport` haelt genau eine Instanz.
 *  - `noteFit`: JEDER Fit (Oeffnen, Resize-Refit, Fit-Knopf, Doppelklick, gespeicherte Ansicht) merkt sich die
 *    Groesse und gilt als „Blick nicht vom Nutzer bewegt“ — ein ausdruecklich angeforderter Blick ist der
 *    neue Ausgangspunkt, danach darf eine Groessenaenderung wieder neu einpassen.
 *  - `noteUserMove`: jede Kameraaenderung, die kein eigener Fit ist (Orbit, Pan, Zoom).
 *  - `reset`: neues Modell, nichts eingepasst. */
export class RefitTracker {
  private lastFit: PaneSize | null = null;
  private moved = false;

  reset(): void {
    this.lastFit = null;
    this.moved = false;
  }

  noteFit(size: PaneSize): void {
    this.lastFit = { width: size.width, height: size.height };
    this.moved = false;
  }

  noteUserMove(): void {
    this.moved = true;
  }

  userMoved(): boolean {
    return this.moved;
  }

  shouldRefit(now: PaneSize, hasBounds: boolean): boolean {
    return needsRefit({ userMoved: this.moved, hasBounds, lastFit: this.lastFit, now });
  }
}
