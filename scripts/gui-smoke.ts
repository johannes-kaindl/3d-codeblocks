/**
 * GUI-Smoke-Treiber — fährt die Checkliste aus `docs/SMOKE.md` gegen ein **laufendes**
 * Obsidian statt von Hand.
 *
 * Warum getrackt (CORE-TEST-02 b): Am 2026-07-30 lief dieser Smoke schon einmal — mit
 * einem Treiber, der nur im Session-Scratchpad lag. Er fand den three-r169-`dispose()`-
 * Fehler, den 395 grüne Tests und fünf Hand-Smokes nicht sahen, und war beim nächsten
 * Mal trotzdem weg. Ein Werkzeug, das nur einmal existiert, ist keine Praxis.
 *
 * Was er prüft, das Unit-Tests strukturell nicht können: echtes WebGL, echtes
 * Live-Preview-DOM, echte Theme-Variablen, echter Lebenszyklus — die Naht zum Host.
 *
 * ## Voraussetzung
 *
 * Obsidian muss mit offenem Debug-Port laufen (das ist der einzige Handgriff, der
 * Handarbeit bleibt — die App muss dafür neu gestartet werden):
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * ```
 *
 * Dann, mit deployter Plugin-Version (`npm run deploy`):
 *
 * ```bash
 * npm run smoke:gui
 * npm run smoke:gui -- --port 9222 --model weltmodell/3d/eg.gltf --keep
 * ```
 *
 * ⚠️ Chromium drosselt das Rendering nicht-fokussierter Fenster: ohne `Page.bringToFront`
 * bleibt die View leer und man debuggt ein Phantom (CORE-TEST-02).
 */

import { execFileSync } from "node:child_process";

const PLUGIN_ID = "three-d-codeblocks";
const CONTROLS_VIEW = "three-d-controls";
/** View-Typ der Datei-Ansicht (src/obsidian/file-view.ts: VIEW_TYPE_3D). */
const FILE_VIEW = "tdcb-3d-model";
/** Wird im Vault angelegt und am Ende wieder entfernt (außer mit `--keep`). */
const SMOKE_NOTE = "_tdcb-gui-smoke.md";
const SMOKE_NOTE_VIEW = "_tdcb-gui-smoke-view.md";
const SMOKE_NOTE_EMBED = "_tdcb-gui-smoke-embed.md";
const SMOKE_NOTE_BAD = "_tdcb-gui-smoke-bad-view.md";
/** Eigener Titel je Abschnitt: nur so ist ein Controller aus dem vorigen Abschnitt
 *  von dem des aktuellen zu unterscheiden. */
const VIEW_BLOCK_TITLE = "Ansicht-Probe";

// --- CDP-Minimalbrücke ------------------------------------------------------
// Node ≥21 bringt `WebSocket` global mit — keine Dependency nötig.

interface CdpTarget {
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CdpResponse {
  id?: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  error?: { message?: string };
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, { ok: (v: CdpResponse) => void; fail: (e: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (message.id === undefined) return; // Event, kein Antwort-Frame
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.fail(new Error(message.error.message ?? "CDP-Fehler"));
      else waiter.ok(message);
    });
  }

  static async attach(port: number, vault?: string): Promise<Cdp> {
    let targets: CdpTarget[];
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = (await response.json()) as CdpTarget[];
    } catch {
      throw new Error(
        `Kein Debug-Port auf ${port}. Obsidian mit --remote-debugging-port=${port} neu starten ` +
          `(siehe Kopfkommentar).`,
      );
    }

    // Das Hauptfenster ist die Seite mit Obsidians app-Schema; Popouts und DevTools
    // tragen andere URLs. Ohne diese Auswahl landet man im falschen Renderer.
    const pages = targets.filter(
      (t) => t.type === "page" && t.url.startsWith("app://obsidian.md") && t.webSocketDebuggerUrl,
    );
    if (pages.length === 0) {
      const seen = targets.map((t) => `${t.type} ${t.url}`).join("\n  ") || "(keine)";
      throw new Error(`Kein Obsidian-Fenster unter den Targets gefunden:\n  ${seen}`);
    }

    // Mehrere offene Vaults sind der Normalfall, nicht die Ausnahme. Blind das erste
    // Fenster zu nehmen hiesse, den Smoke im falschen Vault zu fahren — und der
    // Fehlschlag saehe aus wie ein Plugin-Defekt ("Plugin nicht aktiv"). Der Titel
    // traegt den Vault-Namen ("<Notiz> - <Vault> - Obsidian x.y.z").
    const matching = vault
      ? pages.filter((t) => t.title.toLowerCase().includes(vault.toLowerCase()))
      : pages;
    if (matching.length === 0) {
      throw new Error(
        `Kein Fenster passt zu --vault ${vault}. Offen:\n  ${pages.map((t) => t.title).join("\n  ")}`,
      );
    }
    if (matching.length > 1) {
      throw new Error(
        `Mehrere Obsidian-Fenster offen — mit --vault <name> eines waehlen:\n  ` +
          matching.map((t) => t.title).join("\n  "),
      );
    }
    const page = matching[0];
    // Der Filter oben garantiert die URL, der Typ nicht — der Guard haelt beides zusammen.
    if (!page.webSocketDebuggerUrl) throw new Error(`Fenster ohne Debugger-URL: ${page.title}`);
    console.log(`Fenster: ${page.title}`);

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket-Verbindung fehlgeschlagen")), {
        once: true,
      });
    });
    return new Cdp(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      setTimeout(() => {
        if (!this.pending.delete(id)) return;
        fail(new Error(`Zeitüberschreitung: ${method}`));
      }, 30_000);
    });
  }

  /** Ausdruck im Renderer auswerten. Wirft die Renderer-Ausnahme weiter, statt sie
   *  als `undefined` zu verschlucken — sonst liest sich ein kaputter Ausdruck wie ein
   *  fehlgeschlagener Prüfpunkt. */
  async evaluate<T>(expression: string): Promise<T> {
    const message = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const details = message.result?.exceptionDetails;
    if (details) throw new Error(`Renderer: ${details.text ?? "Ausnahme"}`);
    return message.result?.result?.value as T;
  }

  close(): void {
    this.socket.close();
  }
}

// --- Prüfpunkte -------------------------------------------------------------

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const results: Check[] = [];

