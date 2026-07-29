// DOM-Geruest eines Blocks. Bewusst ohne Entscheidungslogik: diese Datei konsumiert
// nur das ViewModel und zeichnet (UI-STANDARD §6). Kein innerHTML, nur createEl.
import { setIcon } from "obsidian";
import type { BadgeState } from "../core/edit-badge";
import type { ViewModel } from "../core/view-model";

export interface BoxParts {
  root: HTMLElement;
  /** Positionierter Wrapper UM die Buehne — der Anker fuer die Hover-Toolbar
      (`viewport-toolbar.ts`). Bewusst ein eigenes Element, nicht die Buehne selbst:
      `ViewerHost` raeumt die Buehne per `stage.empty()` in `renderPoster()`,
      `reactivate()` und `retry()` komplett leer (Poster-Modus, Reaktivierung,
      Fehler-Reload) — eine dort verankerte Toolbar wuerde bei jedem dieser drei Wege
      mit weggewischt und nie neu aufgebaut, weil `syncToolbar()` nur den initialen
      Ladeweg abdeckt. Als Geschwister der Buehne (statt Kind) ueberlebt sie das. */
  viewport: HTMLElement;
  stage: HTMLElement;
  message: HTMLElement;
  hint: HTMLElement;
}

export function buildBox(
  parent: HTMLElement,
  opts: { title?: string; height?: number; fill?: boolean },
): BoxParts {
  const root = parent.createDiv({ cls: "tdcb-block" });

  if (opts.title) root.createDiv({ cls: "tdcb-title", text: opts.title });

  const viewport = root.createDiv({ cls: "tdcb-viewport" });
  const stage = viewport.createDiv({ cls: "tdcb-stage" });
  if (opts.fill) {
    // FileView: die Buehne fuellt das ganze Pane (Hoehe kommt aus dem CSS).
    root.addClass("tdcb-fill");
  } else {
    stage.style.height = `${opts.height ?? 400}px`;
  }

  return {
    root,
    viewport,
    stage,
    message: root.createDiv({ cls: "tdcb-message-slot" }),
    hint: root.createDiv({ cls: "tdcb-hint" }),
  };
}

export function renderMessage(host: HTMLElement, vm: ViewModel, onReload?: () => void): void {
  host.empty();
  if (vm.message === null && !vm.showSpinner) return;

  const box = host.createDiv({
    cls: vm.tone === "error" ? "tdcb-message tdcb-message-error" : "tdcb-message tdcb-message-info",
  });

  if (vm.showSpinner) box.createDiv({ cls: "tdcb-spinner" });
  if (vm.message !== null) box.createSpan({ text: vm.message });

  if (vm.showReloadButton && onReload) {
    const button = box.createEl("button", { cls: "mod-cta", text: "Reload" });
    button.addEventListener("click", onReload);
  }
}

export function renderHint(host: HTMLElement, warnings: string[]): void {
  host.empty();
  for (const warning of warnings) host.createDiv({ text: warning });
}

/** Badge fuer "es gibt gespeicherte, noch nicht uebernommene Edits" an- oder abhaengen.
 *
 *  Gibt das neue Element (oder `null`) zurueck; der Aufrufer haelt es und reicht es
 *  beim naechsten Aufruf als `current` wieder herein — dieselbe Form wie die Toolbar
 *  in `block-child.ts`. Idempotent: ein sichtbarer Badge wird aktualisiert statt neu
 *  gebaut, damit haeufige Aufrufer (`syncToolbar` haengt an `resize`) nicht im
 *  Sekundentakt DOM wegwerfen.
 *
 *  Verankert im `viewport`, nicht in der `stage`: `ViewerHost` leert die Buehne in
 *  Poster-Modus, Reaktivierung und Fehler-Reload komplett (siehe `BoxParts.viewport`) —
 *  ein dort haengender Badge waere nach jedem dieser Wege weg. Und nicht in `root`,
 *  weil die absolute Positionierung sich auf den Viewport beziehen muss. */
export function syncBadge(
  viewport: HTMLElement,
  current: HTMLElement | null,
  state: BadgeState,
): HTMLElement | null {
  if (!state.visible) {
    current?.remove();
    return null;
  }

  const el = current ?? viewport.createDiv({ cls: "tdcb-badge" });
  if (current === null) {
    // Icon und Label nur EINMAL bauen: das Label ist konstant, und ein `setText()`
    // auf dem Container wuerde `setIcon`s SVG mit wegraeumen. Veraenderlich ist nur
    // der Tooltip (er nennt den Pfad) — der haengt am Container und braucht kein
    // Wiederfinden des Kind-Elements.
    setIcon(el.createSpan({ cls: "tdcb-badge-icon" }), "pencil");
    el.createSpan({ cls: "tdcb-badge-label", text: state.label });
  }
  el.title = state.title;
  // Der Badge ist ein Zustandshinweis, kein Steuerelement: `aria-label` statt einer
  // Rolle, damit Screenreader ihn vorlesen, ohne ihn als bedienbar anzukuendigen.
  el.setAttribute("aria-label", state.title);
  return el;
}
