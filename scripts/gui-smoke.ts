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
/** Wird im Vault angelegt und am Ende wieder entfernt (außer mit `--keep`). */
const SMOKE_NOTE = "_tdcb-gui-smoke.md";

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
    }

    const version = await cdp.evaluate<string>(`return window.app?.appId ? app.vault.getName() : "";`);
    if (!version) throw new Error("Obsidians `app` ist im Renderer nicht erreichbar.");
    console.log(`Vault: ${version}\n`);

    const plugin = await cdp.evaluate<{ ok: boolean; version?: string }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
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

    // --- Szene herstellen ---------------------------------------------------
    // Zwei Blöcke mit Titeln, damit der Aktiv-Bezug prüfbar ist (Sidebar zeigt genau
    // diesen Titel), Modus "erst auf Klick" für den Standbild-Pfad.
    // Den Notiztext hier bauen, nicht im Renderer: Backticks in einem Ausdruck, der
    // selbst durch ein Template-Literal geht, sind eine Zitier-Falle ohne Gewinn.
    const fence = "```";
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

    // Den Vorwert merken und im `finally` zurückschreiben: der Smoke braucht "on-click",
    // der Vault des Maintainers steht deswegen aber nicht darauf.
    previousViewMode = await cdp.evaluate<string>(`
      return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.viewMode;
    `);

    await cdp.evaluate(`
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      plugin.settings.viewMode = "on-click";
      await plugin.saveSettings?.();

      const path = ${JSON.stringify(SMOKE_NOTE)};
      const body = ${JSON.stringify(noteBody)};

      const existing = app.vault.getAbstractFileByPath(path);
      if (existing) await app.vault.modify(existing, body);
      else await app.vault.create(path, body);

      const file = app.vault.getAbstractFileByPath(path);
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: "preview" } });
      await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)});
      return true;
    `);

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
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE)});
          if (file) await app.vault.delete(file);
          return true;
        `)
        .catch(() => undefined);
    }
    cdp.close();
  }

  const failed = results.filter((check) => !check.passed);
  console.log(`\n${results.length - failed.length}/${results.length} grün`);
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
