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
 * ⚠️ **Zuerst prüfen, wer sonst an Obsidian hängt.** Obsidian ist Single-Instance — ein
 * `quit` trifft die Instanz, an der möglicherweise eine andere Session arbeitet, und zerstört
 * deren Zustand. Der eigene Lauf ist danach sauber grün; der Schaden entsteht woanders und
 * fällt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "läuft bereits — NICHT beenden"
 * ```
 *
 * Hört der Port schon, dann **mitnutzen statt neu starten**: ein eigenes Fenster per
 * `vault-open` über IPC öffnen, dann `attachTo("workspace", port, vault)` — der Vault-Name
 * wählt, nicht die Reihenfolge. ⚠️ Die Port-Prüfung ersetzt die Frage nicht: sie zeigt aktive
 * CDP-Treiber, aber nicht, wer ein Fenster offen hält oder auf den Port wartet.
 *
 * Erst wenn nichts läuft — oder nach Absprache mit dem, der es benutzt — gilt das Rezept unten.
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
 * npm run smoke:gui -- --section basis --vault outpost-worldbuilding
 * ```
 *
 * ⚠️ Zwei Handgriffe, die beim Start regelmaessig Zeit kosten:
 * - `quit` und `open` NICHT in einer Kette absetzen — das Beenden ist noch nicht durch, `open`
 *   trifft die sterbende Instanz, und danach laeuft gar kein Obsidian. Zweiter `open`-Aufruf greift.
 * - Bei mehreren offenen Fenstern verlangt der Treiber `--vault <name>` und bricht sonst ab
 *   (mit Ansage — er raet das Fenster nicht).
 *
 * ⚠️ Chromium drosselt das Rendering nicht-fokussierter Fenster: ohne `Page.bringToFront`
 * bleibt die View leer und man debuggt ein Phantom (CORE-TEST-02).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  Cdp,
  closeExtraLeaves,
  notices,
  openNote as openNoteViaBridge,
  pollUntil,
  reopenNote,
  setPluginSetting,
} from "../../tools/obsidian-cdp/cdp.js";


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
const BASIS_BLOCK_TITLE = "Basis-Probe";
const SMOKE_NOTE_BASIS = "_tdcb-gui-smoke-basis.md";
const SMOKE_NOTE_MANY = "_tdcb-gui-smoke-many.md";
const SMOKE_NOTE_ERRORS = "_tdcb-gui-smoke-errors.md";
const SMOKE_NOTE_STL = "_tdcb-gui-smoke-stl.md";
const SMOKE_NOTE_FILES = "_tdcb-gui-smoke-files.md";
const SMOKE_NOTE_GLTF = "_tdcb-gui-smoke-gltf.md";
const SMOKE_NOTE_MIX = "_tdcb-gui-smoke-mix.md";
const SMOKE_NOTE_EDIT = "_tdcb-gui-smoke-edit.md";
const EDIT_BLOCK_TITLE = "Edit-Probe";
/** Eigenes Prüfmodell für den Edit-Modus: eine Kopie, in der ein Top-Level-Knoten das
 *  gesperrte Präfix trägt. Beide Seiten des Locked-Prüfpunkts sind so beim Namen
 *  bekannt, ohne etwas über das Vault-Modell anzunehmen. */
const SMOKE_MODEL_EDIT = "_tdcb-smoke-edit.gltf";
/** Notfall-STL, falls im Vault keine liegt: ein Wuerfel in ASCII-STL (sechs Normalen, damit
 *  mehr als eine Flaechenhelligkeit im Bild landet und der Pruefpunkt nicht an seiner
 *  eigenen Schwelle wackelt). Der Treiber
 *  bringt sonst keine Testdaten mit — hier lohnt die Ausnahme, weil der STL-Punkt sonst
 *  in jedem Vault ohne STL dauerhaft uebersprungen wird und die Lade-/Material-Kette
 *  fuer dieses Format nie jemand faehrt. Eine echte STL aus dem Vault hat Vorrang. */
const SMOKE_MODEL_STL = "_tdcb-smoke-model.stl";
const FALLBACK_STL = [
  "solid tdcb",
  "facet normal 0 0 -1",
  " outer loop",
  "  vertex 0 0 0",
  "  vertex 0 10 0",
  "  vertex 10 10 0",
  " endloop",
  "endfacet",
  "facet normal 0 0 -1",
  " outer loop",
  "  vertex 0 0 0",
  "  vertex 10 10 0",
  "  vertex 10 0 0",
  " endloop",
  "endfacet",
  "facet normal 0 0 1",
  " outer loop",
  "  vertex 0 0 10",
  "  vertex 10 0 10",
  "  vertex 10 10 10",
  " endloop",
  "endfacet",
  "facet normal 0 0 1",
  " outer loop",
  "  vertex 0 0 10",
  "  vertex 10 10 10",
  "  vertex 0 10 10",
  " endloop",
  "endfacet",
  "facet normal 0 -1 0",
  " outer loop",
  "  vertex 0 0 0",
  "  vertex 10 0 0",
  "  vertex 10 0 10",
  " endloop",
  "endfacet",
  "facet normal 0 -1 0",
  " outer loop",
  "  vertex 0 0 0",
  "  vertex 10 0 10",
  "  vertex 0 0 10",
  " endloop",
  "endfacet",
  "facet normal 0 1 0",
  " outer loop",
  "  vertex 0 10 0",
  "  vertex 0 10 10",
  "  vertex 10 10 10",
  " endloop",
  "endfacet",
  "facet normal 0 1 0",
  " outer loop",
  "  vertex 0 10 0",
  "  vertex 10 10 10",
  "  vertex 10 10 0",
  " endloop",
  "endfacet",
  "facet normal -1 0 0",
  " outer loop",
  "  vertex 0 0 0",
  "  vertex 0 0 10",
  "  vertex 0 10 10",
  " endloop",
  "endfacet",
  "facet normal -1 0 0",
  " outer loop",
  "  vertex 0 0 0",
  "  vertex 0 10 10",
  "  vertex 0 10 0",
  " endloop",
  "endfacet",
  "facet normal 1 0 0",
  " outer loop",
  "  vertex 10 0 0",
  "  vertex 10 10 0",
  "  vertex 10 10 10",
  " endloop",
  "endfacet",
  "facet normal 1 0 0",
  " outer loop",
  "  vertex 10 0 0",
  "  vertex 10 10 10",
  "  vertex 10 0 10",
  " endloop",
  "endfacet",
  "endsolid tdcb",
  "",
].join("\n");
/** Kopie des Prüfmodells (Endung kommt vom Original). Der Basis-Abschnitt ändert die
 *  Datei — an einem echten Vault-Artefakt darf er das nicht. */
const SMOKE_MODEL_BASE = "_tdcb-smoke-model";
/** Existierende Datei mit nicht unterstützter Endung: ohne sie meldet der Prüfling
 *  "File not found" statt "Unsupported format" und der Prüfpunkt misst den falschen Fall. */
const SMOKE_WRONG_EXT = "_tdcb-smoke-model.obj";




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

