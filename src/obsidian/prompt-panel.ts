// Prompt-Panel (Spec Modell per Prompt § 6). Seit K9 Etappe 3 (Welle 36) eine dünne Ansicht über dem Kit-Rahmen `buildPromptPanel`:
// der Rahmen zeichnet die acht Stationen (Ziel, Modellzeile, Auftrag, Lauf, Ergebnis, Runden, Übernehmen, Schließen), der Halter
// (`createPromptPanelHost`, in `main.ts` gebaut) hält Lauf, Sitzung und Entwurf über das Schließen hinaus. Hier steht nur, was `shapes` ist:
// der Lauf (Anfrage, Prüfung der Antwort, Runde), die 3D-Vorschau, die Änderungsliste, die Schreibwege und die Texte, die fachlich uns gehören.
// Der Ablauf des Laufs stammt aus `runBody` der früheren Ansicht (Herkunft lingotuner/src/obsidian/view.ts, 2026-10-03); Eigenzustand,
// Handvergleich (`controller !== ctrl`), Hub mit dem Tab „Versionen“ und das Zeichnen sind ins Kit gewandert.
import { ItemView, type App, type MarkdownView, type WorkspaceLeaf } from "obsidian";
import { PANEL_TEXTS } from "../i18n/strings";
import { getLang } from "../i18n/t";
import { applyChanges } from "../core/shapes/changes";
import { convertShapesText } from "../core/shapes/convert";
import { diffParts, formatDiff } from "../core/shapes/diff";
import { formatShapes, partsFromLlm } from "../core/shapes/format";
import { baseTextForRefine, type PanelState, type PanelTarget, type ShapesRound } from "../core/shapes/panel-state";
import { buildCreateMessages, buildRefineMessages, readChangesAnswer, readPartsAnswer } from "../core/shapes/protocol";
import { failureHint, qualityLine } from "../core/shapes/quality";
import type { HostRunCall, HostRunResult } from "../vendor/kit/panel-host";
import { taskKind } from "../vendor/kit/panel-session";
import { pushRound } from "../vendor/kit/rounds";
import type { LlmConnection } from "../vendor/kit-obsidian/llm-connection";
import { sourceViewOf, type AcceptEnv } from "../vendor/kit-obsidian/panel-accept";
import { buildPromptPanel, type PromptPanel, type PromptPanelSlots, type PromptPanelWay } from "../vendor/kit-obsidian/prompt-panel";
import type { PromptPanelHost } from "../vendor/kit-obsidian/prompt-panel-host";
import type { PromptPanelStrings } from "../vendor/kit-obsidian/prompt-panel-strings";
import type { ThinkingControlOptions } from "../vendor/kit-obsidian/thinking-control";
import { acceptKind, acceptSpecFor, saveOpenShapesViews } from "./accept";
import { VIEW_TYPE_PROMPT } from "./prompt-panel-id";
import { buildBox } from "./render-box";
import { ViewerHost, type HostBaseDeps } from "./viewer-host";

export { VIEW_TYPE_PROMPT };

/** Der Halter dieses Plugins: Sitzung ist der `PanelState` (Ziel und Runden). */
export type ShapesPanelHost = PromptPanelHost<PanelState>;

const encode = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};

// ---- Der Lauf (Halter-Option `run`) -----------------------------------------------------------

export interface ShapesRunDeps {
  llm: LlmConnection;
  /** Aktueller Text des Ziels; `null` = das Modell ist weg (oder Ziel `new`/`other`). */
  readTargetText(t: PanelTarget): Promise<string | null>;
}

function readCreate(content: string): { ok: true; kind: "create"; text: string } | { ok: false; reason: string } {
  const answer = readPartsAnswer(content);
  if (!answer.ok) return { ok: false, reason: `${answer.reason}.` };
  const { parts } = partsFromLlm(answer.parts);
  if (parts.length === 0) return { ok: false, reason: `${PANEL_TEXTS.noUsableParts}.` };
  const text = formatShapes({}, parts);
  const conv = convertShapesText(text);
  if (!conv.ok) return { ok: false, reason: conv.messages.join(" ") };
  return { ok: true, kind: "create", text };
}

