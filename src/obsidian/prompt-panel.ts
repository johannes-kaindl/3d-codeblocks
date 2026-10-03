// Prompt-Panel (Spec Modell per Prompt § 6). Ein Frontend für Erzeugen, Ändern und (Plan 5)
// Versionen — UI-STANDARD „ein Frontend pro Plugin“. LLM ausschließlich über createLlmConnection.
// Ablauf von run()/Abbruch uebernommen aus lingotuner/src/obsidian/view.ts, 2026-10-03
import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { PANEL_TEXTS } from "../i18n/strings";
import { applyChanges } from "../core/shapes/changes";
import { convertShapesText } from "../core/shapes/convert";
import { diffParts, formatDiff } from "../core/shapes/diff";
import { formatShapes, partsFromLlm } from "../core/shapes/format";
import {
  baseTextForRefine,
  followTarget,
  INITIAL_PANEL,
  sameTarget,
  type PanelState,
  type PanelTarget,
  type ShapesRound,
} from "../core/shapes/panel-state";
import { buildCreateMessages, buildRefineMessages, readChangesAnswer, readPartsAnswer } from "../core/shapes/protocol";
import { failureHint, qualityLine, type QualityTask } from "../core/shapes/quality";
import { clearRounds, pushRound, selectRound } from "../vendor/kit/rounds";
import { buildHubInto, type HubController, type HubPanel } from "../vendor/kit-obsidian/hub";
import type { LlmConnection } from "../vendor/kit-obsidian/llm-connection";
import { buildStreamArea, type StreamArea } from "../vendor/kit-obsidian/stream-area";
import { buildVersionList } from "../vendor/kit-obsidian/version-list";
import { VIEW_TYPE_PROMPT } from "./prompt-panel-id";
import { buildBox } from "./render-box";
import { ViewerHost, type HostBaseDeps } from "./viewer-host";

export { VIEW_TYPE_PROMPT };

export interface PromptPanelDeps extends HostBaseDeps {
  llm: LlmConnection;
  /** Aktueller Text des Ziels; `null` = das Modell ist weg (oder Ziel `new`/`other`). */
  readTargetText(t: PanelTarget): Promise<string | null>;
  accept(state: PanelState): Promise<{ ok: boolean; message: string }>;
  openSettings(): void;
  confirm(message: string): Promise<boolean>;
  managerPresent(): boolean;
  persistModel(model: string): Promise<void>;
}

type Phase = "idle" | "checking" | "ok" | "error" | "warning";
const PHASE_ICON: Record<Exclude<Phase, "idle">, string> = {
  checking: "loader",
  ok: "circle-check",
  error: "circle-x",
  warning: "alert-triangle",
};
const PHASES: Phase[] = ["checking", "ok", "error", "warning"];

let selectSeq = 0;

const encode = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};

const targetLabel = (t: PanelTarget): string => (t.kind === "new" ? PANEL_TEXTS.targetNew : t.label);

/** Setzt Zustandsklasse und Icon eines Status-Indikators (UI-STANDARD §8: Form, Farbe, Klasse). */
function paintStatus(row: HTMLElement, icon: HTMLElement, label: HTMLElement, phase: Phase, text: string): void {
  for (const p of PHASES) row.removeClass(`is-${p}`);
  icon.empty();
  if (phase !== "idle") {
    row.addClass(`is-${phase}`);
    setIcon(icon, PHASE_ICON[phase]);
  }
  label.setText(text);
}

export class PromptPanelView extends ItemView {
  private panel: PanelState = INITIAL_PANEL;
  private kept = false;
  /** Das ANGEBOTENE, aber nicht übernommene Ziel: „Discard“ wechselt dorthin. */
  private offered: PanelTarget | null = null;
  private noEndpoint = false;
  private controller: AbortController | null = null;
  private pending: Promise<void> = Promise.resolve();
  private hub: HubController<"prompt" | "versions"> | null = null;