function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Was der Lauf bewusst NICHT misst. Steht im Protokoll, damit eine Lücke nicht wie
 *  Abdeckung aussieht — ein stillschweigend ausgelassener Punkt liest sich hinterher
 *  wie ein grüner. */
function skipped(name: string, reason: string): void {
  console.log(`  – ${name} — übersprungen: ${reason}`);
}

/** Im Renderer: warten, bis `check()` wahr wird (Rendering ist asynchron). */
const waitFor = (body: string, timeoutMs = 8000): string => `
  const deadline = Date.now() + ${timeoutMs};
  while (Date.now() < deadline) {
    const value = (() => { ${body} })();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
`;

/** Dasselbe für Bedingungen, die selbst `await` brauchen (Datei lesen etwa). */
const waitForAsync = (body: string, timeoutMs = 8000): string => `
  const deadline = Date.now() + ${timeoutMs};
  while (Date.now() < deadline) {
    const value = await (async () => { ${body} })();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
`;

// --- Szenen-Helfer ----------------------------------------------------------

/** Kamera-Ansicht, wie sie im Block steht (orbit-relativ). */
interface ViewValues {
  azimuth: number;
  elevation: number;
  distance: number;
}

/** Alle vom Lauf angelegten Notizen — das `finally` räumt sie gebündelt weg. */
const createdNotes = new Set<string>();

const fence = "```";

/** Notiz schreiben und öffnen. `mode` ist Obsidians Ansichtsmodus: "preview" =
 *  Lesemodus, "source" = Editor (Live Preview). */
async function openNote(
  cdp: Cdp,
  path: string,
  body: string,
  mode: "preview" | "source",
): Promise<void> {
  createdNotes.add(path);
  await cdp.evaluate(`
    const path = ${JSON.stringify(path)};
    const body = ${JSON.stringify(body)};
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing) await app.vault.modify(existing, body);
    else await app.vault.create(path, body);
    const file = app.vault.getAbstractFileByPath(path);
    const leaf =
      app.workspace.getMostRecentLeaf(app.workspace.rootSplit) ?? app.workspace.getLeaf(true);
    await leaf.openFile(file, { state: { mode: ${JSON.stringify(mode)} } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 200));
    return true;
  `);
}

/** Notiz schliessen und neu oeffnen, ohne ihren Inhalt anzufassen — beim Prüfen einer
 *  gerade geschriebenen Zeile wäre ein `modify` genau das Gegenteil des Ziels.
 *  Der Umweg über `getMostRecentLeaf(rootSplit)` ist derselbe wie in `openNote`:
 *  nach `open-controls` ist das zuletzt benutzte Blatt die Sidebar. */
async function reopenNote(cdp: Cdp, path: string, mode: "preview" | "source"): Promise<void> {
  await cdp.evaluate(`
    const current = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
    if (current) current.detach();
    await new Promise((r) => setTimeout(r, 400));
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file, { state: { mode: ${JSON.stringify(mode)} } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 600));
    return true;
  `);
}

/** Einen Block aus dem Standbild wecken und warten, bis sein Controller ein Modell
 *  hat. Ohne das zweite Warten misst man das Laden, nicht das Verhalten. */
async function describeScene(cdp: Cdp): Promise<string> {
  return cdp.evaluate<string>(`
    const view = app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view;
    const root = view?.containerEl ?? document.body;
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    return [
      "Datei " + (app.workspace.getActiveFile()?.path ?? "(keine)"),
      "Modus " + (view?.getMode?.() ?? "?"),
      root.querySelectorAll(".tdcb-block").length + " Block(e)",
      root.querySelectorAll(".tdcb-play").length + " Standbild(er)",
      root.querySelectorAll("pre > code").length + " roher Codeblock",
      "Controller " + (plugin?.active?.get?.() ? "da" : "keiner"),
    ].join(" · ");
  `);
}

async function activateBlock(cdp: Cdp, index = 0, expectedLabel?: string): Promise<boolean> {
  const ok = await cdp.evaluate<string | null>(`
    // Erst auf die Klickfläche WARTEN: nach dem Öffnen einer Notiz rendert Obsidian
    // asynchron, ein sofortiges querySelectorAll findet nichts und der Klick geht ins
    // Leere — der Fehlschlag sieht dann aus wie "Modell lädt nicht".
    const overlays = await (async () => {
      ${waitFor(`
        const found = [...document.querySelectorAll(".tdcb-play")];
        return found.length > ${index} ? found : 0;
      `)}
    })();
    const target = overlays ? overlays[${index}] : null;
    if (target) target.click();
    // Auf den ERWARTETEN Block warten, nicht auf irgendeinen Controller: nach einem
    // Notizwechsel bleibt der Controller der vorigen Notiz kurz registriert. Ein Save
    // landet dann in einem Block, den es im DOM nicht mehr gibt — still, ohne Notice.
    // Gemessen 2026-08-14: im Gesamtlauf war V6 deshalb rot, im Einzellauf grün, weil
    // beide Abschnitte ihren Block gleich benannt hatten.
    const wanted = ${JSON.stringify(expectedLabel ?? null)};
    ${waitFor(`
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const controller = plugin.active.get();
      if (!controller || !controller.getView()) return 0;
      if (wanted && controller.label() !== wanted) return 0;
      return "ok";
    `)}
  `);
  return ok === "ok";
}

/** Die `view:`-Zeile aus dem Block in Zahlen übersetzen. Kennt die Namen aus
 *  `NAMED_VIEWS`, weil der Schreibweg sie bevorzugt, sobald der Winkel nah genug liegt. */
function parseViewLine(line: string | null): ViewValues | null {
  if (!line) return null;
  const value = line.slice("view:".length).trim();
  const named: Record<string, ViewValues> = {
    front: { azimuth: 0, elevation: 0, distance: 1 },
    back: { azimuth: 180, elevation: 0, distance: 1 },
    left: { azimuth: -90, elevation: 0, distance: 1 },
    right: { azimuth: 90, elevation: 0, distance: 1 },
    top: { azimuth: 0, elevation: 89, distance: 1 },
    iso: { azimuth: 45, elevation: 30, distance: 1 },
  };
  if (named[value]) return named[value];
  const parts = value.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { azimuth: parts[0], elevation: parts[1], distance: parts[2] };
}