function readRefine(
  content: string,
  base: string,
): { ok: true; kind: "refine"; text: string; changes: Extract<ShapesRound, { kind: "refine" }>["changes"]; diff: string[] } | { ok: false; reason: string } {
  const answer = readChangesAnswer(content);
  if (!answer.ok) return { ok: false, reason: `${answer.reason}.` };
  const applied = applyChanges(base, answer.changes);
  if (!applied.ok) return { ok: false, reason: `${applied.problems.join("; ")}.` };
  if (applied.text === base) return { ok: false, reason: PANEL_TEXTS.answerChangesNothing };
  return { ok: true, kind: "refine", text: applied.text, changes: answer.changes, diff: diffParts(applied.before, applied.after).map(formatDiff) };
}

/** Ein Lauf: Senden → Anfrage → Ergebnis. Der Halter besorgt den Handvergleich (ein spätes Ergebnis eines abgebrochenen Laufs ändert nichts),
 *  die Sperre gegen einen zweiten Lauf und den Puffer der Antwort; hier steht nur, was `shapes` ist. */
export function createShapesRun(d: ShapesRunDeps): (call: HostRunCall<PanelState>) => Promise<HostRunResult<PanelState>> {
  return async (call) => {
    const { session, instruction, signal, io, model } = call;
    const kind = taskKind(session);
    const target = session.target;
    // Vor dem Lauf gelesen: die Auswahl der Runde, auf der aufgebaut wird, gilt für die ganze Anfrage.
    const basedOn = session.rounds.active >= 0 ? session.rounds.active : null;

    let base: string | null = null;
    let messages;
    if (kind === "refine") {
      base = baseTextForRefine(session, await d.readTargetText(target));
      if (signal.aborted) return { ok: false, kind: "aborted" };
      if (base === null) return { ok: false, kind: "error", message: target.kind === "block" ? PANEL_TEXTS.blockGone : PANEL_TEXTS.modelGone };
      messages = buildRefineMessages(base, instruction);
    } else {
      messages = buildCreateMessages(instruction);
    }

    io.start();
    let raw = "";
    // Die Antwort ist JSON, kein Markdown: der Halter puffert den Rohtext, der Rahmen zeigt ihn als Text.
    const onToken = (t: string): void => { raw += t; io.onToken(t); };
    // Gemma 4 schreibt sein Denken ohne Öffner in den Inhalt; der Kit-Client erkennt es am Kanalende und meldet, dass der bisherige Inhalt Denken war.
    const onContentReset = (): void => { raw = ""; io.onContentReset(); };

    const r = await d.llm.complete({ messages }, { onToken, onReasoning: (t) => { io.onReasoning(t); }, onContentReset, signal });
    // Abgebrochen heißt abgebrochen, auch wenn das Ergebnis noch „ok“ ankam.
    if (signal.aborted) return { ok: false, kind: "aborted" };

    if (!r.ok) {
      if (r.kind === "aborted") return { ok: false, kind: "aborted" };
      if (r.kind === "no-endpoint") return { ok: false, kind: "no-endpoint", detail: PANEL_TEXTS.noEndpointDetail(r.detail, r.source?.kind) };
      return { ok: false, kind: "error", message: r.detail };
    }
    const hint = (): string => failureHint(model, kind, undefined, { family: d.llm.source().family });
    if (r.truncated) return { ok: false, kind: "error", message: `${PANEL_TEXTS.cutOff} ${hint()}` };
    const content = r.content !== "" ? r.content : raw;
    const made = kind === "create" ? readCreate(content) : readRefine(content, base ?? "");
    // Der Rohtext bleibt im Antwortbereich stehen; keine Runde.
    if (!made.ok) return { ok: false, kind: "error", message: `${made.reason} ${hint()}` };

    const at = Date.now();
    const round: ShapesRound =
      made.kind === "create"
        ? { kind: "create", instruction, text: made.text, model, at }
        : { kind: "refine", instruction, changes: made.changes, basedOn, text: made.text, diff: made.diff, model, at };
    return {
      ok: true,
      session: { ...session, rounds: pushRound(session.rounds, round) },
      message: made.kind === "create" ? PANEL_TEXTS.doneCreate : PANEL_TEXTS.done,
    };
  };
}