  private targetEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private modelSelect!: HTMLSelectElement;
  private qualityEl!: HTMLElement;
  private qualityIcon!: HTMLElement;
  private qualityLabel!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private statusRow!: HTMLElement;
  private statusIcon!: HTMLElement;
  private statusLabel!: HTMLElement;
  private area!: StreamArea;
  private previewWrap!: HTMLElement;
  private previewCaption!: HTMLElement;
  private previewHost: ViewerHost | null = null;
  private diffEl!: HTMLElement;
  private roundsEl!: HTMLElement;
  private applyBtn!: HTMLButtonElement;
  private discardBtn!: HTMLButtonElement;
  private emptyEl!: HTMLElement;
  private emptyDetail!: HTMLElement;
  private versionsEl: HTMLElement | null = null;

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

  state(): PanelState {
    return this.panel;
  }
  running(): boolean {
    return this.controller !== null;
  }
  /** Testnaht: wartet auf den laufenden Lauf. */
  settled(): Promise<void> {
    return this.pending;
  }

  setTarget(t: PanelTarget): void {
    // Waehrend einer Anfrage gilt das Ziel wie bei offenen Runden: es bleibt, das neue wird nur angeboten.
    if (this.controller !== null) {
      this.kept = !sameTarget(this.panel.target, t);
      this.offered = this.kept ? t : null;
    } else {
      const r = followTarget(this.panel, t);
      this.panel = r.state;
      this.kept = r.kept;
      this.offered = r.kept ? t : null;
    }
    this.renderHeader();
    this.renderVersions();
  }

