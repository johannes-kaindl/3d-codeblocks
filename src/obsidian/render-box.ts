// DOM-Geruest eines Blocks. Bewusst ohne Entscheidungslogik: diese Datei konsumiert
// nur das ViewModel und zeichnet (UI-STANDARD §6). Kein innerHTML, nur createEl.
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