// ---- Texte, die fachlich uns gehören ---------------------------------------------------------

/** Was das Plugin im Rahmen selbst sagt (Name des Ziels, Platzhalter, Beispiele); der Rest kommt aus dem Kit. */
export function promptPanelStrings(): Partial<PromptPanelStrings> {
  return {
    targetNew: PANEL_TEXTS.targetNew,
    placeholderCreate: PANEL_TEXTS.placeholderCreate,
    placeholderRefine: PANEL_TEXTS.placeholderRefine,
    emptyText: PANEL_TEXTS.emptyText,
    examples: [PANEL_TEXTS.example1, PANEL_TEXTS.example2],
    unsupported: (label) => PANEL_TEXTS.unsupported(label),
  };
}

// ---- Schreibwege ------------------------------------------------------------------------------

/** Die Schreibwege des Fensters. Neues Ziel: zwei Knöpfe (Block am Cursor, Datei), `primary` bestimmt den Hauptknopf; ein bestehender Block oder eine bestehende
 *  Datei hat einen Weg „Übernehmen“. Die offenen `.shapes`-Ansichten werden vor dem Schreiben gespeichert (`prepare`, nur beim Ziel `file`); wirft das, wird nichts geschrieben. */
export function shapesWays(
  session: PanelState,
  d: { primary: "block" | "file"; lastEditor: () => MarkdownView | null; app: App },
): PromptPanelWay<PanelState>[] {
  const spec = acceptSpecFor(session);
  const kind = acceptKind;
  const prepare = (s: PanelState): Promise<void> => saveOpenShapesViews(d.app, s);
  if (session.target.kind !== "new") return [{ id: "apply", label: PANEL_TEXTS.accept, spec, kind, prepare }];
  // Ohne offene Quellansicht gibt es keinen Cursor: der Grund steht neben dem Knopf (der Rahmen liest ihn über `aria-describedby`).
  const noteReason = (): string | null => {
    const v = sourceViewOf(d.lastEditor());
    if ("none" in v) return PANEL_TEXTS.noNoteOpen;
    if ("reading" in v) return PANEL_TEXTS.noteInReadingView;
    return null;
  };
  const block: PromptPanelWay<PanelState> = { id: "block", label: PANEL_TEXTS.acceptBlock, spec, kind, where: "block", blockedReason: noteReason, prepare };
  const file: PromptPanelWay<PanelState> = { id: "file", label: PANEL_TEXTS.acceptFile, spec, kind, where: "file", prepare };
  return d.primary === "file" ? [file, block] : [block, file];
}

// ---- Die Ansicht ------------------------------------------------------------------------------

export interface PromptPanelDeps extends HostBaseDeps {
  host: ShapesPanelHost;
  llm: LlmConnection;
  /** Zustand und Schalter der Denk-Steuerung in der Modellzeile (ohne Texte). */
  thinking: Pick<ThinkingControlOptions, "family" | "backend" | "current" | "onLevel" | "setLevel" | "levelPicker">;
  /** Aktueller Text des Ziels; `null` = das Modell ist weg (oder Ziel `new`/`other`). */
  readTargetText(t: PanelTarget): Promise<string | null>;
  openSettings(): void;
  /** Der Kit-`AcceptEnv` ohne Einstellung und Wahl (der Rahmen fragt nicht, beide Wege sind Knöpfe). */
  accept: Omit<AcceptEnv, "settings" | "choose">;
  /** Welcher Weg beim neuen Ziel der Hauptknopf ist (Einstellung `acceptAs`; ein gespeichertes `"ask"` gilt als `"block"`). */
  primaryWay: () => "block" | "file";
  /** Kennung des Plugins für den Schnappschuss (`file-snapshot`). */
  pluginId: string;
}