/** Wie `openNote` aus der Bruecke — merkt sich die Notiz zusaetzlich fuers Aufraeumen. */
async function openNote(
  cdp: Cdp,
  path: string,
  body: string,
  mode: "preview" | "source",
): Promise<void> {
  createdNotes.add(path);
  await openNoteViaBridge(cdp, path, body, mode);
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
      // Die Meldung des Prueflings MITLIEFERN, nicht nur ihr Fehlen beschreiben.
      // Anlass 2026-08-30: der Dach-Lauf meldete "0 Standbild(er) · Controller keiner"
      // und loeste damit eine ganze Session Ursachensuche aus — waehrend einen
      // DOM-Knoten weiter "Invalid or corrupted file" stand und die Antwort schon
      // dahatte. Ein Befund, der nur sagt DASS etwas nicht ging, blockiert die
      // Fehlersuche aktiv (LESSONS 2026-08-29, calendar-notes).
      "Meldung " + (() => {
        const text = root.querySelector(".tdcb-message")?.textContent?.trim();
        return text ? JSON.stringify(text) : "keine";
      })(),
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

/** Zwei Ansichten als "praktisch dieselbe" vergleichen. 1.5° statt 0: eine `view:`-Zeile
 *  trägt ganze Grad, der Rückweg über die Kamera rundet erneut — eine Abweichung von
 *  einem Grad ist erwartbar. Dass sie sich nicht aufschaukelt, ist eine eigene Frage
 *  (Prüfpunkt V3b). */
function near(a: ViewValues | null, b: unknown): boolean {
  const left = a;
  const right = b as ViewValues | null;
  if (!left || !right) return false;
  return (
    Math.abs(left.azimuth - right.azimuth) <= 1.5 &&
    Math.abs(left.elevation - right.elevation) <= 1.5 &&
    Math.abs(left.distance - right.distance) < 0.05
  );
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

/** Ein WebGL-Canvas (oder ein `<img>`) auf Farbinhalt abtasten — als Renderer-Schnipsel
 *  zum Einspleissen. Beantwortet zwei Fragen, die man am DOM allein nicht stellen kann:
 *  "ist ueberhaupt etwas gezeichnet" (mehr als eine Farbe) und "welcher Grundton"
 *  (Hintergrund, also Theme). Die Kanaele werden auf 5 Bit quantisiert, sonst zaehlt
 *  Kantenglaettung jede Nuance als eigene Farbe und `colors` saettigt immer.
 *  `preserveDrawingBuffer: true` in `viewer/viewport.ts` ist die Voraussetzung dafuer,
 *  dass `drawImage` von einem WebGL-Canvas ueberhaupt etwas liefert. */
const SAMPLER = `
  const sample = (source) => {
    if (!source) return null;
    const off = document.createElement("canvas");
    off.width = 32;
    off.height = 24;
    const ctx = off.getContext("2d");
    try {
      ctx.drawImage(source, 0, 0, off.width, off.height);
    } catch (e) {
      return null;
    }
    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    const seen = new Set();
    // Wie viel Flaeche nimmt etwas anderes als der Hintergrund ein? Die Farbzahl allein
    // ist bei einfachen Koerpern knapp (ein Wuerfel kommt auf drei Toene und sitzt damit
    // genau auf der Schwelle) — der Deckungsgrad hat Reserve und sagt zugleich mehr:
    // "das Modell ist zu sehen", nicht nur "irgendetwas ist bunt".
    const counts = new Map();
    let r = 0, g = 0, b = 0;
    // FNV-1a über die quantisierten Pixel: beantwortet "hat sich das Bild geändert",
    // wo Mittelwert und Farbzahl gleich bleiben können (eine Verschiebung etwa).
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      const quantised = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      seen.add(quantised);
      counts.set(quantised, (counts.get(quantised) ?? 0) + 1);
      hash = Math.imul(hash ^ quantised, 16777619);
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = data.length / 4;
    const background = Math.max(...counts.values());
    return {
      colors: seen.size,
      coverage: Math.round(((n - background) / n) * 100),
      avg: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
      hash: hash >>> 0,
    };
  };
`;

/** Warten, bis die Kamera zur Ruhe gekommen ist — als Renderer-Schnipsel, der
 *  `settleView(controller)` bereitstellt.
 *
 *  OrbitControls laeuft mit `enableDamping`: nach einem Drag zieht es die Kamera noch
 *  ueber mehrere Frames nach, und ein Ruecksetzen mitten in dieser Nachbewegung ist
 *  erst ein paar Frames spaeter am Ziel. Wer stattdessen eine feste Frist abwartet,
 *  misst je nach Laune einen Zwischenstand: gemessen 2026-08-14 meldete der
 *  Ruecksetz-Punkt der Datei-Ansicht 38°/32° statt 45°/30° — kein Defekt, nur zu frueh
 *  hingesehen. Drei gleiche Messungen in Folge, dann steht sie. */
const SETTLE_VIEW = `
  const settleView = async (controller, timeoutMs = 6000) => {
    let last = null;
    let stable = 0;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const now = JSON.stringify(controller.getView());
      stable = now === last ? stable + 1 : 0;
      last = now;
      if (stable >= 2) break;
    }
    return controller.getView();
  };
`;

/** Durch eine Notiz mit mehreren Bloecken scrollen und dabei einsammeln, was gezeichnet
 *  hat — als Renderer-Schnipsel; er gibt `{ drawn, titles, live, frozen, images }` zurueck
 *  und setzt `sample` aus `SAMPLER` voraus.
 *
 *  Warum ueberhaupt scrollen: Obsidians Lesemodus baut nur den sichtbaren Ausschnitt auf.
 *  Bei fuenf Bloecken à 400px stehen drei davon nie im DOM, wenn niemand scrollt — ein
 *  Pruefpunkt, der einfach zaehlt, misst dann zwei statt fuenf und liest sich wie ein
 *  Ladefehler des Plugins (gemessen 2026-08-14). Deshalb sammelt der Sweep pro Block,
 *  OB er einmal gezeichnet hat, statt am Ende einen Endzustand zu zaehlen: was
 *  weitergescrollt wurde, raeumt Obsidian wieder ab.
 *
 *  Gezaehlt wird ausschliesslich im Lesemodus-Container. Ein Markdown-Blatt haelt den
 *  Quelltext-Container daneben weiter im DOM (mit denselben Bloecken, ohne Canvas) —
 *  `document.querySelectorAll` sieht die Notiz sonst doppelt. */
const SCROLL_SWEEP = `
  const preview = document.querySelector(".markdown-preview-view");
  if (!preview) return { drawn: [], titles: [], live: 0, frozen: 0, images: 0 };
  const drawn = new Set();
  const titles = new Set();
  for (let step = 0; step <= 14; step++) {
    preview.scrollTop = step * 260;
    await new Promise((r) => setTimeout(r, 700));
    for (const block of preview.querySelectorAll(".tdcb-block")) {
      const title = (block.querySelector(".tdcb-title")?.textContent ?? "").trim();
      if (!title) continue;
      titles.add(title);
      const canvas = block.querySelector("canvas");
      const stats = canvas ? sample(canvas) : null;
      if (stats && stats.colors >= 3) drawn.add(title);
    }
    if (preview.scrollTop + preview.clientHeight >= preview.scrollHeight - 4) break;
  }
  return {
    drawn: [...drawn],
    titles: [...titles],
    live: preview.querySelectorAll(".tdcb-block canvas").length,
    frozen: preview.querySelectorAll(".tdcb-play").length,
    images: preview.querySelectorAll("img.tdcb-poster").length,
  };
`;

/** Echter Maus-Drag auf einem Canvas, als Renderer-Ausdruck (`null` = geklappt, sonst
 *  die Fehlerursache als Text). Bewusst ueber Pointer-Events statt ueber `applyView`:
 *  das misst die Naht OrbitControls → `cameraToView`, die kein Unit-Test hat.
 *  `pointerId`/`isPrimary` sind Pflicht — ohne sie schlaegt `setPointerCapture` fehl,
 *  OrbitControls' Handler bricht ab und der Pruefpunkt wird rot, ohne dass am Plugin
 *  etwas fehlt. `button`/`buttons` waehlen die Taste: 0/1 = links (Orbit),
 *  2/2 = rechts (Pan). */
const dragCanvas = (canvasExpr: string, dx: number, dy: number, button = 0): string => `
  await (async () => {
    const canvas = ${canvasExpr};
    if (!canvas) return "kein Canvas gefunden";
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return "Canvas hat keine Flaeche";
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const opts = (x, y) => ({
      clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      button: ${button}, buttons: ${button === 2 ? 2 : 1},
    });
    try {
      canvas.dispatchEvent(new PointerEvent("pointerdown", opts(cx, cy)));
      for (let step = 1; step <= 6; step++) {
        canvas.dispatchEvent(new PointerEvent("pointermove", opts(cx + step * ${Math.round(dx / 6)}, cy + step * ${Math.round(dy / 6)})));
        await new Promise((r) => setTimeout(r, 16));
      }
      canvas.dispatchEvent(new PointerEvent("pointerup", opts(cx + ${dx}, cy + ${dy})));
    } catch (e) {
      return String(e && e.message ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 250));
    return null;
  })()
`;

/** Die Notiz im Live Preview neu aufbauen. Zwei Fallen in einem Helfer:
 *  Im Legacy-Quelltextmodus (`livePreview: false`) rendert Obsidian den Codeblock gar
 *  nicht — die Sidebar zeigt dann noch den Controller aus dem Lesemodus, `canSave()`
 *  meldet `true`, und ein Write laeuft still ins Leere, weil sein Block im DOM nicht
 *  mehr existiert. Das liest sich wie ein Schreibfehler im Plugin und ist keiner.
 *  Und: eine bereits offene Markdown-View uebernimmt den Wechsel Legacy → Live Preview
 *  nicht im laufenden Betrieb, sie muss neu aufgebaut werden. Beides gemessen
 *  2026-08-14 im outpost-Vault (steht auf `livePreview: false`).
 *  Den Vorwert schreibt der Aufrufer zurueck — es ist eine Einstellung des Wirts. */
async function openInLivePreview(cdp: Cdp, path: string): Promise<void> {
  await cdp.evaluate(`
    app.vault.setConfig("livePreview", true);
    await new Promise((r) => setTimeout(r, 300));
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    const current = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
    if (current) current.detach();
    await new Promise((r) => setTimeout(r, 400));
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file, { state: { mode: "source" } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  `);
}



/** Eine Einstellung des Pruefling-Plugins zur Laufzeit setzen. Der Vorwert wird nicht
 *  hier gemerkt, sondern in `main` als Gesamt-Schnappschuss zurueckgeschrieben — sonst
 *  haengt die Wiederherstellung daran, dass jeder Abschnitt sauber zu Ende laeuft. */
const setSetting = (cdp: Cdp, key: string, value: unknown): Promise<void> =>
  setPluginSetting(cdp, PLUGIN_ID, key, value);

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
    const error = ${dragCanvas(`document.querySelector(".tdcb-active canvas")`, 108, 30)};
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
  await openInLivePreview(cdp, SMOKE_NOTE_VIEW);
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

// --- Abschnitt: Basis-Checkliste (docs/SMOKE.md, Punkte 1-10 + "Zusätzlich") ------

/** Eine eigene Kopie des Modells anlegen. Zwei Gründe: der Abschnitt ändert die Datei
 *  (Punkt "Regenerierung") und darf das an einem echten Vault-Artefakt nicht tun; und
 *  ein Modell, das dem Lauf gehört, wird am Ende mit allem anderen abgeräumt.
 *  `readBinary`/`createBinary` statt `read`/`create`, damit auch `.glb` durchgeht. */
async function copyProbeModel(cdp: Cdp, model: string): Promise<string> {
  const extension = model.slice(model.lastIndexOf("."));
  const copy = `${SMOKE_MODEL_BASE}${extension}`;
  createdNotes.add(copy);
  await cdp.evaluate(`
    const source = app.vault.getAbstractFileByPath(${JSON.stringify(model)});
    const bytes = await app.vault.readBinary(source);
    const existing = app.vault.getAbstractFileByPath(${JSON.stringify(copy)});
    if (existing) await app.vault.modifyBinary(existing, bytes);
    else await app.vault.createBinary(${JSON.stringify(copy)}, bytes);
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `);
  return copy;
}

async function sectionBasics(cdp: Cdp, model: string): Promise<void> {
  // Der Grundfall ist der Standardmodus: der Block rendert ohne Zutun. Den Vorwert
  // schreibt `main` aus seinem Schnappschuss zurück, nicht dieser Abschnitt — sonst
  // hinge die Wiederherstellung daran, dass er sauber zu Ende läuft.
  await setSetting(cdp, "viewMode", "immediate");
  await setSetting(cdp, "maxContexts", 6);
  // Die Selbstdrehung MUSS aus. Sie ist kein Prüfgegenstand, aber sie bewegt die Kamera
  // dauernd von allein — mit ihr wird "Drehen bewegt die Kamera" grün, ohne dass die
  // Maus etwas bewirkt hätte, und "Doppelklick setzt zurück" rot, obwohl er es tut.
  // Gemessen 2026-08-14: im outpost-Vault steht `autoRotate` auf `true`, der erste Lauf
  // meldete deshalb einen Rücksetz-Fehler, den es nicht gibt (37° → 26° reine Drift).
  await setSetting(cdp, "autoRotate", false);
  await closeExtraLeaves(cdp);
  const probe = await copyProbeModel(cdp, model);

  const noteBody = [
    "# GUI-Smoke Basis (automatisch erzeugt, wird nach dem Lauf gelöscht)",
    "",
    `${fence}3d`,
    `file: ${probe}`,
    `title: ${BASIS_BLOCK_TITLE}`,
    fence,
    "",
  ].join("\n");
  await openNote(cdp, SMOKE_NOTE_BASIS, noteBody, "preview");
  await cdp.evaluate(
    `await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)}); return true;`,
  );

  // --- B1. Grundfall: der Block zeigt wirklich ein Modell ------------------
  // Gemessen wird nicht "ein Canvas hängt im DOM", sondern dass darauf mehr als eine
  // Farbe steht. Ein Canvas entsteht auch dann, wenn das Laden scheitert oder der
  // Kontext verloren geht — der Prüfpunkt wäre grün und der Block schwarz.
  const rendered = await cdp.evaluate<{ colors: number; width: number } | null>(`
    ${SAMPLER}
    ${waitFor(
      `
      const canvas = document.querySelector(".tdcb-block canvas");
      if (!canvas || canvas.clientWidth === 0) return 0;
      const stats = sample(canvas);
      if (!stats || stats.colors < 3) return 0;
      return { colors: stats.colors, width: canvas.clientWidth };
    `,
      20_000,
    )}
  `);
  record(
    "B1. Der Block rendert ein sichtbares Modell (nicht nur ein Canvas)",
    rendered !== null,
    rendered ? `${rendered.colors} Farbtöne · ${rendered.width}px breit` : await describeScene(cdp),
  );
  if (!rendered) {
    skipped("B2-B12", "ohne gerendertes Modell ist keiner der Folgepunkte aussagekräftig");
    return;
  }

  // --- B2. Orbit ----------------------------------------------------------
  // Erst ein Klick OHNE Bewegung: er weckt den Controller (die Sidebar bedient das
  // zuletzt berührte Modell), verdreht die Kamera aber noch nicht — nur so gibt es
  // einen Vorher-Wert, gegen den sich der Drag messen lässt.
  const orbit = await cdp.evaluate<{
    before: ViewValues | null;
    after: ViewValues | null;
    error: string | null;
  }>(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const wake = ${dragCanvas(`document.querySelector(".tdcb-block canvas")`, 0, 0)};
    const controller = plugin.active.get();
    if (!controller) return { before: null, after: null, error: wake ?? "Klick weckte keinen Controller" };
    const before = controller.getView();
    const error = ${dragCanvas(`document.querySelector(".tdcb-block canvas")`, 120, 36)};
    return { before, after: controller.getView(), error };
  `);
  record(
    "B2. Orbit per echter Maus dreht die Kamera",
    orbit.error === null &&
      orbit.before !== null &&
      JSON.stringify(orbit.before) !== JSON.stringify(orbit.after),
    orbit.error ?? `${JSON.stringify(orbit.before)} → ${JSON.stringify(orbit.after)}`,
  );

  // --- B3. Zoom -----------------------------------------------------------
  // Das Rad geht an OrbitControls' eigenen `wheel`-Handler; `deltaY < 0` ist
  // Heranzoomen. Geprüft wird die Änderung, nicht die Richtung: die Richtung ist
  // OrbitControls-Konvention und nicht das, was dieses Plugin zusagt.
  const zoom = await cdp.evaluate<{
    before: ViewValues | null;
    after: ViewValues | null;
    error: string | null;
  }>(`
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    const canvas = document.querySelector(".tdcb-block canvas");
    if (!controller || !canvas) return { before: null, after: null, error: "kein Controller/Canvas" };
    const before = controller.getView();
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -300, bubbles: true, cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }));
    await new Promise((r) => setTimeout(r, 500));
    return { before, after: controller.getView(), error: null };
  `);
  record(
    "B3. Das Mausrad ändert die Distanz",
    zoom.error === null &&
      zoom.before !== null &&
      zoom.after !== null &&
      Math.abs(zoom.before.distance - zoom.after.distance) > 0.01,
    zoom.error ?? `Distanz ${zoom.before?.distance} → ${zoom.after?.distance}`,
  );

  // --- B4. Pan ------------------------------------------------------------
  // Pan verschiebt den Blickpunkt, nicht die Bahn — es steht deshalb bewusst NICHT in
  // `ViewSpec` (orbit-relativ, s. `core/view-spec.ts`). Am Controller ist die Wirkung
  // also nicht sichtbar; gemessen wird sie am Bild. Dass die drei Winkel dabei
  // unverändert bleiben, ist die zweite Hälfte der Aussage und steht im Detail.
  const pan = await cdp.evaluate<{
    changed: boolean;
    view: string;
    error: string | null;
  }>(`
    ${SAMPLER}
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    const canvas = document.querySelector(".tdcb-block canvas");
    if (!controller || !canvas) return { changed: false, view: "", error: "kein Controller/Canvas" };
    const beforeView = JSON.stringify(controller.getView());
    const before = sample(canvas);
    const error = ${dragCanvas(`document.querySelector(".tdcb-block canvas")`, 96, 0, 2)};
    const after = sample(canvas);
    if (!before || !after) return { changed: false, view: "", error: error ?? "Canvas nicht lesbar" };
    const afterView = JSON.stringify(controller.getView());
    return {
      changed: before.hash !== after.hash,
      view: beforeView === afterView ? "Winkel unverändert (erwartet)" : beforeView + " → " + afterView,
      error,
    };
  `);
  record(
    "B4. Pan (rechte Maustaste) verschiebt das Bild",
    pan.error === null && pan.changed,
    pan.error ?? `${pan.changed ? "Bild verändert" : "Bild identisch"} · ${pan.view}`,
  );

  // --- B5. Doppelklick setzt zurück ---------------------------------------
  // Nach B2-B4 steht die Kamera irgendwo. Der Rückweg zielt auf den Zustand aus B2,
  // also auf die eingepasste Ansicht — nicht auf einen festen Winkel: welche Ansicht
  // "eingepasst" heißt, hängt am Modell und ist nichts, was der Smoke behaupten darf.
  const reset = await cdp.evaluate<{ after: ViewValues | null; error: string | null }>(`
    ${SETTLE_VIEW}
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    const canvas = document.querySelector(".tdcb-block canvas");
    if (!controller || !canvas) return { after: null, error: "kein Controller/Canvas" };
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }));
    return { after: await settleView(controller), error: null };
  `);
  record(
    "B5. Doppelklick setzt die Ansicht auf den Einpass-Zustand zurück",
    reset.error === null && near(orbit.before, reset.after),
    reset.error ?? `${JSON.stringify(orbit.before)} (Start) → ${JSON.stringify(reset.after)}`,
  );

  // --- B6. Layout: die Notiz im Split ------------------------------------
  // Nicht das CSS anfassen, sondern die Pane wirklich teilen: der `ResizeObserver` in
  // `viewer-host.ts` hängt am Container, und nur ein echter Layout-Wechsel beweist,
  // dass er greift. Geprüft wird der RENDERER-Puffer (`canvas.width`), nicht die
  // CSS-Breite — die folgt auch dann, wenn three das Bild bloß verzerrt hochskaliert.
  const layout = await cdp.evaluate<{
    beforeCss: number;
    beforeBuffer: number;
    afterCss: number;
    afterBuffer: number;
  }>(`
    const canvas = document.querySelector(".tdcb-block canvas");
    const beforeCss = canvas.clientWidth;
    const beforeBuffer = canvas.width;
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_BASIS)});
    const split = app.workspace.getLeaf("split");
    await split.openFile(file, { state: { mode: "preview" } });
    // Gewartet wird auf BEIDE Groessen, nicht nur auf die CSS-Breite: der
    // ResizeObserver schreibt den Renderer-Puffer erst im Frame nach dem
    // Layout-Wechsel. Wer nur auf clientWidth wartet und sofort danach canvas.width
    // liest, erwischt den Puffer manchmal noch alt und macht den Punkt sporadisch
    // rot, obwohl das Plugin richtig arbeitet. Gemessen am 2026-08-19 in der
    // Gegenprobe zu B13-B15: CSS 698 auf 362px, Puffer 1396 auf 1396px — im selben
    // Lauf, in dem der eingebaute Defekt gar nichts mit Layout zu tun hatte.
    // Bleibt der Puffer wirklich stehen, laeuft das Warten in seine Frist und der
    // Punkt wird rot — nur eben langsam statt falsch.
    await (async () => {
      ${waitFor(
        "return (canvas.clientWidth < beforeCss && canvas.width < beforeBuffer) ? 1 : 0;",
      )}
    })();
    const afterCss = canvas.clientWidth;
    const afterBuffer = canvas.width;
    split.detach();
    await new Promise((r) => setTimeout(r, 800));
    return { beforeCss, beforeBuffer, afterCss, afterBuffer };
  `);
  record(
    "B6. Im Split schrumpft der Viewport mit — auch der Renderer-Puffer",
    layout.afterCss < layout.beforeCss && layout.afterBuffer < layout.beforeBuffer,
    `CSS ${layout.beforeCss}→${layout.afterCss}px · Puffer ${layout.beforeBuffer}→${layout.afterBuffer}px`,
  );

  // --- B7. Theme ----------------------------------------------------------
  // Über die Body-Klassen, NICHT über `app.changeTheme`: der API-Aufruf schreibt nach
  // `.obsidian/appearance.json` und macht aus einem system-folgenden Vault einen fest
  // eingestellten (s. Abschnitt "aktiver Block", Punkt 8). Der Klassentausch allein
  // genügt hier aber nicht: die Szenenfarbe wird nicht per CSS gesetzt, sondern in
  // `main.ts` beim `css-change`-Ereignis neu aus den Variablen gelesen — ohne das
  // `trigger` bliebe der WebGL-Hintergrund stehen und der Punkt wäre falsch-rot.
  const theme = await cdp.evaluate<{
    dark: [number, number, number] | null;
    light: [number, number, number] | null;
  }>(`
    ${SAMPLER}
    const canvas = document.querySelector(".tdcb-block canvas");
    const body = document.body;
    const wasDark = body.classList.contains("theme-dark");
    const apply = async (dark) => {
      body.classList.toggle("theme-dark", dark);
      body.classList.toggle("theme-light", !dark);
      app.workspace.trigger("css-change");
      await new Promise((r) => setTimeout(r, 900));
      const stats = sample(canvas);
      return stats ? stats.avg : null;
    };
    const dark = await apply(true);
    const light = await apply(false);
    await apply(wasDark);
    return { dark, light };
  `);
  const themeDistance =
    theme.dark && theme.light
      ? theme.dark.reduce((sum, value, index) => sum + Math.abs(value - (theme.light as number[])[index]), 0)
      : 0;
  record(
    "B7. Der Viewport folgt dem Theme (hell ≠ dunkel)",
    themeDistance > 30,
    `dunkel rgb(${theme.dark?.join(",") ?? "?"}) · hell rgb(${theme.light?.join(",") ?? "?"}) · Abstand ${themeDistance}`,
  );

  // --- B8. Regenerierung --------------------------------------------------
  // Der Loop-Fall, für den dieses Plugin entstanden ist: ein Skript erzeugt die Datei
  // neu, während die Notiz offen ist. Geändert wird die KOPIE, nicht das Original —
  // und geprüft wird das Bild, nicht der Dateiinhalt: dass die Datei anders ist, weiß
  // der Smoke ohnehin, die Frage ist, ob der Viewport das mitbekommt.
  if (!probe.endsWith(".gltf")) {
    skipped("B8. Regenerierung", `Prüfmodell ist ${probe} — die Änderung braucht Text-glTF`);
  } else {
    const regenerated = await cdp.evaluate<{ before: number | null; after: number | null; moved: string }>(`
      ${SAMPLER}
      const canvasNow = () => document.querySelector(".tdcb-block canvas");
      const before = sample(canvasNow());
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(probe)});
      const doc = JSON.parse(await app.vault.read(file));
      // Einen Knoten weit genug verschieben, dass das Bild sich sicher ändert. Welcher
      // ist gleichgültig — der Punkt misst die Reaktion, nicht die Geometrie.
      const node = (doc.nodes ?? [])[0];
      if (!node) return { before: before ? before.hash : null, after: null, moved: "kein Knoten in der Datei" };
      node.translation = [(node.translation?.[0] ?? 0) + 25, (node.translation?.[1] ?? 0) + 15, node.translation?.[2] ?? 0];
      await app.vault.modify(file, JSON.stringify(doc));
      const after = await (async () => {
        ${waitFor(`
          const stats = sample(canvasNow());
          return stats && before && stats.hash !== before.hash ? stats.hash : 0;
        `, 12_000)}
      })();
      return { before: before ? before.hash : null, after, moved: node.name ?? "(namenlos)" };
    `);
    record(
      "B8. Eine extern neu erzeugte Datei erneuert die Ansicht ohne Neustart",
      regenerated.before !== null && regenerated.after !== null,
      regenerated.before === null
        ? "Ausgangsbild nicht lesbar"
        : regenerated.after === null
          ? `Bild blieb unverändert, nachdem "${regenerated.moved}" verschoben wurde`
          : `"${regenerated.moved}" verschoben → Bild neu`,
    );
  }

  // --- B9. Kein Leck beim Tippen im Block ---------------------------------
  // Der teuerste Fehler dieser Plugin-Gattung: Obsidian baut den Codeblock bei jedem
  // Tastendruck neu auf, und jede nicht freigegebene Szene hält einen WebGL-Kontext.
  // Nach ein paar Minuten Tippen ist das Kontext-Limit des Browsers erreicht und
  // fremde Plugins gehen mit unter. Getippt wird im ECHTEN Editor-Puffer (nicht per
  // `vault.modify`), weil nur der den Live-Preview-Neuaufbau auslöst, um den es geht.
  const previousLivePreview = await cdp.evaluate<boolean>(
    `return app.vault.getConfig("livePreview") === true;`,
  );
  await openInLivePreview(cdp, SMOKE_NOTE_BASIS);
  const leak = await cdp.evaluate<{ before: number; after: number; blocks: number; typed: number }>(`
    const count = () => document.querySelectorAll("canvas").length;
    const editor = app.workspace.activeEditor?.editor;
    if (!editor) return { before: 0, after: 0, blocks: 0, typed: 0 };
    await (async () => {
      ${waitFor(`return document.querySelectorAll(".tdcb-block canvas").length > 0 ? 1 : 0;`, 15_000)}
    })();
    const before = count();
    let typed = 0;
    for (let round = 0; round < 8; round++) {
      const lines = editor.getValue().split("\\n");
      const index = lines.findIndex((l) => l.startsWith("title:"));
      if (index === -1) break;
      editor.replaceRange("x", { line: index, ch: lines[index].length });
      typed++;
      await new Promise((r) => setTimeout(r, 300));
    }
    // Dem Aufräumen Zeit lassen: die Freigabe hängt an Obsidians Unload-Zyklus, ein
    // sofortiger Zähler misst den Übergangszustand und wäre zufällig rot.
    await new Promise((r) => setTimeout(r, 2500));
    return { before, after: count(), blocks: document.querySelectorAll(".tdcb-block").length, typed };
  `);
  record(
    "B9. Achtmal im Block getippt hinterlässt keine verwaisten Canvas",
    leak.typed === 8 && leak.blocks === 1 && leak.after <= leak.before,
    `${leak.typed} Änderungen · ${leak.before} → ${leak.after} Canvas im Dokument · ${leak.blocks} Block`,
  );
  await cdp.evaluate(
    `app.vault.setConfig("livePreview", ${JSON.stringify(previousLivePreview)}); return true;`,
  );

  // --- B10. Fünf Blöcke in einer Notiz ------------------------------------
  const manyBody = [
    "# GUI-Smoke fünf Blöcke (automatisch erzeugt)",
    "",
    ...[1, 2, 3, 4, 5].flatMap((n) => [`${fence}3d`, `file: ${probe}`, `title: Etage ${n}`, fence, ""]),
  ].join("\n");
  await closeExtraLeaves(cdp);
  await openNote(cdp, SMOKE_NOTE_MANY, manyBody, "preview");
  await pollUntil(
    cdp,
    `return document.querySelector(".markdown-preview-view .tdcb-block canvas") ? 1 : 0;`,
    40_000,
  );
  const many = await cdp.evaluate<{ drawn: string[]; titles: string[] }>(`
    ${SAMPLER}
    ${SCROLL_SWEEP}
  `);
  record(
    "B10. Beim Durchscrollen zeigen alle fünf Blöcke ein Modell",
    many.drawn.length === 5 && many.titles.length === 5,
    `${many.drawn.length}/${many.titles.length} gezeichnet — nicht gezeichnet: ${many.titles.filter((t) => !many.drawn.includes(t)).join(", ") || "keiner"}`,
  );

  // --- B11. Kontext-Budget ------------------------------------------------
  // "Maximum live 3D views" auf 2: der Rest muss zum Standbild werden, nicht schwarz.
  // Die Grenze wirkt beim Aufbau, nicht rückwirkend — deshalb erst umstellen, dann die
  // Notiz neu aufbauen. Ohne den Neuaufbau bliebe alles live und der Punkt grün, ohne
  // dass die Einstellung je gegriffen hätte.
  await setSetting(cdp, "maxContexts", 2);
  await reopenNote(cdp, SMOKE_NOTE_MANY, "preview");
  await pollUntil(
    cdp,
    `return document.querySelector(".markdown-preview-view .tdcb-block canvas") ? 1 : 0;`,
    40_000,
  );
  const budget = await cdp.evaluate<{
    drawn: string[];
    titles: string[];
    live: number;
    frozen: number;
    images: number;
  }>(`
    ${SAMPLER}
    ${SCROLL_SWEEP}
  `);
  record(
    "B11. 'Maximum live 3D views' = 2 hält nur zwei Ansichten live",
    budget.titles.length === 5 && budget.live <= 2 && budget.frozen >= 1,
    `${budget.live} live · ${budget.frozen} eingefroren (${budget.images} mit Standbild) · ${budget.titles.length} Blöcke gesehen`,
  );

  // --- B12. Poster-Qualität -----------------------------------------------
  // Das eingefrorene Bild muss das Modell zeigen. Ist es leer, war der Zeichenpuffer
  // beim `toDataURL` schon geleert (`preserveDrawingBuffer` in `viewer/viewport.ts`) —
  // ein Fehler, den man am DOM nicht sieht, weil das `<img>` ordentlich dahängt.
  const poster = await cdp.evaluate<{ found: number; drawn: number; sample: number | null }>(`
    ${SAMPLER}
    const images = [...document.querySelectorAll(".markdown-preview-view img.tdcb-poster")];
    const stats = images.map((img) => (img.complete && img.naturalWidth > 0 ? sample(img) : null));
    const usable = stats.filter((s) => s && s.colors >= 3);
    return { found: images.length, drawn: usable.length, sample: usable[0] ? usable[0].colors : null };
  `);
  record(
    "B12. Das Standbild zeigt das Modell, nicht eine leere Fläche",
    poster.found > 0 && poster.drawn > 0,
    poster.found === 0
      ? "kein Standbild da — nicht prüfbar"
      : `${poster.drawn}/${poster.found} Standbilder mit Bildinhalt (${poster.sample ?? 0} Farbtöne)`,
  );
  await setSetting(cdp, "maxContexts", 6);

  // --- B13-B15. Fehlerfälle -----------------------------------------------
  // Alle drei in einer Notiz: die Meldungen hängen am Block, nicht am Zustand des
  // Plugins, und ein gemeinsamer Aufbau spart drei Ladezyklen.
  createdNotes.add(SMOKE_WRONG_EXT);
  await cdp.evaluate(`
    const path = ${JSON.stringify(SMOKE_WRONG_EXT)};
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.create(path, "# nicht wirklich ein Modell");
    return true;
  `);
  const errorBody = [
    "# GUI-Smoke Fehlerfälle (automatisch erzeugt)",
    "",
    `${fence}3d`,
    "file: _tdcb-gibt-es-nicht.glb",
    "title: Fehlt",
    fence,
    "",
    `${fence}3d`,
    `file: ${SMOKE_WRONG_EXT}`,
    "title: Endung",
    fence,
    "",
    `${fence}3d`,
    `file: ${probe}`,
    "title: Tippfehler",
    "heigth: 400",
    fence,
    "",
  ].join("\n");
  await closeExtraLeaves(cdp);
  await openNote(cdp, SMOKE_NOTE_ERRORS, errorBody, "preview");
  await pollUntil(
    cdp,
    `
      const block = [...document.querySelectorAll(".tdcb-block")].find(
        (b) => b.querySelector(".tdcb-title")?.textContent.trim() === "Tippfehler",
      );
      return block && block.querySelector("canvas") ? 1 : 0;
    `,
    40_000,
  );
  const errors = await cdp.evaluate<{ missing: string; format: string; hint: string; canvas: number }>(`
    const byTitle = (title) =>
      [...document.querySelectorAll(".tdcb-block")].find(
        (b) => b.querySelector(".tdcb-title")?.textContent.trim() === title,
      );

    const messageIn = (title) => {
      const block = byTitle(title);
      if (!block) return "(Block fehlt)";
      const box = block.querySelector(".tdcb-message-error, .tdcb-message");
      return box ? box.textContent.trim() : "(keine Meldung)";
    };
    const typo = byTitle("Tippfehler");
    const hint = typo?.querySelector(".tdcb-hint");
    return {
      missing: messageIn("Fehlt"),
      format: messageIn("Endung"),
      hint: hint ? hint.textContent.trim() : "(kein Hinweis)",
      canvas: typo ? typo.querySelectorAll("canvas").length : 0,
    };
  `);
  record(
    "B13. Fehlende Datei nennt den Pfad",
    errors.missing.includes("File not found") && errors.missing.includes("_tdcb-gibt-es-nicht.glb"),
    errors.missing.slice(0, 80),
  );
  record(
    "B14. Falsche Endung nennt die unterstützten Formate",
    errors.format.includes("Unsupported format") && errors.format.includes("glb"),
    errors.format.slice(0, 80),
  );
  record(
    "B15. Ein Tippfehler im Schlüssel meldet sich, versteckt aber das Modell nicht",
    errors.hint.toLowerCase().includes("heigth") && errors.canvas > 0,
    `${errors.hint.slice(0, 60)} · ${errors.canvas} Canvas im selben Block`,
  );

  // --- B16. STL -----------------------------------------------------------
  // Eine echte STL aus dem Vault hat Vorrang; gibt es keine, legt der Lauf seine eigene
  // an, statt den Punkt zu überspringen — sonst fährt die STL-Kette in einem Vault ohne
  // STL nie jemand, und "übersprungen" liest sich nach dem dritten Mal wie "abgedeckt".
  const stl = await cdp.evaluate<string>(`
    const existing = app.vault.getFiles().find((f) => /\\.stl$/i.test(f.path));
    if (existing) return existing.path;
    const path = ${JSON.stringify(SMOKE_MODEL_STL)};
    const current = app.vault.getAbstractFileByPath(path);
    const body = ${JSON.stringify(FALLBACK_STL)};
    if (current) await app.vault.modify(current, body);
    else await app.vault.create(path, body);
    await new Promise((r) => setTimeout(r, 300));
    return path;
  `);
  createdNotes.add(SMOKE_MODEL_STL);
  {
    await openNote(
      cdp,
      SMOKE_NOTE_STL,
      [`${fence}3d`, `file: ${stl}`, "title: STL", fence, ""].join("\n"),
      "preview",
    );
    const stlStats = await pollUntil<{ coverage: number; colors: number; message: string }>(
      cdp,
      `
        ${SAMPLER}
        const canvas = document.querySelector(".tdcb-block canvas");
        const stats = canvas ? sample(canvas) : null;
        if (!stats || stats.coverage < 5) return null;
        const box = document.querySelector(".tdcb-message-error");
        return { coverage: stats.coverage, colors: stats.colors, message: box ? box.textContent.trim() : "" };
      `,
      30_000,
    );
    record(
      "B16. Eine STL-Datei lädt und ist sichtbar",
      stlStats !== null && stlStats.message === "",
      stlStats
        ? `${stlStats.coverage}% der Fläche belegt · ${stlStats.colors} Farbtöne · ${stl}`
        : `nichts gezeichnet (${stl})`,
    );
  }

  // --- B17. Die drei Beleuchtungs-Zustände sehen verschieden aus ----------
  // Gemessen wird das BILD, nicht die Einstellung: dass ein Dropdown seinen Wert
  // speichert, sagt nichts darüber, ob der Renderpfad ihn je erreicht. Genau diese
  // Lücke war der Smoke-#5-Befund bei "Auto-rotate".
  //
  // Der Mittelwert wird mitgeführt, obwohl der Hash allein entscheidet: wird der Punkt
  // rot, ist die nächste Frage immer "waren die Bilder gleich oder nur ähnlich?" — und
  // drei Hashes nebeneinander beantworten sie nicht.
  await closeExtraLeaves(cdp);
  const lightingShots: Record<string, { hash: number; avg: number[] } | null> = {};
  for (const mode of ["off", "faithful", "contrast"]) {
    await setSetting(cdp, "lighting", mode);
    await openNote(
      cdp,
      SMOKE_NOTE_MANY,
      [`# GUI-Smoke Beleuchtung ${mode} (automatisch erzeugt)`, "", `${fence}3d`, `file: ${probe}`, `title: Licht ${mode}`, fence, ""].join("\n"),
      "preview",
    );
    lightingShots[mode] = await pollUntil<{ hash: number; avg: number[] }>(
      cdp,
      `
        ${SAMPLER}
        const canvas = document.querySelector(".markdown-preview-view .tdcb-block canvas");
        const stats = canvas ? sample(canvas) : null;
        if (!stats || stats.coverage < 5) return null;
        return { hash: stats.hash, avg: stats.avg };
      `,
      40_000,
    );
  }
  await setSetting(cdp, "lighting", "faithful");

  const shotHashes = Object.values(lightingShots).map((s) => s?.hash ?? null);
  record(
    "B17. Die drei Beleuchtungs-Zustände erzeugen drei verschiedene Bilder",
    shotHashes.every((h) => h !== null) && new Set(shotHashes).size === 3,
    Object.entries(lightingShots)
      .map(([mode, s]) => (s ? `${mode} #${s.hash} rgb(${s.avg.join(",")})` : `${mode} kein Bild`))
      .join(" · "),
  );

  skipped(
    "SMOKE.md Punkt 9 (Draco-GLB)",
    "braucht eine Draco-komprimierte Datei im Vault — der Treiber bringt keine Testdaten mit",
  );
  skipped(
    "SMOKE.md 'Zusätzlich' (Popout-Fenster)",
    "ein Popout ist ein eigenes CDP-Target; der Treiber hängt bewusst an genau einem Fenster",
  );
  skipped("SMOKE.md Punkt 8 (Klick-Modus)", "vom Abschnitt 'aktiver Block' abgedeckt (Prüfpunkte 1-3)");
}