/** Den Knopf mit dieser Beschriftung im Sidebar-Panel klicken. */
async function clickPanelButton(cdp: Cdp, label: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const actions = document.querySelector(".tdcb-panel-actions");
    const button = [...(actions?.querySelectorAll("button") ?? [])]
      .find((b) => b.textContent === ${JSON.stringify(label)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  `);
}

// --- Abschnitt: aktiver Block + Sidebar (2026-08-04) ------------------------

async function sectionActiveBlock(cdp: Cdp, model: string): Promise<void> {
  // Zwei Blöcke mit Titeln, damit der Aktiv-Bezug prüfbar ist (Sidebar zeigt genau
  // diesen Titel), Modus "erst auf Klick" für den Standbild-Pfad.
  // Den Notiztext hier bauen, nicht im Renderer: Backticks in einem Ausdruck, der
  // selbst durch ein Template-Literal geht, sind eine Zitier-Falle ohne Gewinn.
  const noteBody = [
    "# GUI-Smoke (automatisch erzeugt, wird nach dem Lauf gelöscht)",
    "",
    `${fence}3d`,
    `file: ${model}`,
    "title: Erdgeschoss",
    fence,
    "",
    `${fence}3d`,
    `file: ${model}`,
    "title: Obergeschoss",
    fence,
    "",
  ].join("\n");

  await openNote(cdp, SMOKE_NOTE, noteBody, "preview");
  await cdp.evaluate(
    `await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)}); return true;`,
  );

  // --- 1. Standbild erscheint --------------------------------------------
  const posterCount = await cdp.evaluate<number | null>(
    waitFor(`
      const overlays = document.querySelectorAll(".tdcb-play");
      return overlays.length >= 2 ? overlays.length : 0;
    `),
  );
  record(
    "1. Modus 'erst auf Klick': beide Blöcke starten als Standbild",
    posterCount === 2,
    `${posterCount ?? 0} Klickflächen`,
  );

  // --- 2. Sidebar zeigt vor dem Klick den Platzhalter ----------------------
  const before = await cdp.evaluate<string>(`
    const panel = document.querySelector(".tdcb-panel");
    return panel ? panel.textContent.trim() : "(keine Sidebar)";
  `);
  record(
    "2. Sidebar zeigt zunächst den Platzhalter",
    before.startsWith("Click a 3D model"),
    before.slice(0, 48),
  );

  // --- 3. DER BEFUND: Klick aufs Standbild füllt die Sidebar ---------------
  // Regression zu `eb78941`: der Reaktivierungs-Klick meldete sich nie als
  // Interaktion, das Modell wurde live und die Sidebar blieb beim Platzhalter.
  const afterClick = await cdp.evaluate<string | null>(`
    const overlays = [...document.querySelectorAll(".tdcb-play")];
    const second = overlays[1] ?? overlays[0];
    if (!second) return null;
    second.click();
    ${waitFor(`
      const panel = document.querySelector(".tdcb-panel");
      const label = panel?.querySelector(".tdcb-panel-label");
      return label ? label.textContent.trim() : 0;
    `)}
  `);
  record(
    "3. Klick aufs Standbild füllt die Sidebar (Smoke-#4-Befund)",
    afterClick === "Obergeschoss",
    afterClick === null ? "Sidebar blieb leer" : `Label: ${afterClick}`,
  );

  // --- 4. Save view ist danach bedienbar ----------------------------------
  const buttons = await cdp.evaluate<{ save: boolean; count: number }>(`
    const actions = document.querySelector(".tdcb-panel-actions");
    const save = [...(actions?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Save view");
    return { save: !!save && !save.disabled, count: actions ? actions.querySelectorAll("button").length : 0 };
  `);
  record(
    "4. 'Save view' ist bedienbar, nicht nur sichtbar",
    buttons.save,
    `${buttons.count} Knöpfe im Panel`,
  );

  // --- 5. Der aktive Block ist erkennbar ----------------------------------
  // `f53e88b`: Rahmen kräftiger + Titel im Akzent. Geprüft wird der EFFEKT im
  // echten Theme (computed style), nicht die Klasse — die Klasse hing schon vorher.
  // `found` ist nicht kosmetisch: ohne die Prüfung auf einen VORHANDENEN Aktiv-Titel
  // wurde Punkt 6 grün, gerade WEIL kein Block aktiv war — der Vergleich lief dann
  // gegen einen leeren String und meldete pflichtschuldig "unterscheidet sich".
  // Aufgefallen in der Gegenprobe gegen einen Build ohne den Fix (2026-08-04).
  const highlight = await cdp.evaluate<{
    active: number;
    found: boolean;
    sameAsPlain: boolean;
    shadow: string;
  }>(`
    const colorOf = (el) => (el ? getComputedStyle(el).color : "");
    const activeTitle = document.querySelector(".tdcb-active .tdcb-title");
    const plainTitle = [...document.querySelectorAll(".tdcb-title")]
      .find((t) => !t.closest(".tdcb-active"));
    const stage = document.querySelector(".tdcb-active .tdcb-stage");
    return {
      active: document.querySelectorAll(".tdcb-active").length,
      found: !!activeTitle && !!plainTitle,
      sameAsPlain: colorOf(activeTitle) === colorOf(plainTitle),
      shadow: stage ? getComputedStyle(stage).boxShadow : "",
    };
  `);
  record(
    "5. Genau ein Block ist als aktiv markiert",
    highlight.active === 1,
    `${highlight.active} Blöcke mit .tdcb-active`,
  );
  record(
    "6. Der Titel des aktiven Blocks hebt sich ab",
    highlight.found && !highlight.sameAsPlain,
    !highlight.found
      ? "kein aktiver Titel vorhanden — nicht prüfbar"
      : highlight.sameAsPlain
        ? "gleiche Farbe wie ein inaktiver Titel"
        : "Akzentfarbe greift",
  );
  record(
    "7. Der Aktiv-Rahmen liegt auf der Bühne",
    highlight.shadow !== "" && highlight.shadow !== "none",
    highlight.shadow || "kein box-shadow",
  );

  // --- 8. Beide Themes ----------------------------------------------------
  // Über die Body-Klassen, NICHT über `app.changeTheme`: der API-Aufruf schreibt das
  // Ergebnis nach `.obsidian/appearance.json` und macht aus einem Vault, der bis dahin
  // dem System folgte (kein `theme`-Schlüssel), einen fest eingestellten. Gemessen
  // 2026-08-04 — ein Prüfwerkzeug darf die Einstellungen seines Wirts nicht umschreiben.
  // Die Theme-Variablen hängen an `.theme-dark`/`.theme-light`, der Klassentausch misst
  // also dasselbe und hinterlässt nichts.
  const themes = await cdp.evaluate<{ dark: string; light: string }>(`
    const read = () => {
      const t = document.querySelector(".tdcb-active .tdcb-title");
      return t ? getComputedStyle(t).color : "";
    };
    const body = document.body;
    const wasDark = body.classList.contains("theme-dark");
    const set = (dark) => {
      body.classList.toggle("theme-dark", dark);
      body.classList.toggle("theme-light", !dark);
    };
    set(true);
    const dark = read();
    set(false);
    const light = read();
    set(wasDark);
    return { dark, light };
  `);
  record(
    "8. Der Akzent folgt dem Theme (hell ≠ dunkel)",
    themes.dark !== themes.light && themes.dark !== "" && themes.light !== "",
    `dunkel ${themes.dark || "?"} · hell ${themes.light || "?"}`,
  );
}

// --- Abschnitt: Ansicht merken (docs/SMOKE.md 2026-07-25, Punkte 1–8) -------

async function sectionSaveView(cdp: Cdp, model: string): Promise<void> {
  const singleBlock = [
    "# GUI-Smoke „Ansicht merken\" (automatisch erzeugt)",
    "",
    `${fence}3d`,
    `file: ${model}`,
    `title: ${VIEW_BLOCK_TITLE}`,
    fence,
    "",
  ].join("\n");

  await openNote(cdp, SMOKE_NOTE_VIEW, singleBlock, "preview");
  await cdp.evaluate(
    `await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)}); return true;`,
  );
  const live = await activateBlock(cdp, 0, VIEW_BLOCK_TITLE);
  if (!live) {
    record("V1. Modell wird live und liefert eine Ansicht", false, "kein Controller mit getView()");
    return;
  }

  // --- V1. Drehen per echter Interaktion ----------------------------------
  // Der Drag geht bewusst über echte Pointer-Events auf dem Canvas statt über
  // `applyView`: das misst die Naht OrbitControls → `cameraToView`, die kein
  // Unit-Test hat. `setPointerCapture` braucht eine echte pointerId — schlägt es
  // fehl, bricht OrbitControls' Handler ab und der Prüfpunkt wird rot statt still
  // danebenzugreifen.
  const dragged = await cdp.evaluate<{ before: unknown; after: unknown; error: string | null }>(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const controller = plugin.active.get();
    const before = controller.getView();
    const canvas = document.querySelector(".tdcb-active canvas");
    if (!canvas) return { before, after: null, error: "kein Canvas im aktiven Block" };
    const rect = canvas.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const opts = (x, y) => ({
      clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
    });
    let error = null;
    try {
      canvas.dispatchEvent(new PointerEvent("pointerdown", opts(cx, cy)));
      for (let step = 1; step <= 6; step++) {
        canvas.dispatchEvent(new PointerEvent("pointermove", opts(cx + step * 18, cy + step * 5)));
        await new Promise((r) => setTimeout(r, 16));
      }
      canvas.dispatchEvent(new PointerEvent("pointerup", opts(cx + 108, cy + 30)));
    } catch (e) {
      error = String(e && e.message ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 200));
    return { before, after: controller.getView(), error };
  `);
  const moved =
    dragged.error === null &&
    JSON.stringify(dragged.before) !== JSON.stringify(dragged.after) &&
    dragged.after !== null;
  record(
    "V1. Drehen per echter Maus-Interaktion bewegt die Kamera",
    moved,
    dragged.error ?? `${JSON.stringify(dragged.before)} → ${JSON.stringify(dragged.after)}`,
  );

  // --- V2. Save view schreibt die view:-Zeile in den Block -----------------
  const savedClick = await clickPanelButton(cdp, "Save view");
  const savedLine = await cdp.evaluate<string | null>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_VIEW)});
    ${waitForAsync(`
      const text = await app.vault.read(file);
      const line = text.split("\\n").find((l) => l.startsWith("view:"));
      return line ?? 0;
    `)}
  `);
  record(
    "V2. 'Save view' schreibt eine view:-Zeile in den Block",
    savedClick && savedLine !== null,
    savedClick ? (savedLine ?? "keine view:-Zeile in der Notiz") : "Knopf war nicht bedienbar",
  );

  // --- V3. Die Ansicht überlebt das Schließen und Neuöffnen ---------------
  // Der eigentliche Zweck des Features: eine gemerkte Ansicht muss den Neuaufbau
  // überstehen, nicht nur im Text stehen.
  //
  // Verglichen wird gegen die GESCHRIEBENE Zeile, nicht gegen den Controller von
  // vorhin: der Write ändert die Notiz, Live-Preview baut den Block daraufhin neu auf
  // und `active.get()` ist danach `null` (im Modus "erst auf Klick" steht dort wieder
  // ein Standbild). Gemessen 2026-08-14 — der erste Entwurf verglich zwei `null`
  // miteinander und wäre bei einem kaputten Wiederherstellen trotzdem grün geworden.
  const viewBeforeReload = parseViewLine(savedLine);
  await reopenNote(cdp, SMOKE_NOTE_VIEW, "preview");
  const reactivated = await activateBlock(cdp, 0, VIEW_BLOCK_TITLE);
  const viewAfterReload = await cdp.evaluate<unknown>(`
    return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get()?.getView() ?? null;
  `);
  const near = (a: ViewValues | null, b: unknown): boolean => {
    const left = a;
    const right = b as ViewValues | null;
    if (!left || !right) return false;
    // 1.5° statt 0: die Zeile trägt ganze Grad, der Rückweg über die Kamera rundet
    // erneut. Eine Abweichung von einem Grad ist deshalb erwartbar — dass sie sich
    // NICHT aufschaukelt, prüft der nächste Punkt.
    return (
      Math.abs(left.azimuth - right.azimuth) <= 1.5 &&
      Math.abs(left.elevation - right.elevation) <= 1.5 &&
      Math.abs(left.distance - right.distance) < 0.05
    );
  };
  record(
    "V3. Die gemerkte Ansicht steht nach dem Neuöffnen wieder da",
    reactivated && near(viewBeforeReload, viewAfterReload),
    reactivated
      ? `vorher ${JSON.stringify(viewBeforeReload)} · nachher ${JSON.stringify(viewAfterReload)}`
      : `Block nach dem Neuöffnen nicht weckbar — ${await describeScene(cdp)}`,
  );

  // --- V3b. Der Rundungsrest schaukelt sich nicht auf ----------------------
  // Ohne diesen Punkt bliebe offen, ob das eine Grad aus V3 ein einmaliger Rest ist
  // oder ein Drift, der eine Ansicht über mehrere Speicherzyklen wegwandern lässt.
  await clickPanelButton(cdp, "Save view");
  const secondLine = await cdp.evaluate<string | null>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_VIEW)});
    ${waitForAsync(`
      const text = await app.vault.read(file);
      const line = text.split("\\n").find((l) => l.startsWith("view:"));
      return line ?? 0;
    `)}
  `);
  const secondValues = parseViewLine(secondLine);
  const stable = near(secondValues, viewAfterReload);
  record(
    "V3b. Ein zweiter Speicherzyklus verschiebt die Ansicht nicht weiter",
    stable,
    `${savedLine ?? "?"} → neu geladen ${JSON.stringify(viewAfterReload)} → ${secondLine ?? "nichts geschrieben"}`,
  );

  // --- V4. Namens-Schreibweise (Toleranz 5°) ------------------------------
  // Nahe an `iso` (45,30,1) stellen — im Block muss der NAME stehen, nicht drei
  // Zahlen. Von Hand trifft man 5° kaum reproduzierbar, per `applyView` schon;
  // geprüft wird die Formatierung beim Schreiben, nicht die Zielgenauigkeit der Maus.
  await activateBlock(cdp, 0, VIEW_BLOCK_TITLE);
  await cdp.evaluate(`
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    if (!controller) return false;
    controller.applyView({ azimuth: 47, elevation: 32, distance: 1.02 });
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `);
  await clickPanelButton(cdp, "Save view");
  const namedLine = await cdp.evaluate<string | null>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_VIEW)});
    ${waitForAsync(`
      const text = await app.vault.read(file);
      const line = text.split("\\n").find((l) => l.startsWith("view:"));
      return line && line.includes("iso") ? line : 0;
    `)}
  `);
  record(
    "V4. Nahe an einem Standardwinkel steht der Name im Block, nicht drei Zahlen",
    namedLine !== null,
    namedLine ?? "keine view: iso-Zeile (Toleranz ist 5°)",
  );

  // --- V5. Clear view entfernt die Zeile im Lesemodus ---------------------
  // Wieder wecken: der V4-Write hat den Block neu aufgebaut (s. V3).
  await activateBlock(cdp, 0, VIEW_BLOCK_TITLE);
  // Erst nachsehen, ob überhaupt etwas zu entfernen DA ist. Ohne diese Frage ist der
  // Punkt wertlos: fehlt die Zeile schon vorher (weil ein früherer Write scheiterte),
  // meldet er pflichtschuldig "weg" und wird grün, gerade weil nichts funktioniert hat.
  // Aufgefallen 2026-08-14 in der Gegenprobe gegen einen stillgelegten Schreibweg.
  const beforeClear = await cdp.evaluate<string | null>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_VIEW)});
    const text = await app.vault.read(file);
    return text.split("\\n").find((l) => l.startsWith("view:")) ?? null;
  `);
  const cleared = await clickPanelButton(cdp, "Clear view");
  const goneLine = await cdp.evaluate<string | null>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_VIEW)});
    ${waitForAsync(`
      const text = await app.vault.read(file);
      return text.split("\\n").some((l) => l.startsWith("view:")) ? 0 : "weg";
    `)}
  `);
  record(
    "V5. 'Clear view' entfernt die Zeile wieder (Lesemodus)",
    beforeClear !== null && cleared && goneLine === "weg",
    beforeClear === null
      ? "vorher stand gar keine view:-Zeile da — nichts zu entfernen, nicht aussagekräftig"
      : cleared
        ? `${beforeClear} → ${goneLine ?? "steht noch in der Notiz"}`
        : "Knopf war nicht bedienbar",
  );

  // --- V6. Undo im Quelltext-Editor ---------------------------------------
  // Der zweite Schreibweg: im Editor geht der Write durch den Buffer, nicht durch
  // `vault.modify`. Undo ist der Beleg, dass er als normale Editor-Änderung ankommt
  // — ein Write an CodeMirror vorbei wäre nicht rückgängig zu machen.
  // Der Editor-Schreibweg braucht einen GERENDERTEN Block — den gibt es im Quelltext-
  // Modus nur mit Live Preview. Steht der Vault auf `livePreview: false` (Legacy-
  // Editor), rendert Obsidian den Codeblock dort gar nicht: `.tdcb-block` = 0, und die
  // Sidebar zeigt noch den Controller aus dem Lesemodus. Der Prüfpunkt misst dann einen
  // Schreibversuch auf einen Block, den es nicht mehr gibt — er wird rot, ohne dass am
  // Plugin etwas fehlt. Gemessen 2026-08-14 im outpost-Vault (steht auf `false`).
  // Deshalb: Vorwert merken, für diesen Punkt einschalten, danach zurückschreiben.
  const previousLivePreview = await cdp.evaluate<boolean>(
    `return app.vault.getConfig("livePreview") === true;`,
  );
  await cdp.evaluate(`
    // Erst umstellen, dann die View NEU aufbauen: eine bereits offene Markdown-View
    // übernimmt den Wechsel Legacy-Editor → Live Preview nicht im laufenden Betrieb.
    // Ohne den Neuaufbau steht der Block zwar da, der Schreibweg findet seine Stelle
    // im Dokument aber nicht — save() läuft dann still ins Leere (gemessen 2026-08-14).
    app.vault.setConfig("livePreview", true);
    await new Promise((r) => setTimeout(r, 300));
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_VIEW)});
    const current = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
    if (current) current.detach();
    await new Promise((r) => setTimeout(r, 400));
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file, { state: { mode: "source" } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  `);
  const liveInEditor = await activateBlock(cdp, 0, VIEW_BLOCK_TITLE);
  const panelState = await cdp.evaluate<{ label: string; save: string }>(`
    const actions = document.querySelector(".tdcb-panel-actions");
    const button = [...(actions?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Save view");
    const label = document.querySelector(".tdcb-panel-label");
    return {
      label: label ? label.textContent.trim() : "(kein Label)",
      save: button ? (button.disabled ? "deaktiviert" : "bedienbar") : "(kein Knopf)",
    };
  `);
  const clickedInEditor = await clickPanelButton(cdp, "Save view");
  const inEditor = await cdp.evaluate<string | null>(
    waitFor(`
      const editor = app.workspace.activeEditor?.editor;
      if (!editor) return 0;
      const line = editor.getValue().split("\\n").find((l) => l.startsWith("view:"));
      return line ?? 0;
    `),
  );
  // Wo ist der Write gelandet? Steht er in der Datei, aber nicht im Buffer, dann ging er
  // an CodeMirror vorbei — und Undo kann ihn prinzipiell nicht zurücknehmen.
  const inFile = await cdp.evaluate<string | null>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_VIEW)});
    const text = await app.vault.read(file);
    return text.split("\\n").find((l) => l.startsWith("view:")) ?? null;
  `);
  const notices = await cdp.evaluate<string>(`
    return [...document.querySelectorAll(".notice")].map((n) => n.textContent.trim()).join(" | ");
  `);
  // Direktaufruf als Gegenprobe: schreibt `save()` selbst, lag es am Knopf; wirft es,
  // haben wir den Grund; tut es still nichts, ist der Schreibweg der Befund.
  const direct =
    inEditor !== null
      ? "(nicht nötig)"
      : await cdp.evaluate<string>(`
          const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
          if (!controller) return "kein Controller";
          if (!controller.canSave()) return "canSave() ist false";
          try {
            await controller.save(controller.getView());
          } catch (e) {
            return "save() warf: " + String(e && e.message ? e.message : e);
          }
          await new Promise((r) => setTimeout(r, 500));
          const editor = app.workspace.activeEditor?.editor;
          const inBuffer = (editor?.getValue() ?? "").includes("view:");
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_VIEW)});
          const inFile = (await app.vault.read(file)).includes("view:");
          return "save() lief durch — Buffer: " + inBuffer + ", Datei: " + inFile;
        `);
  const afterUndo = await cdp.evaluate<string>(`
    const editor = app.workspace.activeEditor?.editor;
    if (!editor) return "(kein Editor)";
    editor.undo();
    await new Promise((r) => setTimeout(r, 300));
    return editor.getValue().split("\\n").some((l) => l.startsWith("view:")) ? "steht noch" : "weg";
  `);
  record(
    "V6. Im Editor gespeichert, per Undo rückgängig",
    liveInEditor && clickedInEditor && inEditor !== null && afterUndo === "weg",
    inEditor === null
      ? `kein view: im Editor-Buffer — Datei: ${inFile ?? "auch nicht"} · Direktaufruf: ${direct} · (live: ${liveInEditor}, Panel: ${panelState.label}, Save: ${panelState.save}, Klick: ${clickedInEditor}, Notice: ${notices || "keine"})`
      : `${inEditor} → ${afterUndo}`,
  );

  await cdp.evaluate(
    `app.vault.setConfig("livePreview", ${JSON.stringify(previousLivePreview)}); return true;`,
  );

  // --- V7. Sidebar zu → Hover-Leiste, Sidebar auf → wieder weg ------------
  // Der Marker prüft die eigentliche Zusage aus Task 13: die Leiste kommt und geht
  // über `layout-change`, OHNE dass die Notiz neu aufgebaut wird. Ein Neuaufbau
  // würde denselben sichtbaren Endzustand erzeugen und die Regression verstecken.
  const toolbar = await cdp.evaluate<{
    afterClose: number;
    afterOpen: number;
    survived: boolean;
  }>(`
    const block = document.querySelector(".tdcb-block");
    if (block) block.dataset.smokeMark = "kept";
    app.workspace.detachLeavesOfType(${JSON.stringify(CONTROLS_VIEW)});
    await (async () => {
      ${waitFor(`return document.querySelectorAll(".tdcb-toolbar").length > 0 ? 1 : 0;`)}
    })();
    const afterClose = document.querySelectorAll(".tdcb-toolbar").length;
    await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)});
    await (async () => {
      ${waitFor(`return document.querySelectorAll(".tdcb-toolbar").length === 0 ? 1 : 0;`)}
    })();
    const afterOpen = document.querySelectorAll(".tdcb-toolbar").length;
    const survived = document.querySelector(".tdcb-block")?.dataset.smokeMark === "kept";
    return { afterClose, afterOpen, survived };
  `);
  record(
    "V7. Sidebar zu → Hover-Leiste erscheint, Sidebar auf → verschwindet",
    toolbar.afterClose > 0 && toolbar.afterOpen === 0,
    `zu: ${toolbar.afterClose} Leiste(n) · auf: ${toolbar.afterOpen}`,
  );
  record(
    "V8. Der Wechsel läuft ohne Neuaufbau der Notiz",
    toolbar.survived,
    toolbar.survived ? "Block-Element blieb dasselbe" : "Block wurde neu aufgebaut",
  );

  // --- V9. Embed: speichern deaktiviert, Fit funktioniert -----------------
  // Die bewusste Asymmetrie aus der Spec: ohne Codeblock gibt es nichts, worin man
  // eine Ansicht merken könnte — das muss man am Knopf sehen, nicht erst am Fehler.
  const embedBody = [
    "# GUI-Smoke Embed (automatisch erzeugt)",
    "",
    `![[${model}]]`,
    "",
  ].join("\n");
  await openNote(cdp, SMOKE_NOTE_EMBED, embedBody, "preview");
  const embedLive = await activateBlock(cdp);
  const embedButtons = await cdp.evaluate<{
    save: boolean;
    clear: boolean;
    fit: boolean;
    tooltip: string;
  }>(`
    const actions = document.querySelector(".tdcb-panel-actions");
    const find = (label) =>
      [...(actions?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
    const save = find("Save view");
    const clear = find("Clear view");
    const fit = find("Fit");
    return {
      save: !!save && save.disabled,
      clear: !!clear && clear.disabled,
      fit: !!fit && !fit.disabled,
      tooltip: save ? (save.title || save.getAttribute("aria-label") || "") : "(kein Knopf)",
    };
  `);
  record(
    "V9. Im Embed sind 'Save view'/'Clear view' deaktiviert, 'Fit' nicht",
    embedLive && embedButtons.save && embedButtons.clear && embedButtons.fit,
    `save ${embedButtons.save ? "aus" : "AN"} · clear ${embedButtons.clear ? "aus" : "AN"} · fit ${embedButtons.fit ? "an" : "AUS"}`,
  );
  record(
    "V10. Der deaktivierte Knopf sagt auch, warum",
    embedButtons.tooltip.includes("3d") && embedButtons.tooltip.includes("code block"),
    embedButtons.tooltip || "kein Tooltip",
  );

  // --- V11. Dieselbe Asymmetrie beim direkten Öffnen der Datei -------------
  // SMOKE.md Punkt 7 nennt zwei Wege ohne Codeblock: Embed UND geöffnete Datei.
  // Der zweite geht über die FileView, nicht über den Markdown-Renderer — deshalb ein
  // eigener Prüfpunkt und keine Annahme, dass der Embed für beide spricht.
  await cdp.evaluate(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(model)});
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 2000));
    return true;
  `);
  const fileViewButtons = await cdp.evaluate<{ save: string; fit: string; canvas: number }>(`
    await (async () => {
      ${waitFor(`return document.querySelectorAll(".tdcb-stage canvas").length > 0 ? 1 : 0;`)}
    })();
    const actions = document.querySelector(".tdcb-panel-actions");
    const find = (label) =>
      [...(actions?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
    const save = find("Save view");
    const fit = find("Fit");
    return {
      save: save ? (save.disabled ? "deaktiviert" : "bedienbar") : "(kein Knopf)",
      fit: fit ? (fit.disabled ? "deaktiviert" : "bedienbar") : "(kein Knopf)",
      canvas: document.querySelectorAll(".tdcb-stage canvas").length,
    };
  `);
  record(
    "V11. Die geöffnete Datei zeigt das Modell, kann aber nichts merken",
    fileViewButtons.canvas > 0 &&
      fileViewButtons.save === "deaktiviert" &&
      fileViewButtons.fit === "bedienbar",
    `${fileViewButtons.canvas} Canvas · Save ${fileViewButtons.save} · Fit ${fileViewButtons.fit}`,
  );

  // Das Datei-Blatt wieder schliessen: es bleibt sonst neben der nächsten Notiz offen
  // und liefert ein zweites, leeres `.tdcb-hint`, gegen das der nächste Punkt prüft.
  await cdp.evaluate(`
    for (const leaf of app.workspace.getLeavesOfType(${JSON.stringify(FILE_VIEW)})) leaf.detach();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);

  // --- V12. Unbrauchbares view: meldet sich, ohne das Modell zu verstecken -
  const badBody = [
    "# GUI-Smoke kaputte Ansicht (automatisch erzeugt)",
    "",
    `${fence}3d`,
    `file: ${model}`,
    "title: Kaputt",
    "view: quatsch",
    fence,
    "",
  ].join("\n");
  await openNote(cdp, SMOKE_NOTE_BAD, badBody, "preview");
  const badLive = await activateBlock(cdp);
  // Auf das Canvas WARTEN, nicht sofort zählen: `getView()` liefert schon einen Wert,
  // während die Bühne noch aufgebaut wird. Ohne das Warten ist der Punkt ein Würfelwurf
  // (im zweiten Gesamtlauf am 2026-08-14 genau daran rot geworden).
  const bad = await cdp.evaluate<{ hint: string; canvas: number }>(`
    await (async () => {
      ${waitFor(`return document.querySelectorAll(".tdcb-stage canvas").length > 0 ? 1 : 0;`)}
    })();
    const hint = [...document.querySelectorAll(".tdcb-hint")].find((h) => h.textContent.trim());
    return {
      hint: hint ? hint.textContent.trim() : "",
      canvas: document.querySelectorAll(".tdcb-stage canvas").length,
    };
  `);
  record(
    "V12. 'view: quatsch' erzeugt eine Hinweiszeile",
    bad.hint.toLowerCase().includes("unknown view"),
    bad.hint.slice(0, 72) || "keine Hinweiszeile",
  );
  record(
    "V13. Das Modell bleibt trotz kaputter Ansicht sichtbar",
    badLive && bad.canvas > 0,
    `${bad.canvas} Canvas im Viewport`,
  );

  skipped(
    "SMOKE.md 'Ansicht merken' Punkt 5 (fünf Etagen, Aktiv-Rahmen)",
    "inhaltlich vom Abschnitt 'aktiver Block' abgedeckt (Prüfpunkte 5–7)",
  );
}

