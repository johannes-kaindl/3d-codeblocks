/**
 * CDP-Bruecke zu einem laufenden Obsidian — die pluginneutrale Haelfte.
 *
 * Herausgeloest aus `scripts/gui-smoke.ts` am 2026-08-15, weil ein zweiter Treiber
 * (`scripts/shots.ts`, Aufnahme der README-Screenshots) dieselbe Bruecke braucht. Eine
 * zweite Kopie waere der Anfang derselben Drift, die bei `release.mjs` zu sieben
 * Fassungen fuehrte, von denen eine kaputt war.
 *
 * Hier steht nur, was ueber JEDES Obsidian-Plugin gilt: Verbindung, Auswertung,
 * Notiz oeffnen, Blaetter aufraeumen, warten, Notices lesen. Alles, was den Prueflings
 * kennt, bleibt beim jeweiligen Treiber.
 *
 * ## Voraussetzung
 *
 * Obsidian mit offenem Debug-Port (die App muss dafuer neu gestartet werden):
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * ```
 *
 * ⚠️ Chromium drosselt das Rendering nicht-fokussierter Fenster: ohne `Page.bringToFront`
 * bleibt die View leer und man debuggt ein Phantom (CORE-TEST-02).
 */

export interface CdpTarget {
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpResponse {
  id?: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  error?: { message?: string };
}

export class Cdp {
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

/** Notiz schreiben und öffnen. `mode` ist Obsidians Ansichtsmodus: "preview" =
 *  Lesemodus, "source" = Editor (Live Preview). */
export async function openNote(
  cdp: Cdp,
  path: string,
  body: string,
  mode: "preview" | "source",
): Promise<void> {
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
export async function reopenNote(cdp: Cdp, path: string, mode: "preview" | "source"): Promise<void> {
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

/** Warten, aber auf der NODE-Seite. `Cdp.send` bricht nach 30 s ab — ein `waitFor` im
 *  Renderer, das laenger wartet, reisst deshalb den ganzen Lauf ab statt den einen Punkt
 *  rot zu machen (gemessen 2026-08-14: fuenf Modelle brauchen im Kaltstart laenger).
 *  Jede Runde ist ein eigener, kurzer `Runtime.evaluate`. */
export async function pollUntil<T>(
  cdp: Cdp,
  expression: string,
  timeoutMs = 60_000,
  stepMs = 1000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await cdp.evaluate<T | null>(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return null;
}

/** Im Hauptbereich genau ein Blatt stehen lassen. Ohne das misst ein Punkt, der Blöcke
 *  zaehlt, die Summe aus mehreren offenen Ansichten derselben Notiz: gemessen
 *  2026-08-14 meldete "fuenf Bloecke" zehn, weil ein Split und die neu geoeffnete Notiz
 *  gleichzeitig offen standen — und die Zahl sah nach einem Plugin-Fehler aus.
 *  Nebeneffekt, der genauso wichtig ist: `getMostRecentLeaf(rootSplit)` ist danach
 *  eindeutig, sonst oeffnet die naechste Notiz womoeglich in der Sidebar. */
export async function closeExtraLeaves(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const leaves = [];
    app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));
    for (const leaf of leaves.slice(1)) leaf.detach();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  `);
}

/** Eine Einstellung des Pruefling-Plugins zur Laufzeit setzen. Der Vorwert wird nicht
 *  hier gemerkt, sondern in `main` als Gesamt-Schnappschuss zurueckgeschrieben — sonst
 *  haengt die Wiederherstellung daran, dass jeder Abschnitt sauber zu Ende laeuft. */
export async function setPluginSetting(
  cdp: Cdp,
  pluginId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await cdp.evaluate(`
    const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
    plugin.settings[${JSON.stringify(key)}] = ${JSON.stringify(value)};
    await plugin.saveSettings?.();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);
}

/** Die zuletzt gezeigten Notices einsammeln. Sie verschwinden nach wenigen Sekunden —
 *  gelesen wird deshalb direkt nach der Aktion, nicht am Ende des Pruefpunkts. */
export async function notices(cdp: Cdp): Promise<string> {
  return cdp.evaluate<string>(`
    return [...document.querySelectorAll(".notice")].map((n) => n.textContent.trim()).join(" | ");
  `);
}