// --- Abschnitt: datei-nativer Ausbau (docs/SMOKE.md 2026-07-24) -------------

async function sectionFiles(cdp: Cdp, model: string): Promise<void> {
  await setSetting(cdp, "viewMode", "immediate");
  await setSetting(cdp, "autoRotate", false);
  await setSetting(cdp, "maxContexts", 6);
  await closeExtraLeaves(cdp);
  const probe = await copyProbeModel(cdp, model);

  // --- F1. Die Datei im ganzen Pane ---------------------------------------
  // Der Weg an Markdown vorbei: `registerExtensions` verdrahtet die Endungen mit der
  // FileView. Geprüft wird beides — dass die richtige View aufgeht UND dass sie zeichnet;
  // die View allein sagt nichts darüber, ob der Viewer darin lebt.
  await cdp.evaluate(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(probe)});
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return true;
  `);
  const fileView = await pollUntil<{ type: string; colors: number }>(
    cdp,
    `
      ${SAMPLER}
      const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
      const canvas = leaf?.view?.containerEl?.querySelector("canvas");
      const stats = canvas ? sample(canvas) : null;
      if (!stats || stats.colors < 3) return null;
      return { type: leaf.view.getViewType(), colors: stats.colors };
    `,
    30_000,
  );
  record(
    "F1. Eine 3D-Datei öffnet sich als eigene View und zeigt das Modell",
    fileView !== null && fileView.type === FILE_VIEW,
    fileView ? `View ${fileView.type} · ${fileView.colors} Farbtöne` : await describeScene(cdp),
  );

  // --- F2. Auch dort ist die Kamera bedienbar -----------------------------
  // Der Vergleich läuft über `near`, nicht über Gleichheit: der Rückweg über die Kamera
  // rundet auf ganze Grad, ein Grad Rest ist erwartbar (dieselbe Toleranz wie bei V3).
  // Der erste Entwurf verglich JSON-Strings und meldete deshalb einen Rücksetz-Fehler,
  // den es nicht gibt.
  const fileInteract = await cdp.evaluate<{
    start: ViewValues | null;
    turned: ViewValues | null;
    end: ViewValues | null;
    error: string | null;
  }>(`
    ${SETTLE_VIEW}
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
    const canvasOf = () => leaf?.view?.containerEl?.querySelector("canvas");
    const wake = ${dragCanvas("canvasOf()", 0, 0)};
    const controller = plugin.active.get();
    if (!controller) return { start: null, turned: null, end: null, error: wake ?? "kein Controller in der FileView" };
    const start = await settleView(controller);
    const error = ${dragCanvas("canvasOf()", 120, 36)};
    const turned = await settleView(controller);
    const canvas = canvasOf();
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }));
    return { start, turned, end: await settleView(controller), error };
  `);
  const fileDragged =
    fileInteract.start !== null &&
    JSON.stringify(fileInteract.start) !== JSON.stringify(fileInteract.turned);
  record(
    "F2. In der Datei-Ansicht drehen und per Doppelklick zurücksetzen",
    fileInteract.error === null && fileDragged && near(fileInteract.start, fileInteract.end),
    fileInteract.error ??
      `${JSON.stringify(fileInteract.start)} → gedreht ${JSON.stringify(fileInteract.turned)} → zurück ${JSON.stringify(fileInteract.end)}`,
  );

  // --- F3. Ein zweites Format --------------------------------------------
  // `.gltf` ist Text, `.glb` ein Container — sie gehen durch verschiedene Loader.
  // Ein Punkt, der nur eines von beiden anfasst, spricht nicht für "die Endungen".
  const other = await cdp.evaluate<string | null>(`
    const file = app.vault.getFiles().find((f) => /\\.(glb|stl)$/i.test(f.path) && !/\\.edit\\./.test(f.path));
    return file ? file.path : null;
  `);
  if (!other) {
    skipped("F3. Zweites Format", "keine .glb/.stl im Vault — der Punkt läuft mit, sobald eine da ist");
  } else {
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(other)});
      const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
      await leaf.openFile(file);
      return true;
    `);
    const otherStats = await pollUntil<{ colors: number; message: string }>(
      cdp,
      `
        ${SAMPLER}
        const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
        const root = leaf?.view?.containerEl;
        const canvas = root?.querySelector("canvas");
        const stats = canvas ? sample(canvas) : null;
        if (!stats || stats.colors < 3) return null;
        const box = root.querySelector(".tdcb-message-error");
        return { colors: stats.colors, message: box ? box.textContent.trim() : "" };
      `,
      40_000,
    );
    record(
      `F3. Auch ${other.slice(other.lastIndexOf("."))} lädt in der Datei-Ansicht`,
      otherStats !== null && otherStats.message === "",
      otherStats ? `${otherStats.colors} Farbtöne · ${other}` : `nichts gezeichnet (${other})`,
    );
  }
  await cdp.evaluate(`
    for (const leaf of app.workspace.getLeavesOfType(${JSON.stringify(FILE_VIEW)})) leaf.detach();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);

  // --- F4/F5. Embed mit und ohne Höhenangabe ------------------------------
  // Die Höhe kommt als `height`-Attribut aus Obsidians Wikilink-Syntax; ohne den Punkt
  // bliebe offen, ob `![[datei|300]]` beim Viewer überhaupt ankommt.
  await closeExtraLeaves(cdp);
  await openNote(
    cdp,
    SMOKE_NOTE_FILES,
    [
      "# GUI-Smoke datei-nativ (automatisch erzeugt)",
      "",
      `![[${probe}|300]]`,
      "",
    ].join("\n"),
    "preview",
  );
  const embed = await pollUntil<{ colors: number; height: number; inEmbed: boolean }>(
    cdp,
    `
      ${SAMPLER}
      const preview = document.querySelector(".markdown-preview-view");
      const block = preview?.querySelector(".tdcb-block");
      const canvas = block?.querySelector("canvas");
      const stats = canvas ? sample(canvas) : null;
      if (!stats || stats.colors < 3) return null;
      const viewport = block.querySelector(".tdcb-viewport");
      return {
        colors: stats.colors,
        height: viewport ? Math.round(viewport.getBoundingClientRect().height) : 0,
        inEmbed: !!block.closest(".internal-embed"),
      };
    `,
    30_000,
  );
  record(
    "F4. Ein `![[modell]]`-Embed rendert im Lesemodus",
    embed !== null && embed.inEmbed,
    embed ? `${embed.colors} Farbtöne · im Embed-Container: ${embed.inEmbed}` : "kein gerendertes Embed",
  );
  record(
    "F5. Die Höhenangabe aus `![[modell|300]]` kommt an",
    embed !== null && Math.abs(embed.height - 300) <= 4,
    embed ? `${embed.height}px Viewport-Höhe (erwartet 300)` : "nicht messbar",
  );

  // --- F6/F7. `gltf`-Codeblock -------------------------------------------
  // Der dritte Weg: der Quelltext steht IN der Notiz, es gibt keine Datei. Das kaputte
  // Gegenstück gehört dazu — sonst bliebe offen, ob eine leere Bühne "lädt noch" heißt
  // oder "hat aufgegeben".
  const gltfSource = await cdp.evaluate<string | null>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(probe)});
    if (!file || !file.path.endsWith(".gltf")) return null;
    const text = await app.vault.read(file);
    return text.length < 200000 ? text : null;
  `);
  if (!gltfSource) {
    skipped("F6/F7. gltf-Codeblock", "kein Text-glTF unter 200 KB im Vault, aus dem sich ein Block bauen ließe");
  } else {
    await closeExtraLeaves(cdp);
    await openNote(
      cdp,
      SMOKE_NOTE_GLTF,
      [
        "# GUI-Smoke gltf-Block (automatisch erzeugt)",
        "",
        `${fence}gltf`,
        gltfSource.replace(/\n/g, " "),
        fence,
        "",
        `${fence}gltf`,
        "{ das ist kein JSON",
        fence,
        "",
      ].join("\n"),
      "preview",
    );
    const gltfBlocks = await pollUntil<{ colors: number; message: string }>(
      cdp,
      `
        ${SAMPLER}
        const preview = document.querySelector(".markdown-preview-view");
        const blocks = [...(preview?.querySelectorAll(".tdcb-block") ?? [])];
        if (blocks.length < 2) return null;
        const stats = sample(blocks[0].querySelector("canvas"));
        if (!stats || stats.colors < 3) return null;
        const box = blocks[1].querySelector(".tdcb-message-error, .tdcb-message");
        return { colors: stats.colors, message: box ? box.textContent.trim() : "" };
      `,
      40_000,
    );
    record(
      "F6. Ein `gltf`-Codeblock rendert seinen eigenen Quelltext",
      gltfBlocks !== null,
      gltfBlocks ? `${gltfBlocks.colors} Farbtöne` : "kein gerenderter gltf-Block",
    );
    record(
      "F7. Kaputtes glTF-JSON sagt genau das",
      gltfBlocks !== null && gltfBlocks.message.includes("not valid JSON"),
      gltfBlocks ? gltfBlocks.message.slice(0, 72) || "keine Meldung" : "nicht prüfbar",
    );
  }

  // --- F8. Der Slider in den Einstellungen --------------------------------
  // Am Tab-Container greifen, nicht am Dokument: sind mehrere Fenster desselben Vaults
  // offen, hängt Obsidian das Einstellungs-Modal in `app.setting.win` — ein
  // `document.querySelector(".modal")` bleibt dann leer, während der Tab korrekt steht.
  const slider = await cdp.evaluate<{
    found: boolean;
    tag: string;
    type: string;
    min: string;
    max: string;
  }>(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 600));
    const container = app.setting.activeTab?.containerEl;
    const rows = [...(container?.querySelectorAll(".setting-item") ?? [])];
    const row = rows.find((r) =>
      (r.querySelector(".setting-item-name")?.textContent ?? "").includes("Maximum live 3D views"),
    );
    const input = row?.querySelector("input");
    const result = {
      found: !!row,
      tag: input ? input.tagName.toLowerCase() : "(kein Eingabefeld)",
      type: input ? input.type : "",
      min: input ? input.min : "",
      max: input ? input.max : "",
    };
    app.setting.close();
    await new Promise((r) => setTimeout(r, 300));
    return result;
  `);
  record(
    "F8. 'Maximum live 3D views' ist ein Slider von 0 bis 12",
    slider.found && slider.type === "range" && slider.min === "0" && slider.max === "12",
    slider.found ? `${slider.tag}[type=${slider.type}] ${slider.min}..${slider.max}` : "Zeile nicht gefunden",
  );

  // --- F9. Grenze aus: nichts wird zum Standbild --------------------------
  // Das Gegenstück zu B11. Beide Enden gehören geprüft: eine Grenze, die immer greift,
  // ist genauso falsch wie eine, die nie greift — und "0 = aus" ist die Stelle, an der
  // sich ein Zahlenvergleich am ehesten vertut.
  await setSetting(cdp, "maxContexts", 0);
  await closeExtraLeaves(cdp);
  await openNote(
    cdp,
    SMOKE_NOTE_MANY,
    [
      "# GUI-Smoke fünf Blöcke, Grenze aus (automatisch erzeugt)",
      "",
      ...[1, 2, 3, 4, 5].flatMap((n) => [`${fence}3d`, `file: ${probe}`, `title: Etage ${n}`, fence, ""]),
    ].join("\n"),
    "preview",
  );
  await pollUntil(
    cdp,
    `return document.querySelector(".markdown-preview-view .tdcb-block canvas") ? 1 : 0;`,
    40_000,
  );
  const unlimited = await cdp.evaluate<{ drawn: string[]; titles: string[]; frozen: number }>(`
    ${SAMPLER}
    ${SCROLL_SWEEP}
  `);
  record(
    "F9. 'Maximum live 3D views' = 0 friert nichts ein",
    unlimited.titles.length === 5 && unlimited.drawn.length === 5 && unlimited.frozen === 0,
    `${unlimited.drawn.length}/${unlimited.titles.length} gezeichnet · ${unlimited.frozen} eingefroren`,
  );
  await setSetting(cdp, "maxContexts", 6);

  // --- F10/F11. Koexistenz und Theme über alle drei Wege ------------------
  // Die drei Wege teilen sich Viewer und Theme-Anschluss, hängen aber an drei
  // verschiedenen Obsidian-Schnittstellen (Postprozessor, embedRegistry, FileView).
  // Dass einer davon dem Theme folgt, sagt über die anderen nichts.
  await closeExtraLeaves(cdp);
  await openNote(
    cdp,
    SMOKE_NOTE_MIX,
    [
      "# GUI-Smoke drei Wege nebeneinander (automatisch erzeugt)",
      "",
      `${fence}3d`,
      `file: ${probe}`,
      "title: Codeblock",
      "height: 170",
      fence,
      "",
      `![[${probe}|170]]`,
      "",
    ].join("\n"),
    "preview",
  );
  const mix = await pollUntil<{ code: number; embed: number }>(
    cdp,
    `
      ${SAMPLER}
      const preview = document.querySelector(".markdown-preview-view");
      const blocks = [...(preview?.querySelectorAll(".tdcb-block") ?? [])];
      const code = blocks.find((b) => !b.closest(".internal-embed"));
      const embed = blocks.find((b) => b.closest(".internal-embed"));
      const codeStats = sample(code?.querySelector("canvas"));
      const embedStats = sample(embed?.querySelector("canvas"));
      if (!codeStats || !embedStats || codeStats.colors < 3 || embedStats.colors < 3) return null;
      return { code: codeStats.colors, embed: embedStats.colors };
    `,
    40_000,
  );
  record(
    "F10. Codeblock und Embed rendern in derselben Notiz nebeneinander",
    mix !== null,
    mix ? `Codeblock ${mix.code} Farbtöne · Embed ${mix.embed} Farbtöne` : "nicht beide gerendert",
  );

  const mixTheme = await cdp.evaluate<{ code: number; embed: number }>(`
    ${SAMPLER}
    const preview = document.querySelector(".markdown-preview-view");
    const blocks = [...(preview?.querySelectorAll(".tdcb-block") ?? [])];
    const code = blocks.find((b) => !b.closest(".internal-embed"))?.querySelector("canvas");
    const embed = blocks.find((b) => b.closest(".internal-embed"))?.querySelector("canvas");
    const body = document.body;
    const wasDark = body.classList.contains("theme-dark");
    const apply = async (dark) => {
      body.classList.toggle("theme-dark", dark);
      body.classList.toggle("theme-light", !dark);
      app.workspace.trigger("css-change");
      await new Promise((r) => setTimeout(r, 900));
      return { code: sample(code), embed: sample(embed) };
    };
    const dark = await apply(true);
    const light = await apply(false);
    await apply(wasDark);
    const gap = (a, b) => (a && b ? a.avg.reduce((sum, v, i) => sum + Math.abs(v - b.avg[i]), 0) : 0);
    return { code: gap(dark.code, light.code), embed: gap(dark.embed, light.embed) };
  `);
  record(
    "F11. Codeblock UND Embed folgen dem Theme",
    mixTheme.code > 30 && mixTheme.embed > 30,
    `Farbabstand hell/dunkel — Codeblock ${mixTheme.code} · Embed ${mixTheme.embed}`,
  );
}

// --- Abschnitt: Edit mode (docs/SMOKE.md 2026-07-26) ------------------------

/** Einen Knopf im Edit-Bereich des Panels klicken. Nicht `clickPanelButton` nehmen:
 *  im Panel gibt es ZWEI `.tdcb-panel-actions` — die des Viewers (Save view/Fit) und
 *  die des Edit-Modus. Die erste zu erwischen, waehrend man die zweite meint, ergibt
 *  einen Klick, der ankommt und nichts tut. */
async function clickEditButton(cdp: Cdp, label: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const section = document.querySelector(".tdcb-panel-edit");
    const button = [...(section?.querySelectorAll("button") ?? [])]
      .find((b) => b.textContent === ${JSON.stringify(label)});
    if (!button || button.disabled) return false;
    button.click();
    await new Promise((r) => setTimeout(r, 700));
    return true;
  `);
}