export class PromptPanelView extends ItemView {
  private panel: PromptPanel | null = null;
  private previewHost: ViewerHost | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: PromptPanelDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PROMPT;
  }
  getDisplayText(): string {
    return PANEL_TEXTS.title;
  }
  getIcon(): string {
    return "sparkles";
  }

  /** Testnaht: die Sitzung des Halters (Ziel und Runden). */
  state(): PanelState {
    return this.deps.host.session();
  }
  running(): boolean {
    return this.deps.host.running();
  }
  /** Testnaht: wartet auf Lauf, Schreiben und eine laufende Vorschau. */
  settled(): Promise<void> {
    return this.panel?.settled() ?? this.deps.host.settled();
  }

  /** Zeichnet die Modellzeile samt Denk-Steuerung aus dem Zustand neu (ohne Abruf). */
  refreshModelBar(): void {
    this.panel?.refreshModelBar();
  }
  /** Lädt die Modell-Liste der Zeile neu (der Endpunkt oder der Manager haben gewechselt). */
  reloadModels(): void {
    this.panel?.reloadModels();
  }
  /** Wertet die Schreibwege und ihre Sperrgründe neu aus (die zuletzt aktive Notiz hat gewechselt). */
  refreshAccept(): void {
    this.panel?.refreshAccept();
  }

  async onOpen(): Promise<void> {
    this.panel?.destroy();
    this.panel = buildPromptPanel<ShapesRound, PanelState>(
      this.contentEl,
      this.deps.host,
      {
        app: this.app,
        lang: getLang(),
        llm: this.deps.llm,
        thinking: this.deps.thinking,
        readTargetText: (t) => this.deps.readTargetText(t),
        openSettings: () => { this.deps.openSettings(); },
        pluginId: this.deps.pluginId,
        accept: this.deps.accept,
        strings: promptPanelStrings(),
      },
      this.slots(),
    );
  }

  async onClose(): Promise<void> {
    // Obsidian wartet in onClose nicht auf einen Dialog: die Rückfrage läuft nach destroy() weiter und erreicht den Halter (Verwerfen verwirft, jeder andere Ausgang behält).
    const panel = this.panel;
    this.panel = null;
    if (panel) {
      void panel.requestClose();
      panel.destroy();
    }
    this.disposePreview();
  }

  private disposePreview(): void {
    this.previewHost?.dispose();
    this.previewHost = null;
  }

  // ---- Slots ----------------------------------------------------------------------------------

  private slots(): PromptPanelSlots<ShapesRound, PanelState> {
    const family = () => this.deps.llm.source().family;
    return {
      renderPreview: async (host, round, text, ctx) => {
        // Jedes Zeichnen hat ein eigenes Wurzelelement (der Rahmen hängt das alte ab); die alte Vorschau wird hier abgebaut, bevor die neue beginnt.
        this.disposePreview();
        if (round === null || text === null) return;
        const parts = buildBox(host, { height: 260 });
        const viewer = new ViewerHost(parts.stage, parts.message, { ...this.deps, managed: false });
        this.previewHost = viewer;
        await viewer.render({ provideBytes: async () => encode(text), format: "shapes", inspectContainer: false, label: "preview" });
        // Eine neuere Vorschau hat inzwischen übernommen und diese schon abgebaut; ist das Fenster zu, gibt dieses Zeichnen den Viewport zurück.
        if (!ctx.current() && this.previewHost === viewer) this.disposePreview();
      },
      renderChanges: (host, round) => {
        if (round === null || round.kind !== "refine" || round.diff.length === 0) return;
        host.createDiv({ cls: "tdcb-prompt-diff-heading", text: PANEL_TEXTS.diffHeading });
        const list = host.createEl("ul", { cls: "tdcb-prompt-diff" });
        for (const line of round.diff) list.createEl("li", { text: line });
      },
      roundLabel: (round, index) => `${index + 1}. ${round.instruction}`,
      roundMeta: (round) => (round.kind === "refine" ? PANEL_TEXTS.roundChanges(round.diff.length) : PANEL_TEXTS.roundNew),
      roundText: (round) => round.text,
      quality: (model, task) => qualityLine(model, task, undefined, { family: family() }),
      acceptWays: (session) => shapesWays(session, { primary: this.deps.primaryWay(), lastEditor: this.deps.accept.lastEditor, app: this.app }),
      dispose: () => { this.disposePreview(); },
    };
  }
}