  // ---- Aufbau ---------------------------------------------------------------------------------

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.addClass("tdcb-prompt");
    const prompt: HubPanel<"prompt" | "versions"> = {
      id: "prompt",
      get label() {
        return PANEL_TEXTS.tabPrompt;
      },
      icon: "sparkles",
      mount: (c) => this.mountPrompt(c),
      destroy: () => {},
    };
    const versions: HubPanel<"prompt" | "versions"> = {
      id: "versions",
      get label() {
        return PANEL_TEXTS.tabVersions;
      },
      icon: "history",
      mount: (c) => {
        this.versionsEl = c.createDiv({ cls: "tdcb-prompt-versions" });
        this.renderVersions();
      },
      destroy: () => {},
    };
    this.hub = buildHubInto(root, [prompt, versions], "prompt");
    this.renderAll();
    void this.loadModels(false);
  }

  async onClose(): Promise<void> {
    // Die Rückfrage bei offenen Runden kommt vom schließenden Befehl, nicht von hier (Obsidian wartet in
    // onClose nicht) — „Discard“ ist der bewusste Weg.
    this.controller?.abort();
    this.controller = null;
    this.hub?.destroy();
    this.hub = null;
    this.previewHost?.dispose();
    this.previewHost = null;
  }

  private mountPrompt(c: HTMLElement): void {
    const top = c.createDiv({ cls: "tdcb-prompt-top" });
    this.targetEl = top.createDiv({ cls: "tdcb-prompt-target" });
    const newBtn = top.createEl("button", { cls: "tdcb-prompt-new", text: PANEL_TEXTS.newButton, attr: { type: "button" } });
    newBtn.addEventListener("click", () => void this.startNew());
    this.hintEl = c.createDiv({ cls: "tdcb-prompt-hint" });

    // Modellzeile: Beschriftung, Auswahl, Aktualisieren.
    const modelRow = c.createDiv({ cls: "tdcb-prompt-model" });
    const selectId = `tdcb-prompt-model-select-${++selectSeq}`;
    modelRow.createEl("label", { text: PANEL_TEXTS.model, attr: { for: selectId } });
    this.modelSelect = modelRow.createEl("select", { cls: "dropdown", attr: { id: selectId } });
    this.modelSelect.addEventListener("change", () => void this.chooseModel(this.modelSelect.value));
    const refresh = modelRow.createEl("button", { cls: "clickable-icon tdcb-prompt-refresh", attr: { type: "button", "aria-label": PANEL_TEXTS.refreshModels } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.loadModels(true));

    this.qualityEl = c.createDiv({ cls: "tdcb-status tdcb-prompt-quality" });
    this.qualityIcon = this.qualityEl.createSpan({ cls: "tdcb-status-icon" });
    this.qualityLabel = this.qualityEl.createSpan({ cls: "tdcb-prompt-quality-label" });

    // Kein Eingabefeld ohne Endpunkt: der Empty-State ersetzt es nicht, sondern steht daneben.
    this.emptyEl = c.createDiv({ cls: "tdcb-prompt-empty is-hidden" });
    this.emptyEl.createDiv({ text: PANEL_TEXTS.noEndpoint });
    this.emptyDetail = this.emptyEl.createDiv({ cls: "tdcb-prompt-empty-detail" });
    const settingsBtn = this.emptyEl.createEl("button", { text: PANEL_TEXTS.openSettings, attr: { type: "button" } });
    settingsBtn.addEventListener("click", () => this.deps.openSettings());

    this.inputEl = c.createEl("textarea", { cls: "tdcb-prompt-input", attr: { rows: "4", "aria-label": PANEL_TEXTS.promptLabel } });
    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void this.run();
      }
    });

    const actions = c.createDiv({ cls: "tdcb-prompt-actions" });
    this.sendBtn = actions.createEl("button", { cls: "mod-cta tdcb-prompt-send", attr: { type: "button" } });
    this.sendBtn.addEventListener("click", () => void this.run());
    this.stopBtn = actions.createEl("button", { cls: "tdcb-prompt-stop is-hidden", text: PANEL_TEXTS.abort, attr: { type: "button" } });
    this.stopBtn.addEventListener("click", () => this.controller?.abort());

    this.area = buildStreamArea(c, { strings: { reasoning: PANEL_TEXTS.reasoning }, cls: "tdcb-prompt-stream" });
    // Statuszeile des Bereichs trägt den Status-Indikator; Ansage für Screenreader.
    this.area.statusEl.setAttribute("aria-live", "polite");
    this.statusRow = this.area.statusEl.createDiv({ cls: "tdcb-status tdcb-prompt-status" });
    this.statusIcon = this.statusRow.createSpan({ cls: "tdcb-status-icon" });
    this.statusLabel = this.statusRow.createSpan({ cls: "tdcb-prompt-status-label" });

    this.previewWrap = c.createDiv({ cls: "tdcb-prompt-preview is-hidden" });
    this.previewCaption = this.previewWrap.createDiv({ cls: "tdcb-prompt-preview-caption" });
    const parts = buildBox(this.previewWrap, { height: 260 });
    this.previewHost = new ViewerHost(parts.stage, parts.message, { ...this.deps, managed: false });
    this.diffEl = c.createDiv({ cls: "tdcb-prompt-diff" });
    this.roundsEl = c.createDiv({ cls: "tdcb-prompt-rounds" });

    const end = c.createDiv({ cls: "tdcb-prompt-actions" });
    this.applyBtn = end.createEl("button", { cls: "mod-cta tdcb-prompt-apply", text: PANEL_TEXTS.accept, attr: { type: "button" } });
    this.applyBtn.addEventListener("click", () => void this.apply());
    this.discardBtn = end.createEl("button", { cls: "tdcb-prompt-discard", text: PANEL_TEXTS.discard, attr: { type: "button" } });
    this.discardBtn.addEventListener("click", () => void this.discard());
  }

  // ---- Ablauf ---------------------------------------------------------------------------------

  private kind(): QualityTask {
    return this.panel.target.kind === "new" && this.panel.rounds.rounds.length === 0 ? "create" : "refine";
  }

  private model(): string {
    const s = this.deps.llm.source();
    return s.sentModel || s.model;
  }

  private setStatus(phase: Phase, text: string): void {
    paintStatus(this.statusRow, this.statusIcon, this.statusLabel, phase, text);
  }

  private canSend(): boolean {
    // `noEndpoint` sperrt NICHT: der Zustand wird vor jedem Senden neu bewertet, sonst waere der Empty-State
    // eine Sackgasse (nach „Open settings“ und Konfiguration muss Senden wieder gehen).
    return this.controller === null && this.panel.target.kind !== "other";
  }

  /** Ein Lauf: Senden → Anfrage → Ergebnis. Muster aus lingotuner `run`: Vergleich `controller !== ctrl`
   *  nach jedem await, `reset()` der Streaming-Fläche vor dem Lauf, Rendern abwarten vor dem Schluss. */
  private run(): Promise<void> {
    if (!this.canSend()) return this.pending;
    const instruction = this.inputEl.value?.trim() ?? "";
    if (instruction === "") return this.pending;
    this.pending = this.runInner(instruction);
    return this.pending;
  }

  private async runInner(instruction: string): Promise<void> {
    const ctrl = new AbortController();
    this.controller = ctrl;
    this.noEndpoint = false;
    try {
      await this.runBody(instruction, ctrl);
    } catch (e) {
      // Panel darf nie haengen: jede Ausnahme (readTargetText, complete, Rendern) wird Status.
      if (this.controller === ctrl) this.setStatus("error", e instanceof Error ? e.message : String(e));
    } finally {
      if (this.controller === ctrl) {
        this.controller = null;
        this.settleTarget();
        this.renderAll();
        this.inputEl.focus();
      }
    }
  }

  /** Ein angebotenes Ziel, das waehrend des Laufs zurueckgehalten wurde, gilt jetzt, wenn keine Runde offen ist. */
  private settleTarget(): void {
    if (this.panel.rounds.rounds.length === 0 && this.offered !== null) {
      this.panel = { ...this.panel, target: this.offered };
      this.offered = null;
      this.kept = false;
    }
  }

  private async runBody(instruction: string, ctrl: AbortController): Promise<void> {
    const kind = this.kind();
    const target = this.panel.target;
    // Vor dem Lauf gelesen: die Auswahl der Runde, auf der aufgebaut wird, gilt für die ganze Anfrage.
    const basedOn = this.panel.rounds.active >= 0 ? this.panel.rounds.active : null;
    const model = this.model();

    let base: string | null = null;
    let messages;
    if (kind === "refine") {
      base = baseTextForRefine(this.panel, await this.deps.readTargetText(target));
      if (this.controller !== ctrl) return;
      if (base === null) {
        this.setStatus("error", PANEL_TEXTS.modelGone);
        return;
      }
      messages = buildRefineMessages(base, instruction);
    } else {
      messages = buildCreateMessages(instruction);
    }

    this.area.reset();
    this.setStatus("checking", PANEL_TEXTS.running(model));
    this.renderControls();

    let raw = "";
    const onToken = (t: string): void => {
      if (this.controller !== ctrl) return;
      raw += t;
      // Die Antwort ist JSON, kein Markdown: Rohtext in den Tail.
      this.area.setTail(raw);
      this.area.followTail();
    };
    const onReasoning = (t: string): void => {
      if (this.controller !== ctrl) return;
      this.area.appendReasoning(t);
    };

    const r = await this.deps.llm.complete({ messages }, { onToken, onReasoning, signal: ctrl.signal });
    if (this.controller !== ctrl) return;
    // Abgebrochen heisst abgebrochen, auch wenn das Ergebnis noch „ok“ ankam.
    if (ctrl.signal.aborted) {
      this.setStatus("idle", PANEL_TEXTS.aborted);
      return;
    }

    if (!r.ok) {
      if (r.kind === "aborted") {
        this.setStatus("idle", PANEL_TEXTS.aborted);
      } else if (r.kind === "no-endpoint") {
        this.noEndpoint = true;
        this.emptyDetail.setText(PANEL_TEXTS.noEndpointDetail(r.detail));
        this.setStatus("error", PANEL_TEXTS.noEndpoint);
      } else {
        this.setStatus("error", r.detail);
      }
      return;
    }

    if (r.truncated) {
      this.setStatus("error", `${PANEL_TEXTS.cutOff} ${failureHint(model, kind)}`);
      return;
    }
    const content = r.content !== "" ? r.content : raw;
    const made = kind === "create" ? this.readCreate(content) : this.readRefine(content, base ?? "");
    if (!made.ok) {
      // Der Rohtext bleibt im Tail stehen; keine Runde.
      this.setStatus("error", `${made.reason} ${failureHint(model, kind)}`);
      return;
    }
    // Eine Runde gehoert zu dem Ziel, fuer das gefragt wurde.
    if (!sameTarget(this.panel.target, target)) {
      this.setStatus("error", PANEL_TEXTS.targetChanged);
      return;
    }
    const at = Date.now();
    const round: ShapesRound =
      made.kind === "create"
        ? { kind: "create", instruction, text: made.text, model, at }
        : { kind: "refine", instruction, changes: made.changes, basedOn, text: made.text, diff: made.diff, model, at };
    this.panel = { ...this.panel, rounds: pushRound(this.panel.rounds, round) };
    this.setStatus("ok", PANEL_TEXTS.done);
    this.renderAll();
    await this.renderPreview();
  }

  private readCreate(content: string): { ok: true; kind: "create"; text: string } | { ok: false; reason: string } {
    const answer = readPartsAnswer(content);
    if (!answer.ok) return { ok: false, reason: `${answer.reason}.` };
    const { parts } = partsFromLlm(answer.parts);
    if (parts.length === 0) return { ok: false, reason: `${PANEL_TEXTS.noUsableParts}.` };
    const text = formatShapes({}, parts);
    const conv = convertShapesText(text);
    if (!conv.ok) return { ok: false, reason: conv.messages.join(" ") };
    return { ok: true, kind: "create", text };
  }

  private readRefine(
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

  private async apply(): Promise<void> {
    if (this.panel.rounds.rounds.length === 0) return;
    this.pending = (async () => {
      let r: { ok: boolean; message: string };
      try {
        r = await this.deps.accept(this.panel);
      } catch (e) {
        r = { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      if (r.ok) {
        this.panel = { ...this.panel, rounds: clearRounds() };
        this.kept = false;
        this.offered = null;
        this.setStatus("ok", PANEL_TEXTS.applied(r.message));
        this.renderAll();
      } else {
        this.setStatus("error", r.message);
      }
    })();
    await this.pending;
  }

  private async confirmDiscard(): Promise<boolean> {
    const n = this.panel.rounds.rounds.length;
    return n === 0 || (await this.deps.confirm(PANEL_TEXTS.discardConfirm(n)));
  }

  /** Verwerfen: Runden weg; ein angebotenes (verweigertes) Ziel wird jetzt übernommen — „discard to switch“. */
  private async discard(): Promise<void> {
    if (this.controller !== null) return;
    if (!(await this.confirmDiscard())) return;
    const next = this.offered ?? this.panel.target;
    this.panel = { target: next, rounds: clearRounds() };
    this.kept = false;
    this.offered = null;
    this.setStatus("idle", "");
    this.renderAll();
  }

  private async startNew(): Promise<void> {
    if (this.controller !== null) return;
    if (!(await this.confirmDiscard())) return;
    this.panel = { target: { kind: "new" }, rounds: clearRounds() };
    this.kept = false;
    this.offered = null;
    this.setStatus("idle", "");
    this.renderAll();
  }

  private async chooseModel(value: string): Promise<void> {
    if (value === "") return;
    try {
      await this.deps.persistModel(value);
      this.deps.llm.invalidate();
    } catch (e) {
      if (this.controller === null) this.setStatus("error", e instanceof Error ? e.message : String(e));
    }
    this.renderHeader();
  }

  private async loadModels(force: boolean): Promise<void> {
    // Neu bewerten: ein frueher gemeldeter „kein Endpunkt“ gilt nicht fuer immer (Einstellungen koennen sich geaendert haben).
    this.noEndpoint = false;
    this.renderControls();
    let r;
    try {
      r = await this.deps.llm.models({ force });
    } catch (e) {
      if (this.hub !== null && this.controller === null) this.setStatus("error", e instanceof Error ? e.message : String(e));
      return;
    }
    if (this.hub === null) return;
    const current = this.model();
    const names = r.models.includes(current) || current === "" ? r.models : [current, ...r.models];
    this.modelSelect.empty();
    for (const m of names) {
      const o = this.modelSelect.createEl("option", { text: m });
      o.value = m;
    }
    if (current !== "") this.modelSelect.value = current;
  }

  // ---- Zeichnen -------------------------------------------------------------------------------

  private renderAll(): void {
    this.renderHeader();
    this.renderRounds();
    this.renderDiff();
    this.renderControls();
    this.renderVersions();
  }

  private renderHeader(): void {
    if (!this.targetEl) return;
    const t = this.panel.target;
    const text = this.kept ? PANEL_TEXTS.targetKept(targetLabel(t)) : t.kind === "new" ? PANEL_TEXTS.targetNew : PANEL_TEXTS.targetEdit(t.label);
    this.targetEl.setText(text);
    this.hintEl.setText(t.kind === "other" ? PANEL_TEXTS.unsupported(t.label) : "");
    const kind = this.kind();
    const q = qualityLine(this.model(), kind);
    paintStatus(this.qualityEl, this.qualityIcon, this.qualityLabel, q.measured ? "idle" : "warning", q.text);
    this.sendBtn.setText(kind === "create" ? PANEL_TEXTS.create : PANEL_TEXTS.refine);
    this.inputEl.setAttribute("placeholder", kind === "create" ? PANEL_TEXTS.placeholderCreate : PANEL_TEXTS.placeholderRefine);
    this.renderControls();
  }

  private renderControls(): void {
    if (!this.sendBtn) return;
    const running = this.controller !== null;
    this.sendBtn.disabled = !this.canSend();
    this.stopBtn.toggleClass("is-hidden", !running);
    const n = this.panel.rounds.rounds.length;
    this.applyBtn.disabled = n === 0 || running;
    this.discardBtn.disabled = n === 0 || running;
    this.emptyEl.toggleClass("is-hidden", !this.noEndpoint);
    this.previewWrap.toggleClass("is-hidden", n === 0);
  }

  private activeRoundOf(): ShapesRound | null {
    const { rounds, active } = this.panel.rounds;
    return active >= 0 ? (rounds[active] ?? null) : null;
  }

  private async renderPreview(): Promise<void> {
    const round = this.activeRoundOf();
    if (round === null || this.previewHost === null) return;
    this.previewCaption.setText(PANEL_TEXTS.previewOf(this.panel.rounds.active + 1));
    const text = round.text;
    await this.previewHost.render({ provideBytes: async () => encode(text), format: "shapes", inspectContainer: false, label: "preview" });
  }

  private renderDiff(): void {
    if (!this.diffEl) return;
    this.diffEl.empty();
    const round = this.activeRoundOf();
    if (round === null || round.kind !== "refine" || round.diff.length === 0) return;
    this.diffEl.createDiv({ cls: "tdcb-prompt-diff-heading", text: PANEL_TEXTS.diffHeading });
    const list = this.diffEl.createEl("ul");
    for (const line of round.diff) list.createEl("li", { text: line });
  }

  private renderRounds(): void {
    if (!this.roundsEl) return;
    this.roundsEl.empty();
    const { rounds, active } = this.panel.rounds;
    buildVersionList(this.roundsEl, {
      items: rounds.map((r, i) => ({ label: `${i + 1}. ${r.instruction}`, meta: r.kind === "refine" ? `${r.diff.length} change(s)` : "new" })),
      active,
      onSelect: (i) => {
        this.panel = { ...this.panel, rounds: selectRound(this.panel.rounds, i) };
        this.renderRounds();
        this.renderDiff();
        void this.renderPreview();
      },
      heading: PANEL_TEXTS.rounds,
    });
  }

  /** Versions-Tab: in Plan 3b nur der Empty-State, Plan 5 füllt ihn. */
  private renderVersions(): void {
    if (!this.versionsEl) return;
    this.versionsEl.empty();
    const text = this.panel.target.kind === "shapes-file" ? PANEL_TEXTS.versionsEmpty : PANEL_TEXTS.versionsOnlyFiles;
    this.versionsEl.createDiv({ cls: "tdcb-prompt-versions-empty", text });
  }
}