/** Ein Raster ueber den Viewport klicken und einsammeln, welche Knoten dabei
 *  ausgewaehlt wurden. Warum ein Raster und kein gezielter Klick: welcher Knoten unter
 *  welchem Pixel liegt, haengt an Modell und Kamera — ein fester Punkt waere eine
 *  Annahme ueber fremde Geometrie. Das Raster fragt stattdessen, WAS ueberhaupt
 *  auswaehlbar ist, und genau darauf ruht der Locked-Pruefpunkt. */
const SELECTION_SWEEP = `
  const clickCanvasAt = async (canvas, x, y) => {
    const opts = {
      clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
    };
    canvas.dispatchEvent(new PointerEvent("pointerdown", opts));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
    await new Promise((r) => setTimeout(r, 110));
    const label = document.querySelector(".tdcb-panel-edit-label");
    return label && label.textContent.trim() ? label.textContent.trim() : null;
  };

  // Draufsicht mit etwas Abstand: von schräg oben verdecken sich die Knoten gegenseitig,
  // und ein Raster trifft dann immer dieselben zwei. Von oben liegen sie nebeneinander.
  const spreadForSweep = async () => {
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    if (!controller) return false;
    controller.applyView({ azimuth: 0, elevation: 89, distance: 1.35 });
    await new Promise((r) => setTimeout(r, 900));
    return true;
  };

  const sweepSelection = async () => {
    const canvas = document.querySelector(".tdcb-block canvas");
    if (!canvas) return { names: [], clicks: 0 };
    await spreadForSweep();
    const rect = canvas.getBoundingClientRect();
    const names = new Set();
    let clicks = 0;
    for (let ix = 1; ix <= 9; ix++) {
      for (let iy = 1; iy <= 7; iy++) {
        const x = Math.round(rect.left + (rect.width * ix) / 10);
        const y = Math.round(rect.top + (rect.height * iy) / 8);
        const hit = await clickCanvasAt(canvas, x, y);
        clicks++;
        if (hit) names.add(hit);
      }
    }
    return { names: [...names], clicks };
  };

  /** Klicken, bis EINE Auswahl steht — und dann aufhoeren. Der Sweep endet sonst
   *  womoeglich auf einem Klick ins Leere, der die Auswahl wieder aufhebt; die
   *  Zahlenfelder des Panels sind dann weg und der naechste Pruefpunkt misst nichts
   *  (gemessen 2026-08-14). */
  /** Denselben Knoten wiederfinden. Ohne das misst ein Pruefpunkt, der eine
   *  Verschiebung nachsehen will, irgendeinen anderen Knoten und wird gruen, weil dort
   *  natuerlich Zahlen stehen — gemessen 2026-08-14: der Wiedereinstieg meldete
   *  [5,2,-10] fuer einen Knoten, der nie bewegt worden war. */
  const selectNodeNamed = async (wanted) => {
    const canvas = document.querySelector(".tdcb-block canvas");
    if (!canvas) return null;
    await spreadForSweep();
    const rect = canvas.getBoundingClientRect();
    for (let ix = 1; ix <= 9; ix++) {
      for (let iy = 1; iy <= 7; iy++) {
        const hit = await clickCanvasAt(
          canvas,
          Math.round(rect.left + (rect.width * ix) / 10),
          Math.round(rect.top + (rect.height * iy) / 8),
        );
        if (hit === wanted) return hit;
      }
    }
    return null;
  };

  const selectAnyNode = async () => {
    const canvas = document.querySelector(".tdcb-block canvas");
    if (!canvas) return null;
    await spreadForSweep();
    const rect = canvas.getBoundingClientRect();
    for (let ix = 1; ix <= 9; ix++) {
      for (let iy = 1; iy <= 7; iy++) {
        const hit = await clickCanvasAt(
          canvas,
          Math.round(rect.left + (rect.width * ix) / 10),
          Math.round(rect.top + (rect.height * iy) / 8),
        );
        if (hit) return hit;
      }
    }
    return null;
  };
`;