// --- Ablauf -----------------------------------------------------------------

const SECTIONS: { key: string; title: string; run: (cdp: Cdp, model: string) => Promise<void> }[] = [
  { key: "active", title: "Aktiver Block + Sidebar (2026-08-04)", run: sectionActiveBlock },
  { key: "view", title: "Ansicht merken (SMOKE.md 2026-07-25)", run: sectionSaveView },
];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const port = Number(flag("port") ?? 9222);
  const keep = argv.includes("--keep");
  const modelArg = flag("model");
  const vault = flag("vault");
  const sectionArg = flag("section");

  const sections = sectionArg
    ? SECTIONS.filter((s) => s.key === sectionArg)
    : SECTIONS;
  if (sections.length === 0) {
    throw new Error(`Unbekannter --section ${sectionArg}. Bekannt: ${SECTIONS.map((s) => s.key).join(", ")}`);
  }

  console.log(`GUI-Smoke — Obsidian auf Port ${port}`);
  const cdp = await Cdp.attach(port, vault);
  // Ausserhalb des try, damit das `finally` ihn auch nach einem Abbruch mitten im Lauf
  // zurueckschreiben kann — sonst bliebe der Vault im Smoke-Zustand stehen.
  let previousViewMode: string | null = null;

  try {
    // Ohne Fokus drosselt Chromium den Renderer. `Page.bringToFront` allein genuegt auf
    // macOS NICHT: es holt das Fenster innerhalb der App nach vorn, nicht die App nach
    // vorn. Gemessen 2026-08-04 — im Hintergrund blieb das DOM der Notiz komplett leer
    // (`.tdcb-block` = 0, kein Notiztext), obwohl `app.workspace` die Datei korrekt als
    // aktiv meldete. Man debuggt dann ein Phantom: Zustand richtig, Anzeige nicht da.
    await cdp.send("Page.bringToFront");
    if (process.platform === "darwin") {
      try {
        execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch {
        console.log("  (Hinweis: `osascript activate` schlug fehl — Fenster ggf. von Hand nach vorn holen)");
      }
      // NACH dem Aktivieren nochmal: `activate` holt die App nach vorn und darin das
      // zuletzt benutzte Fenster — bei mehreren offenen Vaults ist das nicht unseres.
      await cdp.send("Page.bringToFront");
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    // Fokus-Emulation: bei mehreren offenen Obsidian-Fenstern bekommt unseres den
    // echten Tastaturfokus oft nicht (die App hat genau ein Key-Window). Chromium
    // kann dem Renderer den Fokus vorspielen — damit entfällt die Hintergrund-
    // Drosselung, ohne dass der Smoke fremde Fenster schliessen muss. Gemessen
    // 2026-08-14: ohne das flackerte der Lauf zwischen 21/21 und Totalausfall.
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Fokus ist Voraussetzung, nicht Prüfgegenstand: ohne ihn drosselt Chromium den
    // Renderer, das Modell rendert nicht und ALLE Prüfpunkte werden rot — die Suche
    // beginnt dann am Plugin statt am Fenster. Deshalb hier abbrechen, mit Ansage.
    const focused = await cdp.evaluate<boolean>(
      `return document.hasFocus() && document.visibilityState === "visible";`,
    );
    if (!focused) {
      throw new Error(
        "Das Obsidian-Fenster hat keinen Fokus — Chromium drosselt dann den Renderer und " +
          "jeder Prüfpunkt wäre rot, ohne dass am Plugin etwas fehlt. Fenster nach vorn " +
          "holen (oder andere Obsidian-Fenster schliessen) und erneut fahren.",
      );
    }

    const version = await cdp.evaluate<string>(`return window.app?.appId ? app.vault.getName() : "";`);
    if (!version) throw new Error("Obsidians `app` ist im Renderer nicht erreichbar.");
    console.log(`Vault: ${version}\n`);

    // Das Plugin NEU LADEN, bevor irgendetwas gemessen wird. `npm run deploy` ersetzt
    // nur die Dateien; die laufende Obsidian-Instanz behält den alten Code im Speicher.
    // Ohne diesen Schritt misst der Smoke den zuletzt geladenen Stand und meldet ihn als
    // Ergebnis für den gerade gebauten — aufgefallen 2026-08-14 in der Gegenprobe: eine
    // absichtlich kaputte Version lief mit 13/13 grün durch.
    const plugin = await cdp.evaluate<{ ok: boolean; version?: string }>(`
      const id = ${JSON.stringify(PLUGIN_ID)};
      if (app.plugins.plugins[id]) {
        await app.plugins.disablePlugin(id);
        await new Promise((r) => setTimeout(r, 400));
      }
      await app.plugins.enablePlugin(id);
      await new Promise((r) => setTimeout(r, 1200));
      // Die Sidebar-Leaf aus einem früheren Lauf überlebt den Reload mit einer View-
      // Instanz aus dem ALTEN Code — sie sieht richtig aus, ist aber an nichts mehr
      // angeschlossen. Abräumen; der open-controls-Befehl erzeugt gleich eine frische.
      app.workspace.detachLeavesOfType(${JSON.stringify(CONTROLS_VIEW)});
      await new Promise((r) => setTimeout(r, 300));
      const p = app.plugins.plugins[id];
      return p ? { ok: true, version: p.manifest.version } : { ok: false };
    `);
    if (!plugin.ok) throw new Error(`Plugin ${PLUGIN_ID} ist nicht aktiv. Erst \`npm run deploy\`.`);
    console.log(`Plugin-Version im Vault: ${plugin.version}\n`);

    // Ein Modell aus dem Vault nehmen: der Treiber bringt keine Testdaten mit, damit
    // im Repo keine Vault-Pfade landen (Pfad-Guard) und er in jedem Vault läuft.
    const model = await cdp.evaluate<string | null>(`
      const wanted = ${JSON.stringify(modelArg ?? null)};
      if (wanted) return wanted;
      const file = app.vault.getFiles().find((f) => /\\.(glb|gltf)$/i.test(f.path) && !/\\.edit\\./.test(f.path));
      return file ? file.path : null;
    `);
    if (!model) throw new Error("Keine .glb/.gltf im Vault gefunden — mit --model <pfad> angeben.");
    console.log(`Modell: ${model}\n`);

    // Den Vorwert merken und im `finally` zurückschreiben: der Smoke braucht "on-click",
    // der Vault des Maintainers steht deswegen aber nicht darauf.
    previousViewMode = await cdp.evaluate<string>(`
      return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.viewMode;
    `);
    await cdp.evaluate(`
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      plugin.settings.viewMode = "on-click";
      await plugin.saveSettings?.();
      return true;
    `);

    for (const section of sections) {
      console.log(`── ${section.title}`);
      await section.run(cdp, model);
      console.log("");
    }
  } finally {
    // Aufräumen darf nie am Ergebnis hängen: auch ein abgebrochener Lauf gibt den Vault
    // so zurück, wie er ihn vorgefunden hat.
    if (previousViewMode !== null) {
      await cdp
        .evaluate(`
          const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          plugin.settings.viewMode = ${JSON.stringify(previousViewMode)};
          await plugin.saveSettings?.();
          return true;
        `)
        .catch(() => undefined);
    }
    if (!keep) {
      await cdp
        .evaluate(`
          for (const path of ${JSON.stringify([...createdNotes])}) {
            const file = app.vault.getAbstractFileByPath(path);
            if (file) await app.vault.delete(file);
          }
          return true;
        `)
        .catch(() => undefined);
    }
    cdp.close();
  }

  const failed = results.filter((check) => !check.passed);
  console.log(`${results.length - failed.length}/${results.length} grün`);
  if (failed.length > 0) {
    console.log("Rot:");
    for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nAbbruch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