async function sectionEditMode(cdp: Cdp, model: string): Promise<void> {
  await setSetting(cdp, "viewMode", "immediate");
  await setSetting(cdp, "autoRotate", false);
  await setSetting(cdp, "maxContexts", 6);
  await setSetting(cdp, "lockedNodePrefixes", "env__");
  await closeExtraLeaves(cdp);

  // Ein eigenes Prüfmodell: der letzte Top-Level-Knoten bekommt das gesperrte Präfix.
  // So kennt der Lauf beide Seiten beim Namen, ohne etwas über das Vault-Modell
  // annehmen zu müssen — und das Original bleibt unangetastet.
  createdNotes.add(SMOKE_MODEL_EDIT);
  createdNotes.add(SMOKE_MODEL_EDIT.replace(/\.gltf$/, ".edit.gltf"));
  const probe = await cdp.evaluate<{ locked: string; free: string[] } | null>(`
    const source = app.vault.getAbstractFileByPath(${JSON.stringify(model)});
    if (!source || !source.path.endsWith(".gltf")) return null;
    const doc = JSON.parse(await app.vault.read(source));
    const top = doc.scenes?.[doc.scene ?? 0]?.nodes ?? [];
    if (top.length < 2) return null;
    const lockedIndex = top[top.length - 1];
    doc.nodes[lockedIndex].name = "env__" + (doc.nodes[lockedIndex].name ?? "node");
    const path = ${JSON.stringify(SMOKE_MODEL_EDIT)};
    const text = JSON.stringify(doc);
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing) await app.vault.modify(existing, text);
    else await app.vault.create(path, text);
    await new Promise((r) => setTimeout(r, 400));
    return {
      locked: doc.nodes[lockedIndex].name,
      free: top.slice(0, -1).map((i) => doc.nodes[i].name ?? ("#" + i)),
    };
  `);
  if (!probe) {
    skipped(
      "Edit mode (E1-E8)",
      "Prüfmodell ist kein Text-glTF mit mindestens zwei Top-Level-Knoten — daraus lässt sich kein gesperrter Knoten bauen",
    );
    return;
  }

  await openNote(
    cdp,
    SMOKE_NOTE_EDIT,
    [
      "# GUI-Smoke Edit mode (automatisch erzeugt)",
      "",
      `${fence}3d`,
      `file: ${SMOKE_MODEL_EDIT}`,
      `title: ${EDIT_BLOCK_TITLE}`,
      fence,
      "",
    ].join("\n"),
    "preview",
  );
  await cdp.evaluate(
    `await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)}); return true;`,
  );
  const awake = await pollUntil(
    cdp,
    `
      const canvas = document.querySelector(".tdcb-block canvas");
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const opts = {
        clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2),
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
      };
      canvas.dispatchEvent(new PointerEvent("pointerdown", opts));
      canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
      const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
      return controller && controller.label() === ${JSON.stringify(EDIT_BLOCK_TITLE)} ? 1 : 0;
    `,
    30_000,
  );
  if (!awake) {
    record("E1. Edit-Modus betreten", false, `Block nicht weckbar — ${await describeScene(cdp)}`);
    return;
  }

  // --- E1. Betreten -------------------------------------------------------
  const entered = await clickEditButton(cdp, "Edit model");
  const editState = await cdp.evaluate<{ modes: string[]; hint: string; editing: number }>(`
    const section = document.querySelector(".tdcb-panel-edit");
    const modes = [...(section?.querySelectorAll(".tdcb-panel-edit-modes button") ?? [])]
      .map((b) => b.textContent.trim());
    return {
      modes,
      hint: section ? section.textContent : "",
      editing: document.querySelectorAll(".tdcb-editing").length,
    };
  `);
  record(
    "E1. 'Edit model' schaltet den Bearbeitungsmodus ein",
    entered &&
      editState.modes.includes("Move") &&
      editState.modes.includes("Scale") &&
      editState.editing > 0,
    entered
      ? `Modi ${editState.modes.join("/") || "keine"} · ${editState.editing} Viewport(s) mit .tdcb-editing`
      : "'Edit model' war nicht bedienbar",
  );

  // --- E2. Auswahl per Klick ---------------------------------------------
  const sweep = await cdp.evaluate<{ names: string[]; clicks: number }>(`
    ${SELECTION_SWEEP}
    return await sweepSelection();
  `);
  record(
    "E2. Ein Klick aufs Modell wählt einen Knoten aus",
    sweep.names.length > 0,
    `${sweep.names.length} Knoten in ${sweep.clicks} Rasterklicks: ${sweep.names.join(", ") || "keiner"}`,
  );

  // --- E3. Verschieben und speichern -------------------------------------
  // Verschoben wird über die Zahlenfelder des Panels, nicht über den Gizmo: der Gizmo
  // ist eine 3D-Trefferfläche in der Szene, deren Pixelposition von Modell und Kamera
  // abhängt — ein Drag darauf wäre eine Wette. Der Feld-Weg geht durch dieselbe Kette
  // (`applyTrs` → Session → dirty → Save), nur der Griff daran ist ein anderer; dass
  // der Gizmo-Drag selbst ungeprüft bleibt, sagt der Lauf unten an.
  const moved = await cdp.evaluate<{
    selected: string | null;
    before: number[];
    after: number[];
    saveEnabled: boolean;
  }>(`
    ${SELECTION_SWEEP}
    const selected = await selectAnyNode();
    const section = document.querySelector(".tdcb-panel-edit");
    const row = section?.querySelector(".tdcb-panel-edit-row");
    const inputs = [...(row?.querySelectorAll("input") ?? [])];
    if (inputs.length < 3) return { selected, before: [], after: [], saveEnabled: false };
    const before = inputs.map((i) => Number(i.value));
    // Klein verschieben, nicht weit: der Knoten muss beim Wiedereinstieg noch unter
    // demselben Rasterpunkt liegen — ein Sprung um 7 Einheiten trug ihn aus dem Raster
    // heraus, und E5 fand ihn nicht mehr (gemessen 2026-08-14).
    inputs[0].value = String(before[0] + 2);
    inputs[0].dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const fresh = [...document.querySelectorAll(".tdcb-panel-edit-row input")].map((i) => Number(i.value));
    const save = [...document.querySelectorAll(".tdcb-panel-edit button")].find((b) => b.textContent === "Save edits");
    return { selected, before, after: fresh.slice(0, 3), saveEnabled: !!save && !save.disabled };
  `);
  const savedClick = await clickEditButton(cdp, "Save edits");
  const saveNotice = await notices(cdp);
  const editFile = await pollUntil<string>(
    cdp,
    `
      const path = ${JSON.stringify(SMOKE_MODEL_EDIT.replace(/\.gltf$/, ".edit.gltf"))};
      const file = app.vault.getAbstractFileByPath(path);
      return file ? path : null;
    `,
    15_000,
  );
  record(
    "E3. Verschieben macht 'Save edits' bedienbar und schreibt die .edit-Datei",
    moved.saveEnabled &&
      moved.after[0] === moved.before[0] + 2 &&
      savedClick &&
      editFile !== null &&
      saveNotice.includes("Edits saved to"),
    `${moved.selected ?? "nichts"} ${JSON.stringify(moved.before)} → ${JSON.stringify(moved.after)} · Datei: ${editFile ?? "keine"} · Notice: ${saveNotice || "keine"}`,
  );

  // --- E4. Das Original bleibt unangetastet ------------------------------
  // Die Zusage des ganzen Entwurfs: der Editor schreibt einen Änderungswunsch daneben,
  // nicht in die Geometrie-Wahrheit hinein.
  const original = await cdp.evaluate<{ changed: boolean; size: number }>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_MODEL_EDIT)});
    const text = await app.vault.read(file);
    const doc = JSON.parse(text);
    const top = doc.scenes?.[doc.scene ?? 0]?.nodes ?? [];
    const moved = top.some((i) => JSON.stringify(doc.nodes[i].translation ?? []) === "null");
    return { changed: moved, size: text.length };
  `);
  record(
    "E4. Die Original-Datei wird dabei nicht angefasst",
    !original.changed,
    `${original.size} Zeichen, Knoten unverändert`,
  );

  // --- E5. Wiedereinstieg ------------------------------------------------
  // Nach dem Speichern ist die Session sauber — `discard` verlässt den Modus dann ohne
  // Rückfrage, das ist der ruhige Weg hinaus.
  await clickEditButton(cdp, "Discard edits");
  const reentered = await clickEditButton(cdp, "Edit model");
  const reenterNotice = await notices(cdp);
  // GENAU den Knoten wiederfinden, der in E3 bewegt wurde: irgendeine andere Auswahl
  // wäre wertlos — dort stehen auch Zahlen, nur eben nicht die gespeicherten.
  const restored = await cdp.evaluate<{ found: string | null; values: number[] }>(`
    ${SELECTION_SWEEP}
    const found = await selectNodeNamed(${JSON.stringify(moved.selected ?? "")});
    const values = [...document.querySelectorAll(".tdcb-panel-edit-row input")].map((i) => Number(i.value));
    return { found, values: values.slice(0, 3) };
  `);
  const expected = moved.after[0];
  record(
    "E5. Beim Wiedereinstieg sitzt die gespeicherte Verschiebung wieder",
    reentered &&
      reenterNotice.includes("Loaded existing edits") &&
      restored.found === moved.selected &&
      restored.values[0] === expected,
    `Notice: ${reenterNotice || "keine"} · ${restored.found ?? "Knoten nicht wiedergefunden"}: ${JSON.stringify(restored.values)} (erwartet ${expected} auf der ersten Achse)`,
  );

  // --- E6. Gesperrtes Präfix ---------------------------------------------
  // Der Punkt braucht beide Hälften: dass der gesperrte Knoten NICHT auswählbar ist,
  // heißt nur etwas, wenn er es ohne Sperre wäre. Sonst wäre er auch dann grün, wenn
  // ihn schlicht kein Rasterklick trifft — ein Prüfpunkt ohne Gegenstand.
  const withLock = await cdp.evaluate<{ names: string[]; clicks: number }>(`
    ${SELECTION_SWEEP}
    return await sweepSelection();
  `);
  const lockedNames = withLock.names;
  await clickEditButton(cdp, "Discard edits");
  await cdp.evaluate<boolean>(`
    const modal = [...document.querySelectorAll(".modal-button-container button")]
      .find((b) => b.textContent === "Discard");
    if (modal) modal.click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  `);
  await setSetting(cdp, "lockedNodePrefixes", "");
  await clickEditButton(cdp, "Edit model");
  const openSweep = await cdp.evaluate<{ names: string[]; clicks: number }>(`
    ${SELECTION_SWEEP}
    return await sweepSelection();
  `);
  record(
    "E6. Ein 'env__'-Knoten ist gesperrt — und ohne Sperre wäre er auswählbar",
    openSweep.names.includes(probe.locked) && !lockedNames.includes(probe.locked),
    `ohne Sperre: ${openSweep.names.join(", ") || "nichts"} · mit Sperre: ${lockedNames.join(", ") || "nichts"} · gesperrt heißt ${probe.locked}`,
  );
  await setSetting(cdp, "lockedNodePrefixes", "env__");

  // --- E7. Dirty-Discard mit Rückfrage -----------------------------------
  const dirty = await cdp.evaluate<boolean>(`
    ${SELECTION_SWEEP}
    await selectAnyNode();
    const inputs = [...document.querySelectorAll(".tdcb-panel-edit-row input")];
    if (inputs.length < 3) return false;
    inputs[1].value = String(Number(inputs[1].value) + 5);
    inputs[1].dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const save = [...document.querySelectorAll(".tdcb-panel-edit button")].find((b) => b.textContent === "Save edits");
    return !!save && !save.disabled;
  `);
  await clickEditButton(cdp, "Discard edits");
  const dialog = await cdp.evaluate<{ text: string; buttons: string[] }>(`
    const modal = document.querySelector(".modal-button-container");
    return {
      text: modal?.closest(".modal")?.textContent?.trim() ?? "",
      buttons: [...(modal?.querySelectorAll("button") ?? [])].map((b) => b.textContent.trim()),
    };
  `);
  const kept = await cdp.evaluate<boolean>(`
    const keep = [...document.querySelectorAll(".modal-button-container button")]
      .find((b) => b.textContent === "Keep editing");
    if (!keep) return false;
    keep.click();
    await new Promise((r) => setTimeout(r, 700));
    return !!document.querySelector(".tdcb-panel-edit-modes");
  `);
  await clickEditButton(cdp, "Discard edits");
  const discarded = await cdp.evaluate<boolean>(`
    const discard = [...document.querySelectorAll(".modal-button-container button")]
      .find((b) => b.textContent === "Discard");
    if (!discard) return false;
    discard.click();
    await new Promise((r) => setTimeout(r, 900));
    return !document.querySelector(".tdcb-panel-edit-modes");
  `);
  record(
    "E7. Ungespeicherte Änderungen fragen nach — 'Keep editing' bleibt, 'Discard' verlässt",
    dirty && dialog.text.includes("Discard unsaved edits?") && kept && discarded,
    `dirty ${dirty} · Dialog "${dialog.text.slice(0, 40)}" [${dialog.buttons.join(", ")}] · blieb ${kept} · verließ ${discarded}`,
  );

  skipped(
    "SMOKE.md Edit mode Punkt 6 (Abnahme-Test im outpost-Repo)",
    "prüft ein Python-Skript im Konsumenten-Repo, nicht dieses Plugin",
  );
  skipped(
    "SMOKE.md Edit mode Punkt 7 (Regeneration bei offenem Edit-Modus)",
    "braucht einen Erzeuger, der die Datei umbenennt, während der Modus offen ist — noch von Hand",
  );
  skipped(
    "Gizmo-Drag selbst",
    "der Griff ist eine 3D-Trefferfläche in der Szene; E3 fährt dieselbe Kette über die Zahlenfelder",
  );
}

// --- Ablauf -----------------------------------------------------------------

const SECTIONS: { key: string; title: string; run: (cdp: Cdp, model: string) => Promise<void> }[] = [
  { key: "active", title: "Aktiver Block + Sidebar (2026-08-04)", run: sectionActiveBlock },
  { key: "view", title: "Ansicht merken (SMOKE.md 2026-07-25)", run: sectionSaveView },
  { key: "basis", title: "Basis-Checkliste (SMOKE.md Punkte 1-10)", run: sectionBasics },
  { key: "files", title: "Datei-nativer Ausbau (SMOKE.md 2026-07-24)", run: sectionFiles },
  { key: "edit", title: "Edit mode (SMOKE.md 2026-07-26)", run: sectionEditMode },
];

/** Misst der Lauf ueberhaupt den Code dieses Checkouts?
 *
 *  Der Treiber deployt NICHT — er haengt sich an ein laufendes Obsidian und prueft, was
 *  dort zufaellig installiert ist. Ohne diesen Guard misst ein gruener Lauf moeglicherweise
 *  einen fremden Build, und **nichts** faellt dabei auf: `manifest.version` ist dafuer
 *  blind, weil Repo- und Vault-Build dieselbe Nummer tragen, solange kein Release
 *  dazwischenlag.
 *
 *  Gemessen am 2026-08-30: im Staging-Vault lag ein Build vom 15.08. (666.980 Bytes)
 *  gegen 696.246 Bytes im Repo — beide `0.3.1`. Zwei Wochen Aenderungen waren in keinem
 *  Lauf enthalten, der sie zu pruefen glaubte. Dach-`AGENTS.md` fuehrt dieselbe Gattung
 *  fuer Store-Builds (4 von 8 gruenen Laeufen).
 *
 *  Bewusst nur eine Warnung statt eines Abbruchs, wenn der Vault gar nicht gefunden wird:
 *  ein Lauf gegen einen Vault ausserhalb von `STAGING_VAULTS_DIR` (etwa den Arbeits-Vault)
 *  ist zulaessig, nur eben nicht selbst-verifizierend. Weicht der Build dagegen NACHWEISLICH
 *  ab, ist Abbruch die richtige Antwort — weiterzulaufen hiesse, Messwerte zu erzeugen,
 *  die niemand einem Codestand zuordnen kann.
 */
function assertDeployedBuildMatches(vault: string | undefined): void {
  const repoBuild = "main.js";
  if (!existsSync(repoBuild)) {
    throw new Error("main.js fehlt — erst `npm run build`, dann den Smoke.");
  }

  const base = process.env.STAGING_VAULTS_DIR;
  if (base === undefined || base === "") {
    console.log("  ⚠ STAGING_VAULTS_DIR nicht gesetzt — Build-Abgleich uebersprungen.");
    return;
  }

  const vaultName = vault ?? "3d-codeblocks";
  const deployed = join(base, vaultName, ".obsidian", "plugins", "three-d-codeblocks", "main.js");
  if (!existsSync(deployed)) {
    console.log(`  ⚠ Kein Plugin-Build unter ${vaultName} gefunden — Build-Abgleich uebersprungen.`);
    return;
  }

  const a = readFileSync(repoBuild);
  const b = readFileSync(deployed);
  if (a.equals(b)) {
    console.log(`  ✔ Der Vault ${vaultName} traegt den Build dieses Checkouts (${a.length} Bytes).`);
    return;
  }

  throw new Error(
    `Der Vault ${vaultName} traegt einen ANDEREN Build als dieses Repo — der Lauf wuerde fremden Code messen.\n` +
      `  Repo:  ${a.length} Bytes\n` +
      `  Vault: ${b.length} Bytes\n` +
      `  Beheben: OBSIDIAN_PLUGIN_DIR="${join(base, vaultName, ".obsidian", "plugins", "three-d-codeblocks")}" npm run deploy\n` +
      `  (danach das Fenster neu laden — deploy allein ist KEIN Reload)`,
  );
}

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
  assertDeployedBuildMatches(vault);
  const cdp = await Cdp.attach(port, vault);
  // Ausserhalb des try, damit das `finally` ihn auch nach einem Abbruch mitten im Lauf
  // zurueckschreiben kann — sonst bliebe der Vault im Smoke-Zustand stehen.
  // Ein Schnappschuss der GANZEN Einstellungen, nicht nur des einen Feldes: die
  // Abschnitte stellen um, was sie brauchen (Ansichtsmodus, Kontext-Budget), und die
  // Wiederherstellung darf nicht daran hängen, dass jeder von ihnen sauber zu Ende läuft.
  let previousSettings: string | null = null;

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
    //
    // ⚠️ Die Auswahl nimmt das erste Modell, das der Pruefling auch LADEN kann — nicht
    // einfach das erste. Anlass 2026-08-30: im Produktiv-Vault lag als erste .glb eine
    // Datei, deren GLB-JSON-Chunk mit 0x00 statt 0x20 gepolstert war (glTF 2.0 verlangt
    // fuer den JSON-Chunk Leerzeichen; Nullbytes sind das BIN-Padding). Der Pruefling
    // lehnte sie korrekt ab, es entstand kein Canvas — und weil 17 der 19 Pruefpunkte am
    // Rendering haengen, meldete der Lauf 2/19 und sah aus wie ein kaputtes Plugin.
    // Kaputte Testdaten muessen als kaputte Testdaten auffallen, nicht als Regression.
    const picked = await cdp.evaluate<{ path: string | null; skipped: string[] }>(`
      const wanted = ${JSON.stringify(modelArg ?? null)};
      if (wanted) return { path: wanted, skipped: [] };

      // Dieselbe Vorpruefung wie src/core/gltf-inspect.ts: Container lesbar, JSON-Chunk
      // parsebar, keine Extension verlangt, die der Pruefling bewusst nicht kann.
      const unsupported = ["KHR_draco_mesh_compression", "EXT_meshopt_compression"];
      const ladbar = (json) => {
        try {
          const required = JSON.parse(json).extensionsRequired;
          return !Array.isArray(required) || !required.some((e) => unsupported.includes(e));
        } catch {
          return false;
        }
      };

      const skipped = [];
      for (const file of app.vault.getFiles()) {
        if (!/\\.(glb|gltf)$/i.test(file.path) || /\\.edit\\./.test(file.path)) continue;
        const bytes = await app.vault.readBinary(file);
        let ok = false;
        if (/\\.gltf$/i.test(file.path)) {
          ok = ladbar(new TextDecoder().decode(bytes));
        } else {
          const view = new DataView(bytes);
          if (bytes.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67 && view.getUint32(16, true) === 0x4e4f534a) {
            const length = view.getUint32(12, true);
            if (length > 0 && 20 + length <= bytes.byteLength) {
              ok = ladbar(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
            }
          }
        }
        if (ok) return { path: file.path, skipped };
        skipped.push(file.path);
      }
      return { path: null, skipped };
    `);
    const model = picked.path;
    if (!model) {
      throw new Error(
        picked.skipped.length > 0
          ? `Keine ladbare .glb/.gltf im Vault — ${picked.skipped.length} Datei(en) uebersprungen, ` +
            `weil der Pruefling sie nicht laden kann (defekter Container oder Draco/Meshopt): ` +
            `${picked.skipped.join(", ")}. Mit --model <pfad> eine andere angeben.`
          : "Keine .glb/.gltf im Vault gefunden — mit --model <pfad> angeben.",
      );
    }
    for (const path of picked.skipped) {
      console.log(`Uebersprungen (fuer den Pruefling nicht ladbar): ${path}`);
    }
    console.log(`Modell: ${model}\n`);

    // Den Vorwert merken und im `finally` zurückschreiben: der Smoke stellt Einstellungen
    // um, der Vault des Maintainers steht deswegen aber nicht darauf.
    previousSettings = await cdp.evaluate<string>(`
      return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings);
    `);
    await setSetting(cdp, "viewMode", "on-click");

    for (const section of sections) {
      console.log(`── ${section.title}`);
      await section.run(cdp, model);
      console.log("");
    }
  } finally {
    // Aufräumen darf nie am Ergebnis hängen: auch ein abgebrochener Lauf gibt den Vault
    // so zurück, wie er ihn vorgefunden hat.
    if (previousSettings !== null) {
      await cdp
        .evaluate(`
          const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          Object.assign(plugin.settings, JSON.parse(${JSON.stringify(previousSettings)}));
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
