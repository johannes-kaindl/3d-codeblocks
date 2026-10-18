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
 * ⚠️ **Nur gegen eine eigene Zweitinstanz fahren, nie gegen die reguläre.** Vorher prüfen, dass der Port frei ist:
 *
 * ```bash
 * lsof -nP -iTCP:<port> -sTCP:LISTEN >/dev/null && echo "Port belegt — anderen wählen"
 * ```
 *
 * Obsidian läuft als **Zweitinstanz** mit eigenem Profil und eigenem Debug-Port (die reguläre Instanz
 * fasst der Treiber nie an; `--port` ist Pflicht):
 *
 * ```bash
 * UD=/tmp/obs-test-3d-codeblocks    # Profil je Repo; .asar der regulären Instanz hineinkopieren,
 *                                   # Vault und "language":"en" in $UD/obsidian.json eintragen
 * /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=<port> &
 * ```
 *
 * Vertrauensdialog und Restricted Mode erledigt `bereiteInstanzVor` im Treiber.
 *
 * Dann, mit deployter Plugin-Version (`npm run deploy`):
 *
 * Der Treiber baut den Staging-Vault vor dem Lauf aus dem Fixture (`buildVault`, nur fuer den eigenen Vault; `--ohne-fixture`
 * schaltet es ab) und laedt das Plugin mit `ladePluginNeu` neu.
 *
 * ```bash
 * npm run smoke:gui -- --port <port> --vault 3d-codeblocks
 * npm run smoke:gui -- --port <port> --model weltmodell/3d/eg.gltf --keep
 * npm run smoke:gui -- --section basis --vault outpost-worldbuilding
 * ```
 *
 * ⚠️ Ein Handgriff, der beim Start regelmaessig Zeit kostet:
 * - Bei mehreren offenen Fenstern verlangt der Treiber `--vault <name>` und bricht sonst ab
 *   (mit Ansage — er raet das Fenster nicht).
 *
 * ⚠️ Chromium drosselt das Rendering nicht-fokussierter Fenster: ohne `Page.bringToFront`
 * bleibt die View leer und man debuggt ein Phantom (CORE-TEST-02).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { cwd } from "node:process";

import { cameraFloorGltf, groundFloorGltf, coloredCubeObj, cube3mf, dracoDeclaredGlb, octahedronPly, spherePcd, sphereXyz, towerGcode } from "../docs/images/fixture/make-models.mjs";
import { readChangesAnswer, readPartsAnswer } from "../src/core/shapes/protocol";
import { LLM_CONNECTION_STRINGS_EN } from "../src/vendor/kit-obsidian/llm-connection-strings";
import {
  AbbruchAusnahme,
  Cdp,
  beimAbbruch,
  clearNotices,
  bereiteInstanzVor,
  clickReal,
  closeExtraLeaves,
  istAbgebrochen,
  ladePluginNeu,
  notices,
  openNote as openNoteViaBridge,
  pollUntil,
  reopenNote,
  requireVisible,
  setPluginSetting,
} from "../../tools/obsidian-cdp/cdp.js";
import { type Bilanz, createBilanz, parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { messeFolge, zeichneFolge } from "../../tools/obsidian-cdp/folge.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";
import { startLlmStub, type Antwort, type StubAnfrage } from "../../tools/obsidian-cdp/llm-stub.js";


const PLUGIN_ID = "three-d-codeblocks";
const REPO_NAME = "3d-codeblocks";
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
// Festes Prüfmodell aus dem Fixture (`docs/images/fixture/make-models.mjs`): mehrere Top-Level-
// Knoten, darunter ungeteilte meshes — Voraussetzung der Edit-Mode-Punkte E1-E8.
const PREFERRED_MODEL = "models/ground-floor.gltf";
const SMOKE_MODEL_EDIT = "_tdcb-smoke-edit.gltf";
/** Notfall-STL, falls im Vault keine liegt: ein Wuerfel in ASCII-STL (sechs Normalen, damit
 *  mehr als eine Flaechenhelligkeit im Bild landet und der Pruefpunkt nicht an seiner
 *  eigenen Schwelle wackelt). Der Treiber
 *  bringt sonst keine Testdaten mit — hier lohnt die Ausnahme, weil der STL-Punkt sonst
 *  in jedem Vault ohne STL dauerhaft uebersprungen wird und die Lade-/Material-Kette
 *  fuer dieses Format nie jemand faehrt. Eine echte STL aus dem Vault hat Vorrang. */
const SMOKE_MODEL_STL = "_tdcb-smoke-model.stl";
/** Mehrteiliger Export: `.gltf` + `.bin` daneben — die Form, die jeder Blender-Export
    erzeugt. Beide Pfade werden einzeln aufgeraeumt (kein Ordner: `vault.delete` auf einem
    Ordner braucht `force`, und ein leerer Ordner bliebe sonst zurueck). */
const SMOKE_MODEL_SPLIT = "_tdcb-smoke-split.gltf";
const SMOKE_BIN_SPLIT = "_tdcb-smoke-split.bin";
const SMOKE_NOTE_SPLIT = "_tdcb-gui-smoke-split.md";
const SMOKE_MODEL_DRACO = "_tdcb-smoke-draco.glb";
const SMOKE_NOTE_DRACO = "_tdcb-gui-smoke-draco.md";
/** shapes-DSL (SH1–SH5). Der Titel `Tisch` bestimmt den Namen der Export-Datei
    (`Tisch.gltf`, src/core/shapes/export.ts exportBaseName); sie landet im Attachment-
    Ordner und traegt deshalb kein `_tdcb-`-Praefix — SH5 prueft vorher, dass keine fremde
    `Tisch.gltf` im Vault liegt, statt sie mitzumessen. */
const SMOKE_NOTE_SHAPES = "_tdcb-gui-smoke-shapes.md";
const SMOKE_MODEL_SHAPES = "_tdcb-smoke-model.shapes";
const SHAPES_EXPORT_NAME = "Tisch.gltf";
/** Wahr erst, wenn SH5 per Vorpruefung BEWIESEN hat, dass vor dem Export keine
    `Tisch.gltf` im Vault lag — dann gehoert jede, die danach auftaucht, diesem Lauf.
    Wird VOR dem Befehl gesetzt (nicht nach dem Poll), damit `cleanupState` (finally UND
    SIGINT/SIGTERM) die Datei auch bei Abbruch, Timeout oder spaetem Schreiben entfernt. */
let shapesExportOwned = false;
const SHAPES_TABLE = [
  "title: Tisch",
  "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b",
  "box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3",
  "box Bein-2 size 0.05 0.7 0.05 at 0.55 0.35 -0.3",
  "box Bein-3 size 0.05 0.7 0.05 at -0.55 0.35 0.3",
  "box Bein-4 size 0.05 0.7 0.05 at 0.55 0.35 0.3",
].join("\n");
/** Zeile 1 Kopf + 5 Teile → die kaputte Zeile ist Zeile 7 DES BLOCKS. */
const SHAPES_BROKEN_LINE = 7;
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
const SMOKE_WRONG_EXT = "_tdcb-smoke-model.fbx";
/** Pruefmaterial des Kamera-Abschnitts: das Demo-Erdgeschoss MIT Kameras, erzeugt aus
 *  derselben Quelle wie der Aufnahme-Vault (`docs/images/fixture/make-models.mjs`).
 *  Der Abschnitt bringt es selbst mit, weil er ueber konkrete Kameranamen redet — ein
 *  beliebiges Modell aus dem Vault traegt sie nicht. */
const SMOKE_MODEL_CAMERAS = "_tdcb-smoke-cameras.gltf";
const SMOKE_NOTE_CAMERAS = "_tdcb-gui-smoke-cameras.md";
const CAMERA_BLOCK_TITLE = "Kamera-Probe";




// --- Prüfpunkte -------------------------------------------------------------

/** Bilanz in vier Zustaenden (CORE-TEST-19) aus dem zentralen Modul `tools/obsidian-cdp/bilanz.ts`; die Aufrufstellen
 *  unten behalten ihre Namen. `skipped` heisst „bewusst nicht gemessen“, `nothingMeasured` „haette gemessen werden sollen
 *  und konnte nicht“ (eine Voraussetzung fehlt) — beides zaehlt im Nenner, nie als gruen. Mit Soll-Liste (`punkte`):
 *  der Nenner ist die Soll-Liste `PUNKTE_JE_SECTION` der gewaehlten Abschnitte (siehe `main`). */
let bilanz: Bilanz = createBilanz();
/** Soll-Liste des laufenden Abschnitts-Satzes; `skipIds` verbucht die Punkte einer Kennung (`B2`, `SH6b` …) unter ihrem echten Namen. */
let sollListe: readonly string[] = [];
function skipIds(ids: readonly string[], reason: string): void {
  for (const id of ids) {
    const namen = sollListe.filter((n) => n.startsWith(`${id}. `));
    if (namen.length !== 1) throw new Error(`Kennung ${id} trifft ${namen.length} Namen in der Soll-Liste`);
    bilanz.skipped(namen[0]!, reason);
  }
}
const record = (name: string, passed: boolean, detail: string): void => bilanz.record(name, passed, detail);
const skipped = (name: string, reason: string): void => bilanz.skipped(name, reason);
const nothingMeasured = (name: string, reason: string): void => bilanz.unmeasured(name, reason);

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
    // Huellbox der Pixel, die NICHT der Hintergrundton sind (haeufigster quantisierter Ton), als Anteile der
    // Canvasgroesse: Mitte (cx, cy) und Ausdehnung (w, h), je 0..1; null, wenn nichts ausser Hintergrund da ist.
    // Additiv: die uebrigen Felder und der Hash bleiben unveraendert.
    let bgKey = -1;
    for (const [k, c] of counts) if (c === background) { bgKey = k; break; }
    let x0 = off.width, y0 = off.height, x1 = -1, y1 = -1;
    for (let y = 0; y < off.height; y++) {
      for (let x = 0; x < off.width; x++) {
        const i = (y * off.width + x) * 4;
        const q = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
        if (q === bgKey) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const box = x1 < 0 ? null : {
      cx: (x0 + x1 + 1) / 2 / off.width,
      cy: (y0 + y1 + 1) / 2 / off.height,
      w: (x1 - x0 + 1) / off.width,
      h: (y1 - y0 + 1) / off.height,
      // Abstand der Huelle zu den vier Canvasraendern (Anteile); 0 = die Huelle beruehrt den Rand (abgeschnitten).
      l: x0 / off.width,
      t: y0 / off.height,
      r: (off.width - (x1 + 1)) / off.width,
      b: (off.height - (y1 + 1)) / off.height,
    };
    return {
      colors: seen.size,
      coverage: Math.round(((n - background) / n) * 100),
      avg: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
      hash: hash >>> 0,
      box,
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

  // --- 9. Befehl "Save current view as image" -------------------------------
  // Der aktive Block (Punkt 3) ist live. Der Befehl legt ein PNG im Attachment-Ordner ab; gemessen wird, dass es ein PNG ist UND
  // dass es das Modell zeigt (Deckungsgrad der nicht-transparenten, nicht-hintergrundfarbenen Pixel), nicht eine leere Fläche.
  const image = await cdp.evaluate<{ path: string; magic: string; coverage: number } | null>(`
    const before = new Set(app.vault.getFiles().map((f) => f.path));
    await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:save-view-as-image`)});
    for (let i = 0; i < 50; i++) {
      const fresh = app.vault.getFiles().find((f) => !before.has(f.path) && f.extension === "png");
      if (fresh) {
        const bytes = new Uint8Array(await app.vault.readBinary(fresh));
        const magic = [...bytes.slice(0, 4)].map((b) => b.toString(16)).join("");
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const c = document.createElement("canvas");
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        const r0 = px[0], g0 = px[1], b0 = px[2];
        let diff = 0;
        for (let p = 0; p < px.length; p += 4) {
          if (Math.abs(px[p] - r0) + Math.abs(px[p + 1] - g0) + Math.abs(px[p + 2] - b0) > 24) diff++;
        }
        const coverage = Math.round((diff / (px.length / 4)) * 100);
        const path = fresh.path;
        await app.vault.delete(fresh);
        return { path, magic, coverage };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  `);
  record(
    "9. 'Save current view as image' legt ein PNG an, das das Modell zeigt",
    image !== null && image.magic === "89504e47" && image.coverage >= 2,
    image ? `${image.path} · Magic ${image.magic} · ${image.coverage}% der Fläche weicht vom Hintergrund ab` : "keine neue PNG-Datei im Vault",
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
    record("V1. Drehen per echter Maus-Interaktion bewegt die Kamera", false, "Modell wird nicht live: kein Controller mit getView()");
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
  // Fremde Notices vorher wegraeumen: der Container ist app-weit, und was hier gelesen
  // wird, soll von DIESEM Klick stammen.
  await clearNotices(cdp);
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
  // Ueber die Bruecke lesen, nicht selbst: sie sieht auch Notices im Einstellungs-Fenster,
  // die `document.querySelectorAll` allein verpasst.
  const noticeText = await notices(cdp);
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
      ? `kein view: im Editor-Buffer — Datei: ${inFile ?? "auch nicht"} · Direktaufruf: ${direct} · (live: ${liveInEditor}, Panel: ${panelState.label}, Save: ${panelState.save}, Klick: ${clickedInEditor}, Notice: ${noticeText || "keine"})`
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
    skipIds(["B2", "B3", "B4", "B5", "B5b", "B6", "B6b", "B6c", "B7", "B8", "B9", "B10", "B11", "B12"], "ohne gerendertes Modell ist keiner der Folgepunkte aussagekräftig");
    return;
  }

  // --- B6b/B6c. Layout auf EINER Instanz: ein bewegter Blick bleibt (B6b, nach B6), ein nicht bewegter wird neu eingepasst (B6c, vor B2) ----
  // Der Schutz in `viewport.ts` (`RefitTracker`, core/refit-policy.ts): ein Blick, den der Nutzer per Orbit/Pan/Zoom bewegt hat, bleibt bei
  // einer Groessenaenderung stehen; ein nicht bewegter wird eingepasst. Der Zwang ist die Breite des Bühnen-Elements (max-width auf
  // Seitenverhaeltnis 0,5, derselbe Griff wie SH13), KEIN zweites Blatt: ein Split auf der geoeffneten Datei erzeugt eine zweite Instanz mit
  // eigenem Erst-Fit (gemessen Welle 21) und misst dann deren Kamera. Dieser Entwurf loest die alte B6b ab (Task „GUI-Smoke B6b fehlt“):
  // das Tor `layoutSettled` gibt es nicht mehr, der Schutz ist `userMoved`.
  // Das Daempfen von OrbitControls laeuft nach einem Zug noch einige Sekunden nach (gemessen: Kamera driftet ~0,002 Einheiten, und ein Fit
  // direkt danach wird von den Nachlauf-Aenderungen wieder als 'Nutzer hat bewegt' gewertet, Timeline '-MMMM…' nach applyView(null)).
  // Beide Punkte warten deshalb, bis die Kamera steht, sonst messen sie den Nachlauf statt der Regel.
  const SETTLE_CAM = `
    const camPos = () => { const c = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get()?.host?.viewport?.camera; return c ? [c.position.x, c.position.y, c.position.z].map((x) => x.toFixed(6)).join(",") : ""; };
    const settleCam = async () => {
      let last = null, steady = 0;
      for (let i = 0; i < 80 && steady < 10; i++) { await new Promise((r) => setTimeout(r, 100)); const k = camPos(); steady = k === last ? steady + 1 : 0; last = k; }
      return steady >= 10;
    };
  `;
  const narrowProbe = `
    ${SETTLE_CAM}
    // Wie B2: ein Klick ohne Bewegung weckt den Controller (ohne ihn gibt es keinen Blick zu lesen), bewegt aber nichts.
    const wake = ${dragCanvas(`document.querySelector(".tdcb-block canvas")`, 0, 0)};
    ${SETTLE_VIEW}
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    const canvas = document.querySelector(".tdcb-block canvas");
    if (!controller || !canvas || !canvas.parentElement) return { error: "kein Controller/Canvas" };
    const stage = canvas.parentElement;
    // Erst das Layout beruhigen lassen: nach B6 (Split schliessen) waechst der Viewport noch; ein Zwang, der gegen eine wachsende
    // Breite laeuft, aendert die Breite nicht und misst nichts.
    let lastWidth = -1, steady = 0;
    for (let i = 0; i < 40 && steady < 4; i++) {
      await new Promise((r) => setTimeout(r, 150));
      steady = canvas.clientWidth === lastWidth ? steady + 1 : 0;
      lastWidth = canvas.clientWidth;
    }
    // Weltposition der Kamera: 'getView()' ist relativ zum Einpass-Abstand und aendert sich mit dem Seitenverhaeltnis, auch wenn die Kamera
    // stehen bleibt (gemessen: Distanz 1 → 0.62 bei unverrueckter Kamera). Der Controller ist der BlockChild, 'host.viewport.camera' ist
    // TypeScript-private, im Renderer aber lesbar.
    const cam = () => { const c = controller.host?.viewport?.camera; return c ? [c.position.x, c.position.y, c.position.z] : null; };
    await settleCam();
    const before = await settleView(controller);
    const posBefore = cam();
    const cssBefore = canvas.clientWidth;
    const height = canvas.clientHeight;
    let changed = false;
    var target = 0;
    try {
      target = Math.round(Math.min(height * 0.5, cssBefore * 0.6));
      stage.style.maxWidth = target + "px";
      for (let i = 0; i < 60 && canvas.clientWidth > cssBefore * 0.7; i++) await new Promise((r) => setTimeout(r, 100));
      changed = canvas.clientWidth <= cssBefore * 0.7;
      var after = await settleView(controller);
      var posAfter = cam();
    } finally {
      stage.style.maxWidth = "";
      await new Promise((r) => setTimeout(r, 700));
    }
    return { before, after, posBefore, posAfter: typeof posAfter === "undefined" ? null : posAfter, cssBefore, cssAfter: target, changed, error: null };
  `;
  interface NarrowResult { before: ViewValues | null; after: ViewValues | null; posBefore: number[] | null; posAfter: number[] | null; cssBefore: number; cssAfter: number; changed: boolean; error: string | null }

  // B6c (vor B2, solange der Blick unberuehrt ist): der frisch eingepasste Blick wird bei schmalerem Viewport NEU eingepasst. Ein Doppelklick-Reset
  // nach einem Orbit taugt dafuer nicht: gemessen bleibt 'userMoved' danach nicht false (Timeline '-MMMM…' 100 ms nach dem Reset, auch nach
  // applyView(null) und nach Warten auf eine stehende Kamera, Befund an den Master, Welle 22). Der Gegenstueck-Beleg zu B6b ist so: ohne
  // dass resize() neu einpasst, wuerde B6b auch gruen (CORE-TEST-08), B6c zeigt, dass der Weg die Stelle erreicht.
  const wakeError = await cdp.evaluate<string | null>(`return ${dragCanvas(`document.querySelector(".tdcb-block canvas")`, 0, 0)};`);
  await pollUntil(cdp, `const c = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get(); return c && c.getView() ? 1 : 0;`, 6000);
  const unmovedNarrow = await cdp.evaluate<NarrowResult>(narrowProbe);
  if (unmovedNarrow.error != null || !unmovedNarrow.changed || !unmovedNarrow.before || !unmovedNarrow.after) {
    nothingMeasured("B6c. Ein nicht bewegter Blick wird neu eingepasst, wenn der Viewport schmaler wird", (unmovedNarrow.error ?? "die Breite hat sich nicht geaendert (kein Layout-Wechsel erreicht)") + ` · Weck-Zug: ${wakeError ?? "ok"} · ${await describeScene(cdp)}`);
  } else {
    const refit = unmovedNarrow.posBefore && unmovedNarrow.posAfter ? Math.hypot(...unmovedNarrow.posBefore.map((x, i) => x - (unmovedNarrow.posAfter?.[i] ?? 0))) : null;
    if (refit === null) nothingMeasured("B6c. Ein nicht bewegter Blick wird neu eingepasst, wenn der Viewport schmaler wird", "die Kamera ist nicht lesbar (host.viewport.camera)");
    else {
      record(
        "B6c. Ein nicht bewegter Blick wird neu eingepasst, wenn der Viewport schmaler wird",
        refit > 0.05,
        `Kameraposition bewegt sich um ${refit.toFixed(3)} (Distanz im Blick ${unmovedNarrow.before.distance} → ${unmovedNarrow.after.distance}) bei Breite ${unmovedNarrow.cssBefore}→${unmovedNarrow.cssAfter}px`,
      );
    }
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

  // --- B5b. Nach dem Reset bleibt `userMoved` false ------------------------
  // Gemessen Welle 22: nach einem Orbit und Doppelklick-Reset stand `refit.userMoved()` 100 ms spaeter wieder auf true (Daempfungs-Rest
  // des Orbits feuerte `change` ausserhalb von `applyFit`). Gegenprobe: ohne die Daempfungs-Raeumung in `applyFit()` ist dieser Punkt rot.
  const movedAfterReset = await cdp.evaluate<{ timeline: string; error: string | null }>(`
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    const refit = controller?.host?.viewport?.refit;
    if (!refit || typeof refit.userMoved !== "function") return { timeline: "", error: "host.viewport.refit.userMoved nicht lesbar" };
    let tl = "";
    for (let i = 0; i < 15; i++) { tl += refit.userMoved() ? "M" : "-"; await new Promise((r) => setTimeout(r, 100)); }
    return { timeline: tl, error: null };
  `);
  if (movedAfterReset.error) nothingMeasured("B5b. Nach dem Reset gilt der Blick nicht als vom Nutzer bewegt", movedAfterReset.error);
  else record("B5b. Nach dem Reset gilt der Blick nicht als vom Nutzer bewegt", !movedAfterReset.timeline.includes("M"), `Timeline 1,5 s (je 100 ms, '-' = nicht bewegt): ${movedAfterReset.timeline}`);

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

  // B6b: erst echter Orbit (der Blick gilt als bewegt), dann schmal.
  // Zweimal ziehen wie B2 (der erste Zug weckt den Block, falls er noch als Standbild steht); gueltig ist der Punkt nur, wenn der Blick
  // danach wirklich ein anderer ist (CORE-TEST-22: sonst misst er den Einpass-Zustand und sieht aus wie ein Befund).
  const dragResult = await cdp.evaluate<{ error: string | null; fit: ViewValues | null; moved: ViewValues | null }>(`
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    const fit = controller ? controller.getView() : null;
    let error = await ${dragCanvas(`document.querySelector(".tdcb-block canvas")`, 0, 0)};
    error = error ?? await ${dragCanvas(`document.querySelector(".tdcb-block canvas")`, 120, 36)};
    return { error, fit, moved: controller ? controller.getView() : null };
  `);
  const dragError = dragResult.error ?? (dragResult.fit && dragResult.moved && !near(dragResult.fit, dragResult.moved) ? null : "der Orbit hat den Blick nicht veraendert");
  const movedNarrow = await cdp.evaluate<NarrowResult>(narrowProbe);
  if (dragError != null || movedNarrow.error != null || !movedNarrow.changed) {
    nothingMeasured("B6b. Ein bewegter Blick bleibt, wenn der Viewport schmaler wird", dragError ?? movedNarrow.error ?? `die Breite hat sich nicht geaendert (kein Layout-Wechsel erreicht): ${JSON.stringify(movedNarrow)}`);
  } else {
    const fmt = (v: number[] | null): string => (v ? `[${v.map((x) => x.toFixed(3)).join(", ")}]` : "?");
    const moved = movedNarrow.posBefore && movedNarrow.posAfter ? Math.hypot(...movedNarrow.posBefore.map((x, i) => x - (movedNarrow.posAfter?.[i] ?? 0))) : null;
    if (moved === null) nothingMeasured("B6b. Ein bewegter Blick bleibt, wenn der Viewport schmaler wird", "die Kamera ist nicht lesbar (host.viewport.camera)");
    else {
      record(
        "B6b. Ein bewegter Blick bleibt, wenn der Viewport schmaler wird",
        moved < 0.05,
        `Kameraposition ${fmt(movedNarrow.posBefore)} → ${fmt(movedNarrow.posAfter)} (Abweichung ${moved.toFixed(4)}) bei Breite ${movedNarrow.cssBefore}→${movedNarrow.cssAfter}px`,
      );
    }
  }
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
    skipped("B8. Eine extern neu erzeugte Datei erneuert die Ansicht ohne Neustart", `Prüfmodell ist ${probe} — die Änderung braucht Text-glTF`);
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
      const zurueck = node.translation ? [...node.translation] : [0, 0, 0];
      node.translation = [(node.translation?.[0] ?? 0) + 25, (node.translation?.[1] ?? 0) + 15, node.translation?.[2] ?? 0];
      await app.vault.modify(file, JSON.stringify(doc));
      const after = await (async () => {
        ${waitFor(`
          const stats = sample(canvasNow());
          return stats && before && stats.hash !== before.hash ? stats.hash : 0;
        `, 12_000)}
      })();
      // ⚠️ Die Verschiebung ZURUECKNEHMEN. Ohne das laeuft der ganze restliche Abschnitt
      // gegen ein Modell, dessen erster Knoten 25 Einheiten neben dem Rest steht — der
      // Auto-Fit passt dann korrekt auf eine Bounding-Box mit Radius ~24 ein, und das
      // eigentliche Modell ist ein Fleck am Bildrand. Das kostete B17 als "kein Bild"
      // (gemessen 2026-09-03: bounds bis (29,15), Blickziel (12.5,7.5,0), coverage 3
      // gegen die geforderten 5) und sah dabei wie ein Beleuchtungs-Befund aus.
      // Genau deshalb war B17 ISOLIERT gruen und im Lauf rot.
      node.translation = zurueck;
      await app.vault.modify(file, JSON.stringify(doc));
      await new Promise((r) => setTimeout(r, 600));
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
      const preview = document.querySelector(".markdown-preview-view");
      const block = [...(preview?.querySelectorAll(".tdcb-block") ?? [])].find(
        (b) => b.querySelector(".tdcb-title")?.textContent.trim() === "Tippfehler",
      );
      return block && block.querySelector("canvas") ? 1 : 0;
    `,
    40_000,
  );
  const errors = await cdp.evaluate<{ missing: string; format: string; hint: string; canvas: number }>(`
    // ⚠️ Auf die LESE-Ansicht scopen, nicht aufs ganze Dokument. Obsidian haelt beide
    // Ansichten derselben Notiz im DOM: die Live-Preview-Fassung im
    // 'markdown-source-view' (unsichtbar, 0x0, ohne Canvas und ohne Meldung) und die
    // gerenderte im 'markdown-preview-view'. Ein ungescoptes 'querySelectorAll' findet
    // beide, und '.find' nimmt die erste — also die leere. Referenzform ist dieselbe wie
    // in B10-B12. Gemessen 2026-09-02, s. docs/SMOKE.md.
    const preview = document.querySelector(".markdown-preview-view");
    const byTitle = (title) =>
      [...(preview?.querySelectorAll(".tdcb-block") ?? [])].find(
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
    const existing = app.vault.getFiles().filter((f) => /\\.stl$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path))[0];
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
        // Schwelle 2 % statt 5 %: das Oktaeder fuellt nur einen Teil des Bildes, und der Anteil
        // sinkt mit der Canvas-Breite (Fenster 1024 px: 7 %, 1500 px: 4 %). Bei 5 % meldete B16
        // in einem breiteren Fenster "nichts gezeichnet", obwohl gezeichnet war (Welle 14).
        // Ein leeres Canvas liegt bei 0 % und einem Farbton.
        if (!stats || stats.coverage < 2 || stats.colors < 3) return null;
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
  // `viewMode` hier nochmal setzen, obwohl der Abschnitt es oben (Zeile ~1156) bereits
  // tut. Grund ist nicht Misstrauen gegen diese Zeile, sondern gegen die Strecke dazwischen:
  // zwischen dort und hier liegen sechzehn Prüfpunkte, von denen mehrere Einstellungen
  // umstellen. Ein Punkt, der eine Vorbedingung *braucht*, stellt sie unmittelbar davor her
  // — sonst hängt sein Ergebnis an der Frage, was fünfhundert Zeilen weiter oben passiert ist.
  //
  // Belegt an einem eigenen Fall (2026-08-30): ein isoliertes Messskript ohne diese Zeile
  // erbte `on-click` aus der `data.json` des Vaults und meldete dreimal "kein Bild" —
  // jeder Block war eine Klickfläche statt eines Canvas, **ohne Fehlermeldung**. Das DOM
  // sieht dann aus wie "rendert nicht", der Zustand ist aber gültig, also meldet niemand
  // etwas. Mit der Zeile: drei verschiedene Bilder.
  await setSetting(cdp, "viewMode", "immediate");
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

  // --- B18. Mehrteiliges glTF: `.gltf` + `.bin` daneben --------------------
  // Der Fall, den S1 gebaut hat, und der bis 2026-09-03 in der GUI ungeprueft war: three
  // laedt die `.bin` ueber den `LoadingManager`, und ohne den Vault-Resolver
  // (`src/obsidian/gltf-resources.ts`) sucht es sie gegen die APP-Wurzel statt gegen den
  // Vault. Genau das ist die Form, die jeder Blender-Export erzeugt.
  //
  // Der Treiber bringt sein Material selbst mit — wie B16 bei der STL —, statt vom Fixture
  // abzuhaengen: sonst laeuft der Punkt nur im Staging-Vault und wird anderswo still
  // uebersprungen. Hergestellt wird er aus dem vorhandenen Pruefmodell, indem dessen
  // eingebetteter data-URI-Buffer in eine echte Nebendatei ausgelagert wird.
  const split = await cdp.evaluate<{ ok: boolean; grund: string }>(`
    const src = app.vault.getAbstractFileByPath(${JSON.stringify(probe)});
    if (!src || !src.path.endsWith(".gltf")) return { ok: false, grund: "Pruefmodell ist kein Text-glTF" };
    const doc = JSON.parse(await app.vault.read(src));
    const buf = (doc.buffers || [])[0];
    if (!buf || typeof buf.uri !== "string" || buf.uri.indexOf("data:") !== 0) {
      return { ok: false, grund: "Pruefmodell hat keinen eingebetteten Buffer zum Auslagern" };
    }
    const b64 = buf.uri.slice(buf.uri.indexOf(",") + 1);
    const roh = atob(b64);
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);

    const binPfad = ${JSON.stringify(SMOKE_BIN_SPLIT)};
    const altBin = app.vault.getAbstractFileByPath(binPfad);
    if (altBin) await app.vault.modifyBinary(altBin, bytes.buffer);
    else await app.vault.createBinary(binPfad, bytes.buffer);

    // Die URI ist VAULT-relativ zur .gltf — beide liegen im Wurzelverzeichnis.
    doc.buffers[0] = { byteLength: bytes.length, uri: binPfad };
    const gltfPfad = ${JSON.stringify(SMOKE_MODEL_SPLIT)};
    const text = JSON.stringify(doc);
    const altGltf = app.vault.getAbstractFileByPath(gltfPfad);
    if (altGltf) await app.vault.modify(altGltf, text);
    else await app.vault.create(gltfPfad, text);
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, grund: "" };
  `);
  createdNotes.add(SMOKE_MODEL_SPLIT);
  createdNotes.add(SMOKE_BIN_SPLIT);
  createdNotes.add(SMOKE_NOTE_SPLIT);

  if (!split.ok) {
    skipped("B18. Ein mehrteiliges glTF findet seine .bin im Vault", split.grund);
  } else {
    await closeExtraLeaves(cdp);
    await openNote(
      cdp,
      SMOKE_NOTE_SPLIT,
      [`${fence}3d`, `file: ${SMOKE_MODEL_SPLIT}`, "title: Mehrteilig", fence, ""].join("\n"),
      "preview",
    );
    const splitStats = await pollUntil<{ coverage: number; colors: number; meldung: string }>(
      cdp,
      `
        ${SAMPLER}
        // Auf die LESE-Ansicht scopen: Obsidian haelt die Live-Preview-Fassung derselben
        // Notiz unsichtbar daneben im DOM (s. B13-B15, 2026-09-03).
        const preview = document.querySelector(".markdown-preview-view");
        const canvas = preview ? preview.querySelector(".tdcb-block canvas") : null;
        const stats = canvas ? sample(canvas) : null;
        if (!stats || stats.coverage < 5) return null;
        const box = preview ? preview.querySelector(".tdcb-message-error, .tdcb-message") : null;
        return { coverage: stats.coverage, colors: stats.colors, meldung: box ? box.textContent.trim() : "" };
      `,
      30_000,
    );
    record(
      "B18. Ein mehrteiliges glTF findet seine .bin im Vault",
      splitStats !== null && splitStats.meldung === "",
      splitStats
        ? `${splitStats.coverage}% der Fläche belegt · ${splitStats.colors} Farbtöne · Meldung: ${splitStats.meldung || "keine"}`
        : "nichts gezeichnet — die .bin wurde nicht gefunden oder nicht geladen",
    );
  }

  // --- B20-B26. Weitere Formate (Roadmap S7) --------------------------------------------------------------------------
  // Je Format eine echte Beispieldatei aus dem Fixture-Generator, als Block `file: …` in einer eigenen Notiz. Gemessen wird das BILD
  // (Deckungsgrad und Farbtoene wie B16), nicht dass ein Loader nicht wirft; ohne Modell steht ein leerer Canvas bei 0 % und einem Ton.
  // Linien (G-Code) und Punkte (XYZ, PCD) fuellen weniger Flaeche als ein Koerper, ihre Schwelle ist deshalb niedriger. Jede Datei wird sofort
  // nach der Messung geloescht (die erste Datei einer Endung ist Pruefmaterial anderer Abschnitte, CORE-TEST-21).
  const cube = coloredCubeObj();
  const formatProbes: { id: string; titel: string; dateien: { name: string; data: string | Uint8Array }[]; haupt: string; deckung: number; farben: number; farbton?: "mehrere" | "keiner" }[] = [
    { id: "B20", titel: "Eine 3MF-Datei lädt und ist sichtbar", dateien: [{ name: "_tdcb-smoke-cube.3mf", data: cube3mf() }], haupt: "_tdcb-smoke-cube.3mf", deckung: 2, farben: 3 },
    { id: "B21", titel: "Eine OBJ-Datei ohne MTL lädt im Theme-Material", dateien: [{ name: "_tdcb-smoke-plain.obj", data: cube.obj.replace("mtllib colored-cube.mtl\n", "").replace(/^usemtl .*\n/gm, "") }], haupt: "_tdcb-smoke-plain.obj", deckung: 2, farben: 3, farbton: "keiner" },
    { id: "B22", titel: "Eine OBJ-Datei mit MTL im selben Ordner zeigt die Materialfarben der MTL", dateien: [{ name: "_tdcb-smoke-colored.obj", data: cube.obj }, { name: cube.mtlName, data: cube.mtl }], haupt: "_tdcb-smoke-colored.obj", deckung: 2, farben: 5, farbton: "mehrere" },
    { id: "B23", titel: "Eine PLY-Datei mit Flächen und Eckenfarben lädt und ist sichtbar", dateien: [{ name: "_tdcb-smoke-octa.ply", data: octahedronPly() }], haupt: "_tdcb-smoke-octa.ply", deckung: 2, farben: 5 },
    { id: "B24", titel: "Eine G-Code-Datei zeigt ihre Linien", dateien: [{ name: "_tdcb-smoke-tower.gcode", data: towerGcode() }], haupt: "_tdcb-smoke-tower.gcode", deckung: 1, farben: 2 },
    { id: "B25", titel: "Eine XYZ-Punktwolke mit Farben lädt und ist sichtbar", dateien: [{ name: "_tdcb-smoke-sphere.xyz", data: sphereXyz() }], haupt: "_tdcb-smoke-sphere.xyz", deckung: 1, farben: 4 },
    { id: "B26", titel: "Eine PCD-Punktwolke ohne Farbe lädt im Theme-Material", dateien: [{ name: "_tdcb-smoke-sphere.pcd", data: spherePcd() }], haupt: "_tdcb-smoke-sphere.pcd", deckung: 1, farben: 2 },
  ];
  for (const probe of formatProbes) {
    const name = `${probe.id}. ${probe.titel}`;
    for (const datei of probe.dateien) createdNotes.add(datei.name);
    createdNotes.add(`_tdcb-gui-smoke-${probe.id}.md`);
    await cdp.evaluate(`
      for (const datei of ${JSON.stringify(probe.dateien.map((d) => ({ name: d.name, b64: Buffer.from(d.data).toString("base64") })))}) {
        const roh = atob(datei.b64);
        const bytes = new Uint8Array(roh.length);
        for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
        const alt = app.vault.getAbstractFileByPath(datei.name);
        if (alt) await app.vault.modifyBinary(alt, bytes.buffer);
        else await app.vault.createBinary(datei.name, bytes.buffer);
      }
      return true;
    `);
    await closeExtraLeaves(cdp);
    await openNote(cdp, `_tdcb-gui-smoke-${probe.id}.md`, [`${fence}3d`, `file: ${probe.haupt}`, `title: ${probe.id}`, fence, ""].join("\n"), "preview");
    let stats = await pollUntil<{ coverage: number; colors: number; message: string }>(
      cdp,
      `
        ${SAMPLER}
        const canvas = document.querySelector(".markdown-preview-view .tdcb-block canvas");
        const stats = canvas ? sample(canvas) : null;
        if (!stats || stats.coverage < ${probe.deckung} || stats.colors < ${probe.farben}) return null;
        const box = document.querySelector(".markdown-preview-view .tdcb-message-error");
        return { coverage: stats.coverage, colors: stats.colors, message: box ? box.textContent.trim() : "" };
      `,
      30_000,
    );
    // Bei Misserfolg die Meldung des Blocks nennen: „nichts gezeichnet“ allein sagt nicht, ob der Loader geworfen hat.
    const meldung = stats === null
      ? await cdp.evaluate<string>(`const box = document.querySelector(".markdown-preview-view .tdcb-message-error, .markdown-preview-view .tdcb-message"); return box ? box.textContent.trim() : "keine Meldung";`)
      : "";
    // Farbton-Probe (OBJ mit/ohne MTL): die Dateifarben der MTL muessen im Bild ankommen, das Theme-Material bleibt grau. Ohne diese Probe haetten
    // B21 und B22 dieselben Zahlen (gemessen: je 28 % und 9 Farbtoene) — ein Beleg, dass die MTL angewendet wird, sind sie nicht.
    let farbton = "";
    if (stats !== null && probe.farbton) {
      const h = await cdp.evaluate<{ rot: number; gruen: number; blau: number }>(`
        const canvas = document.querySelector(".markdown-preview-view .tdcb-block canvas");
        const off = document.createElement("canvas");
        off.width = 96; off.height = 72;
        const ctx = off.getContext("2d");
        ctx.drawImage(canvas, 0, 0, off.width, off.height);
        const d = ctx.getImageData(0, 0, off.width, off.height).data;
        let rot = 0, gruen = 0, blau = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
          if (r > g + 40 && r > b + 40) rot++;
          else if (g > r + 30 && g > b + 30) gruen++;
          else if (b > r + 40 && b > g + 20) blau++;
        }
        const n = off.width * off.height;
        return { rot: Math.round((rot / n) * 1000) / 10, gruen: Math.round((gruen / n) * 1000) / 10, blau: Math.round((blau / n) * 1000) / 10 };
      `);
      const vorhanden = [h.rot, h.gruen, h.blau].filter((x) => x >= 1).length;
      farbton = ` · Rot ${h.rot}% Grün ${h.gruen}% Blau ${h.blau}%`;
      if (probe.farbton === "mehrere" && vorhanden < 2) stats = null;
      if (probe.farbton === "keiner" && vorhanden > 0) stats = null;
    }
    record(
      name,
      stats !== null && stats.message === "",
      stats ? `${stats.coverage}% der Fläche belegt · ${stats.colors} Farbtöne · ${probe.haupt}${farbton}` : `nichts gezeichnet oder Farbe falsch (${probe.haupt})${farbton} · Meldung: ${meldung}`,
    );
    // Regel 12: das Bild selbst ansehen (Ablage /tmp/w22-shots/3d-codeblocks/); der Canvas behaelt seinen Puffer (preserveDrawingBuffer).
    const bild = await cdp.evaluate<string | null>(`const canvas = document.querySelector(".markdown-preview-view .tdcb-block canvas"); return canvas ? canvas.toDataURL("image/png") : null;`);
    if (bild) {
      mkdirSync("/tmp/w22-shots/3d-codeblocks", { recursive: true });
      writeFileSync(`/tmp/w22-shots/3d-codeblocks/${probe.id}.png`, Buffer.from(bild.split(",")[1] ?? "", "base64"));
    }
    await cdp.evaluate(`
      for (const name of ${JSON.stringify(probe.dateien.map((d) => d.name))}) {
        const f = app.vault.getAbstractFileByPath(name);
        if (f) await app.vault.delete(f);
      }
      return true;
    `);
  }

  // --- B27. Externe Textur bei ausgeschaltetem „Allow external resources“ (Datenschutz) --------------------------------
  // Eine glTF nennt zwei Texturen auf einem lokalen Zaehl-Server: eine glatt (`http://…`), eine mit Tabulator im Schema (`ht<TAB>tp://…`, vom Browser
  // als `http://…` gelesen, von einem Schema-Muster als relativer Pfad). Bei ausgeschalteter Einstellung muss der Server NULL Anfragen sehen und das
  // Modell trotzdem erscheinen, mit Hinweiszeile; Gegenprobe im selben Punkt: mit eingeschalteter Einstellung kommt mindestens eine Anfrage an
  // (sonst waere die Null kein Beleg, CORE-TEST-08/16).
  {
    let anfragen = 0;
    const zaehler = createServer((_req, res) => {
      anfragen += 1;
      res.writeHead(200, { "content-type": "image/gif", "access-control-allow-origin": "*" });
      res.end(Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64"));
    });
    await new Promise<void>((resolve) => zaehler.listen(0, "127.0.0.1", resolve));
    const adresse = zaehler.address();
    const zPort = typeof adresse === "object" && adresse ? adresse.port : 0;
    try {
      const doc = groundFloorGltf() as { images?: unknown[]; textures?: unknown[]; materials?: { pbrMetallicRoughness?: Record<string, unknown>; emissiveTexture?: unknown }[] };
      doc.images = [{ uri: `http://127.0.0.1:${zPort}/glatt.png` }, { uri: `ht\ttp://127.0.0.1:${zPort}/tab.png` }];
      doc.textures = [{ source: 0 }, { source: 1 }];
      const mat = doc.materials?.[0];
      if (mat) {
        mat.pbrMetallicRoughness = { ...(mat.pbrMetallicRoughness ?? {}), baseColorTexture: { index: 0 } };
        mat.emissiveTexture = { index: 1 };
      }
      const name = "_tdcb-smoke-extern.gltf";
      createdNotes.add(name);
      createdNotes.add("_tdcb-gui-smoke-extern.md");
      await cdp.evaluate(`
        const pfad = ${JSON.stringify(name)};
        const text = ${JSON.stringify(JSON.stringify(doc))};
        const alt = app.vault.getAbstractFileByPath(pfad);
        if (alt) await app.vault.modify(alt, text); else await app.vault.create(pfad, text);
        return true;
      `);
      const messen = async (erlaubt: boolean): Promise<{ anfragen: number; zeichnet: boolean; hinweis: string }> => {
        await setSetting(cdp, "allowExternalResources", erlaubt);
        anfragen = 0;
        await closeExtraLeaves(cdp);
        createdNotes.add(`_tdcb-gui-smoke-extern-${erlaubt ? "an" : "aus"}.md`);
        await openNote(cdp, `_tdcb-gui-smoke-extern-${erlaubt ? "an" : "aus"}.md`, [`${fence}3d`, `file: ${name}`, "title: Extern", fence, ""].join("\n"), "preview");
        const r = await pollUntil<{ zeichnet: boolean; hinweis: string }>(
          cdp,
          `
            ${SAMPLER}
            const canvas = document.querySelector(".markdown-preview-view .tdcb-block canvas");
            const stats = canvas ? sample(canvas) : null;
            if (!stats || stats.coverage < 2) return null;
            const box = document.querySelector(".markdown-preview-view .tdcb-message");
            return { zeichnet: true, hinweis: box ? box.textContent.trim() : "" };
          `,
          30_000,
        );
        await new Promise((r2) => setTimeout(r2, 1500));
        return { anfragen, zeichnet: r?.zeichnet === true, hinweis: r?.hinweis ?? "" };
      };
      const aus = await messen(false);
      const an = await messen(true);
      await setSetting(cdp, "allowExternalResources", false);
      record(
        "B27. Bei ausgeschaltetem „Allow external resources“ geht keine Anfrage an eine externe Textur-URL",
        aus.anfragen === 0 && aus.zeichnet && aus.hinweis.includes("Allow external resources") && an.anfragen >= 1,
        `aus: ${aus.anfragen} Anfrage(n) am Zähl-Server, Modell ${aus.zeichnet ? "gezeichnet" : "NICHT gezeichnet"}, Hinweis "${aus.hinweis.slice(0, 70)}" · an (Gegenprobe): ${an.anfragen} Anfrage(n)`,
      );
      await cdp.evaluate(`const f = app.vault.getAbstractFileByPath(${JSON.stringify(name)}); if (f) await app.vault.delete(f); return true;`);
    } finally {
      zaehler.close();
    }
  }

  // --- B19. Draco-GLB -----------------------------------------------------
  // Der Treiber legt einen GLB-Container an, der Draco als Pflicht-Erweiterung deklariert (`dracoDeclaredGlb`, ohne
  // Nutzlast): gemessen wird die Vorab-Erkennung samt Ausweg-Hinweis, nicht der Decoder. Der Block darf kein Canvas zeigen.
  createdNotes.add(SMOKE_MODEL_DRACO);
  createdNotes.add(SMOKE_NOTE_DRACO);
  await cdp.evaluate(`
    const pfad = ${JSON.stringify(SMOKE_MODEL_DRACO)};
    const roh = atob(${JSON.stringify(Buffer.from(dracoDeclaredGlb()).toString("base64"))});
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
    const alt = app.vault.getAbstractFileByPath(pfad);
    if (alt) await app.vault.modifyBinary(alt, bytes.buffer);
    else await app.vault.createBinary(pfad, bytes.buffer);
    return true;
  `);
  await closeExtraLeaves(cdp);
  await openNote(cdp, SMOKE_NOTE_DRACO, [`${fence}3d`, `file: ${SMOKE_MODEL_DRACO}`, "title: Draco", fence, ""].join("\n"), "preview");
  const draco = await pollUntil<{ meldung: string; canvas: number }>(
    cdp,
    `
      const preview = document.querySelector(".markdown-preview-view");
      const block = [...(preview?.querySelectorAll(".tdcb-block") ?? [])].find((b) => b.querySelector(".tdcb-title")?.textContent.trim() === "Draco");
      const box = block ? block.querySelector(".tdcb-message-error") : null;
      return box ? { meldung: box.textContent.trim(), canvas: block.querySelectorAll("canvas").length } : null;
    `,
    20_000,
  );
  // Sofort weg: spaetere Abschnitte (F3 'zweites Format') nehmen die erste .glb im Vault als Pruefmodell und fanden sonst diese Datei
  // (gemessen 2026-10-14: F3 'nichts gezeichnet (_tdcb-smoke-draco.glb)', CORE-TEST-21: ein Prüfpunkt darf den Zustand der anderen nicht verändern).
  await cdp.evaluate(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_MODEL_DRACO)});
    if (f) await app.vault.delete(f);
    return true;
  `);
  record(
    "B19. Eine Draco-GLB nennt Grund und Ausweg und zeigt kein Modell",
    draco !== null && draco.meldung.includes("Draco-compressed glTF is not supported") && draco.meldung.includes("Meshopt") && draco.canvas === 0,
    draco ? `${draco.meldung.slice(0, 70)} · ${draco.canvas} Canvas` : "keine Fehlermeldung im Block",
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
    const file = app.vault.getFiles().filter((f) => /\\.(glb|stl)$/i.test(f.path) && !/\\.edit\\./.test(f.path)).sort((a, b) => a.path.localeCompare(b.path))[0];
    return file ? file.path : null;
  `);
  if (!other) {
    skipped("F3. Das zweite Format lädt in der Datei-Ansicht", "keine .glb/.stl im Vault — der Punkt läuft mit, sobald eine da ist");
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
      "F3. Das zweite Format lädt in der Datei-Ansicht",
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
    skipIds(["F6", "F7"], "kein Text-glTF unter 200 KB im Vault, aus dem sich ein Block bauen ließe");
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

  // --- SH1–SH5. shapes-DSL ------------------------------------------------
  // Vier Bloecke in dieser Reihenfolge: (1) ```shapes mit absichtlich kaputter Zeile 7,
  // (2) ```shapes ohne gueltiges Teil, (3) ```3d file: auf die .shapes-Datei, (4) Embed
  // derselben Datei. Bloecke 1, 3, 4 muessen zeichnen, Block 2 darf NICHT zeichnen — ein
  // Lauf, der nur "irgendwo ein Canvas" zaehlt, wuerde auch ohne shapes gruen.
  await cdp.evaluate(`
    const path = ${JSON.stringify(SMOKE_MODEL_SHAPES)};
    const body = ${JSON.stringify(SHAPES_TABLE)};
    const current = app.vault.getAbstractFileByPath(path);
    if (current) await app.vault.modify(current, body);
    else await app.vault.create(path, body);
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `);
  createdNotes.add(SMOKE_MODEL_SHAPES);
  await closeExtraLeaves(cdp);
  await openNote(
    cdp,
    SMOKE_NOTE_SHAPES,
    [
      "# GUI-Smoke shapes (automatisch erzeugt)",
      "",
      `${fence}shapes`,
      SHAPES_TABLE,
      "box Kaputt size 1 2",
      fence,
      "",
      `${fence}shapes`,
      "boxx Nichts size 1",
      fence,
      "",
      `${fence}3d`,
      `file: ${SMOKE_MODEL_SHAPES}`,
      fence,
      "",
      `![[${SMOKE_MODEL_SHAPES}]]`,
      "",
    ].join("\n"),
    "preview",
  );
  const shapes = await pollUntil<{
    blocks: number;
    colors: (number | null)[];
    canvasInBad: boolean;
    inEmbed: boolean;
    info: string;
    error: string;
  }>(
    cdp,
    `
      ${SAMPLER}
      const preview = document.querySelector(".markdown-preview-view");
      const blocks = [...(preview?.querySelectorAll(".tdcb-block") ?? [])];
      if (blocks.length < 4) return null;
      // Blöcke 1, 3, 4 zeichnen; Block 2 trägt eine Fehlermeldung statt einer Szene.
      const drawing = [blocks[0], blocks[2], blocks[3]];
      const colors = drawing.map((b) => {
        const canvas = b.querySelector("canvas");
        return canvas ? (sample(canvas)?.colors ?? 0) : null;
      });
      if (colors.some((c) => c === null || c < 3)) return null;
      const error = blocks[1].querySelector(".tdcb-message-error")?.textContent?.trim() ?? "";
      if (error === "") return null;
      return {
        blocks: blocks.length,
        colors,
        canvasInBad: !!blocks[1].querySelector("canvas"),
        inEmbed: !!blocks[3].closest(".internal-embed"),
        info: blocks[0].querySelector(".tdcb-message-info")?.textContent?.trim() ?? "",
        error,
      };
    `,
    40_000,
  );
  record(
    "SH1. Ein ```shapes-Block rendert seine Teile",
    shapes !== null && (shapes.colors[0] ?? 0) >= 3,
    shapes ? `${shapes.colors[0]} Farbtöne` : "kein gerenderter shapes-Block (oder Block 2 ohne Fehlermeldung)",
  );
  record(
    "SH2. Eine kaputte Zeile kostet nur sich selbst und wird mit Nummer gemeldet",
    shapes !== null && shapes.info.includes(`Line ${SHAPES_BROKEN_LINE}:`) && (shapes.colors[0] ?? 0) >= 3,
    shapes ? shapes.info.slice(0, 80) || "keine Meldung im ersten Block" : "nicht prüfbar",
  );
  record(
    "SH3. Ein Block ohne gültiges Teil sagt das und zeichnet nichts",
    shapes !== null && shapes.error.includes("no valid part") && !shapes.canvasInBad,
    shapes ? `${shapes.error.slice(0, 70)} · Canvas im Fehlerblock: ${shapes.canvasInBad}` : "nicht prüfbar",
  );
  record(
    "SH4. Dieselbe DSL als Datei rendert über ```3d file: und als Embed",
    shapes !== null && shapes.blocks === 4 && shapes.inEmbed && (shapes.colors[1] ?? 0) >= 3 && (shapes.colors[2] ?? 0) >= 3,
    shapes
      ? `${shapes.blocks} Blöcke · Farbtöne file:/Embed: ${shapes.colors[1]}/${shapes.colors[2]} · im Embed-Container: ${shapes.inEmbed}`
      : "nicht prüfbar",
  );

  // SH5: der Name der Export-Datei kommt aus `title:` und lebt im Attachment-Ordner, ohne
  // Smoke-Praefix. Liegt dort schon eine Tisch.gltf (Fremdbestand oder Rest), wuerde der
  // Befehl nach Ueberschreiben fragen und der Lauf haengen oder fremde Daten treffen: nicht
  // messen, sondern melden.
  const foreignExport = await cdp.evaluate<string | null>(`
    return app.vault.getFiles().find((f) => f.name === ${JSON.stringify(SHAPES_EXPORT_NAME)})?.path ?? null;
  `);
  if (foreignExport !== null) {
    skipped("SH5. Export schreibt eine glTF-Datei, die ihre Quelle nennt", `${foreignExport} liegt schon im Vault — nicht überschrieben, nicht gemessen`);
  } else {
    shapesExportOwned = true;
    await closeExtraLeaves(cdp);
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_MODEL_SHAPES)});
      await app.workspace.getLeaf(true).openFile(file, { active: true });
      await new Promise((r) => setTimeout(r, 500));
      return app.workspace.getActiveFile()?.path ?? null;
    `);
    await cdp.evaluate(`
      app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:export-shapes-gltf`)});
      return true;
    `);
    const exported = await pollUntil<{ path: string; generatedFrom: string; nodes: number }>(
      cdp,
      `
        const out = app.vault.getFiles().find((f) => f.name === ${JSON.stringify(SHAPES_EXPORT_NAME)});
        if (!out) return null;
        const doc = JSON.parse(await app.vault.read(out));
        return {
          path: out.path,
          generatedFrom: doc.asset?.extras?.generatedFrom ?? "",
          nodes: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
        };
      `,
      15_000,
    );
    record(
      "SH5. Export schreibt eine glTF-Datei, die ihre Quelle nennt",
      exported !== null && exported.generatedFrom === SMOKE_MODEL_SHAPES && exported.nodes === 5,
      exported
        ? `${exported.path} · Quelle: ${exported.generatedFrom || "(leer)"} · ${exported.nodes} Knoten (erwartet 5)`
        : `keine ${SHAPES_EXPORT_NAME} nach dem Befehl`,
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
    firstRow: string;
    helpButton: string;
    helpBug: boolean;
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
      firstRow: rows[0]?.querySelector(".setting-item-name")?.textContent ?? "",
      helpButton: rows[0]?.querySelector("button")?.textContent ?? "",
      helpBug: !!rows[0]?.querySelector(".extra-setting-button"),
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

  record(
    "F8b. Die Hilfe-Zeile steht als ERSTE Zeile im Settings-Tab",
    slider.firstRow === "Help" && slider.helpButton === "Open documentation" && slider.helpBug,
    `erste Zeile "${slider.firstRow}" · Knopf "${slider.helpButton}" · Bug-Icon ${slider.helpBug ? "ja" : "nein"}`,
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

  /** EINEN benannten Knoten gezielt anklicken, statt ihn im Raster zu suchen.
   *
   *  Warum zusaetzlich zum Raster: das Raster fragt „was ist ueberhaupt auswaehlbar" und
   *  ist dafuer richtig. Fuer die Frage „ist GENAU DIESER Knoten auswaehlbar" taugt es
   *  nicht — ein kleiner Koerper faellt zwischen die Rasterpunkte, und der Pruefpunkt
   *  liest das als „nicht auswaehlbar". Genau daran ist E6 gescheitert (2026-09-02).
   *
   *  Gerechnet statt geraten: die Weltposition des Knotens wird mit der Kamera des
   *  Viewports auf NDC projiziert und daraus die Pixelposition gebildet. Ohne 'THREE' im
   *  Renderer — 'position.clone()' liefert einen Vector3, 'localToWorld' und 'project'
   *  sind Methoden auf vorhandenen Objekten. */
  const clickNodeNamed = async (wanted) => {
    const canvas = document.querySelector(".tdcb-block canvas");
    const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    // Den Viewport STRUKTURELL suchen, nicht ueber einen festen Pfad: 'active.get()'
    // liefert je nach Kontext einen anderen Controller (Block, Datei-Ansicht, Embed),
    // und der haelt den Host unter einem eigenen Feldnamen. Gesucht wird das Objekt, das
    // eine Kamera UND ein Modell hat — das ist der Viewport, wie immer er heisst.
    const findViewport = (start) => {
      const gesehen = new Set();
      let ebene = [start];
      for (let tiefe = 0; tiefe < 4 && ebene.length; tiefe++) {
        const naechste = [];
        for (const o of ebene) {
          if (!o || typeof o !== "object" || gesehen.has(o) || o.isObject3D) continue;
          gesehen.add(o);
          if (o.camera && o.camera.isCamera && "model" in o) return o;
          for (const k of Object.keys(o)) naechste.push(o[k]);
        }
        ebene = naechste;
      }
      return null;
    };
    const viewport = controller ? findViewport(controller) : null;
    const camera = viewport && viewport.camera;
    const root = viewport && viewport.model;
    if (!canvas || !camera || !root) return { hit: null, grund: "kein Viewport/Kamera/Modell gefunden" };
    const ziel = root.children.find((c) => c.name === wanted);
    if (!ziel) return { hit: null, grund: "Knoten '" + wanted + "' nicht in der Szene" };

    const p = ziel.position.clone();
    if (ziel.parent) ziel.parent.localToWorld(p);
    p.project(camera);
    if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1) {
      return { hit: null, grund: "Knoten liegt ausserhalb des Bildes (ndc " + p.x.toFixed(2) + "," + p.y.toFixed(2) + ")" };
    }
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(rect.left + (p.x * 0.5 + 0.5) * rect.width);
    const y = Math.round(rect.top + (-p.y * 0.5 + 0.5) * rect.height);
    const hit = await clickCanvasAt(canvas, x, y);
    return { hit, grund: hit ? "" : "Klick auf (" + x + "," + y + ") waehlte nichts aus" };
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

  // Ein eigenes Prüfmodell: EIN Top-Level-Knoten bekommt das gesperrte Präfix.
  // So kennt der Lauf beide Seiten beim Namen, ohne etwas über das Vault-Modell
  // annehmen zu müssen — und das Original bleibt unangetastet.
  //
  // ⚠️ Nicht einfach der LETZTE Knoten (so stand es bis 2026-09-02): Knoten, die sich
  // einen `mesh`-Index teilen, sind gar nicht auswählbar. three's `GLTFLoader` klont für
  // sie dasselbe Objekt und propagiert dieselbe `associations`-Wertreferenz auf alle
  // Klone — danach tragen mehrere Top-Level-Kinder denselben `tdcbNodeIndex`, und
  // `duplicatedIndices` (src/viewer/edit-controls.ts) sperrt solche Indizes bewusst
  // ("lieber gar keine Auswahl als die falsche"). Im Fixture betrifft das 8 von 11
  // Knoten: die vier Wände tragen ALLE den Index 4. Ein gesperrter Knoten aus dieser
  // Gruppe macht E6 per Konstruktion unerfüllbar — er wäre auch ohne Sperre nicht
  // auswählbar. Gemessen am 2026-09-02 in Node über `loadModel` + `duplicatedIndices`.
  createdNotes.add(SMOKE_MODEL_EDIT);
  createdNotes.add(SMOKE_MODEL_EDIT.replace(/\.gltf$/, ".edit.gltf"));
  const probe = await cdp.evaluate<{ locked: string; free: string[]; duplicate: string | null } | null>(`
    const source = app.vault.getAbstractFileByPath(${JSON.stringify(model)});
    if (!source || !source.path.endsWith(".gltf")) return null;
    const doc = JSON.parse(await app.vault.read(source));
    const top = doc.scenes?.[doc.scene ?? 0]?.nodes ?? [];
    if (top.length < 2) return null;
    // Nur Knoten mit einem NICHT geteilten mesh-Index kommen in Frage (s. Kommentar oben).
    const meshCount = new Map();
    for (const i of top) {
      const m = doc.nodes[i].mesh;
      if (m !== undefined) meshCount.set(m, (meshCount.get(m) ?? 0) + 1);
    }
    const eindeutig = top.filter((i) => {
      const m = doc.nodes[i].mesh;
      return m !== undefined && meshCount.get(m) === 1;
    });
    if (eindeutig.length < 1) return null;
    const lockedIndex = eindeutig[eindeutig.length - 1];
    doc.nodes[lockedIndex].name = "env__" + (doc.nodes[lockedIndex].name ?? "node");
    // Fuer E8 (Welle 6, "Edit-Modus greift bei geteilten Meshes ins Leere"): EIN
    // Top-Level-Knoten, dessen mesh-Index sich ein Geschwister teilt. Der Name bleibt
    // im SMOKE_MODEL_EDIT-Klon unangetastet, nur der 'locked'-Knoten wird umbenannt.
    const dupliziert = top.filter((i) => {
      const m = doc.nodes[i].mesh;
      return i !== lockedIndex && m !== undefined && meshCount.get(m) > 1;
    });
    const path = ${JSON.stringify(SMOKE_MODEL_EDIT)};
    const text = JSON.stringify(doc);
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing) await app.vault.modify(existing, text);
    else await app.vault.create(path, text);
    await new Promise((r) => setTimeout(r, 400));
    return {
      locked: doc.nodes[lockedIndex].name,
      free: top.filter((i) => i !== lockedIndex).map((i) => doc.nodes[i].name ?? ("#" + i)),
      duplicate: dupliziert.length > 0 ? (doc.nodes[dupliziert[0]].name ?? ("#" + dupliziert[0])) : null,
    };
  `);
  if (!probe) {
    skipIds(["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"],
      "Prüfmodell ist kein Text-glTF mit mindestens zwei Top-Level-Knoten, von denen einer ein ungeteiltes mesh hat — daraus lässt sich kein auswählbarer gesperrter Knoten bauen",
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
    record("E1. 'Edit model' schaltet den Bearbeitungsmodus ein", false, `Block nicht weckbar — ${await describeScene(cdp)}`);
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
  await clearNotices(cdp);
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
  await clearNotices(cdp);
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
  // ihn schlicht kein Klick trifft — ein Prüfpunkt ohne Gegenstand.
  //
  // ⚠️ Bis 2026-09-02 fuhren beide Hälften einen Raster-Sweep und verglichen Namenslisten.
  // Das konnte per Konstruktion nicht grün werden: der Sweep meldete in beiden Hälften
  // nur `Floor`, weil das 9×7-Raster den kleinen gesperrten Körper nie traf. Der Punkt
  // verglich also zwei identische Messungen. Jetzt wird GENAU der Knoten geklickt
  // (Position → Kamera → Pixel), und die Reihenfolge ist umgedreht:
  //
  //   1. OHNE Sperre klicken → muss den Knoten auswählen. Das ist der Beleg, dass der
  //      Klickpunkt ihn trifft; ohne diesen Beleg wäre die zweite Hälfte wertlos, denn
  //      ein Klick ins Leere sieht genauso aus wie eine wirksame Sperre.
  //   2. MIT Sperre an dieselbe Stelle klicken → darf nichts auswählen.
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
  const ohneSperre = await cdp.evaluate<{ hit: string | null; grund: string }>(`
    ${SELECTION_SWEEP}
    await spreadForSweep();
    return await clickNodeNamed(${JSON.stringify(probe.locked)});
  `);

  await clickEditButton(cdp, "Discard edits");
  await cdp.evaluate<boolean>(`
    const modal = [...document.querySelectorAll(".modal-button-container button")]
      .find((b) => b.textContent === "Discard");
    if (modal) modal.click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  `);
  await setSetting(cdp, "lockedNodePrefixes", "env__");
  await clickEditButton(cdp, "Edit model");
  const mitSperre = await cdp.evaluate<{ hit: string | null; grund: string }>(`
    ${SELECTION_SWEEP}
    await spreadForSweep();
    return await clickNodeNamed(${JSON.stringify(probe.locked)});
  `);

  record(
    "E6. Ein 'env__'-Knoten ist gesperrt — und ohne Sperre wäre er auswählbar",
    ohneSperre.hit === probe.locked && mitSperre.hit === null,
    `ohne Sperre: ${ohneSperre.hit ?? "nichts (" + ohneSperre.grund + ")"} · mit Sperre: ${mitSperre.hit ?? "nichts"} · gesperrt heißt ${probe.locked}`,
  );

  // --- E8. Geteiltes Mesh: kein stiller Klick ins Leere (Welle 6) --------
  // Auftrag "Edit-Modus greift bei geteilten Meshes ins Leere": ein Knoten, der seinen
  // mesh-Index mit einem Geschwister teilt, ist nicht auswählbar (s. `duplicatedIndices`,
  // src/viewer/edit-controls.ts) — bis Welle 6 blieb der Klick dabei STUMM, ununterscheidbar
  // von einem Klick daneben. Seit `onSelectBlocked("duplicate")` meldet er sich als Notice.
  if (probe.duplicate) {
    await setSetting(cdp, "lockedNodePrefixes", "");
    await clearNotices(cdp);
    const sharedClick = await cdp.evaluate<{ hit: string | null; grund: string }>(`
      ${SELECTION_SWEEP}
      await spreadForSweep();
      return await clickNodeNamed(${JSON.stringify(probe.duplicate)});
    `);
    const sharedNotice = await notices(cdp);
    record(
      "E8. Ein Klick auf einen Knoten mit geteiltem Mesh wählt nichts aus — und meldet warum",
      sharedClick.hit === null && sharedNotice.includes("shares its mesh"),
      `Klick auf ${probe.duplicate}: ${sharedClick.hit ?? "keine Auswahl"} (${sharedClick.grund}) · Notice: ${sharedNotice || "keine"}`,
    );
  } else {
    skipped(
      "E8. Ein Klick auf einen Knoten mit geteiltem Mesh wählt nichts aus — und meldet warum",
      "Prüfmodell hat keinen zweiten Top-Level-Knoten mit geteiltem mesh-Index außer dem gesperrten",
    );
  }
  // Ausgangszustand fuer E7 wiederherstellen — E8 hatte die Sperre testweise geloescht.
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

// --- Abschnitt: Kameras aus der Datei (Roadmap S5) --------------------------

/** Ein Kamera-Fall: was im Block steht und was dabei herauskommen soll. */
interface CameraCase {
  key: string;
  /** Inhalt der `view:`-Zeile — `null` heisst: keine Zeile, also Auto-Einpassen. */
  view: string | null;
  /** Modell fuer diesen Fall; Vorgabe ist das Kamera-glTF. */
  stl?: boolean;
}

/**
 * `view: camera:<name>` gegen ein echtes Obsidian.
 *
 * Warum dieser Abschnitt sein Material selbst mitbringt, statt das Vault-Modell zu
 * nehmen wie alle anderen: er behauptet Dinge ueber KONKRETE Namen ("Schnitt A" ist
 * erreichbar, "Doppel" ist mehrdeutig, "Plan" ist orthographisch). Ein Modell, das der
 * Vault zufaellig liefert, traegt diese Namen nicht — der Abschnitt waere in jedem
 * fremden Vault entweder uebersprungen oder dauerhaft rot. Das Material kommt aus
 * `docs/images/fixture/make-models.mjs`, also aus derselben Quelle wie der
 * Aufnahme-Vault; `tests/fixture-models.test.ts` haelt seine Voraussetzungen fest,
 * damit ein kaputtes Fixture hier nicht wie ein Plugin-Defekt aussieht.
 *
 * Gemessen wird durchgaengig das BILD (Hash ueber die quantisierten Pixel, Muster von
 * B17) und der sichtbare Meldungstext — nicht, ob eine Funktion gerufen wurde. Dass
 * `setFileCamera` laeuft, sagt nichts darueber, ob die Kamera im Bild ankommt: genau
 * diese Luecke war der Anlass fuer B17 und davor fuer den Auto-rotate-Befund.
 */
async function sectionCameras(cdp: Cdp, _model: string): Promise<void> {
  await setSetting(cdp, "viewMode", "immediate");
  await closeExtraLeaves(cdp);

  // Material in den Vault legen. Beide Dateien werden im `finally` mit den Notizen
  // weggeraeumt (`createdNotes` ist der Sammelpunkt, nicht nur fuer Notizen).
  const gltfBody = JSON.stringify(cameraFloorGltf(), null, 1) + "\n";
  await cdp.evaluate(`
    const schreibe = async (path, body) => {
      const current = app.vault.getAbstractFileByPath(path);
      if (current) await app.vault.modify(current, body);
      else await app.vault.create(path, body);
    };
    await schreibe(${JSON.stringify(SMOKE_MODEL_CAMERAS)}, ${JSON.stringify(gltfBody)});
    await schreibe(${JSON.stringify(SMOKE_MODEL_STL)}, ${JSON.stringify(FALLBACK_STL)});
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);
  createdNotes.add(SMOKE_MODEL_CAMERAS);
  createdNotes.add(SMOKE_MODEL_STL);

  const faelle: CameraCase[] = [
    { key: "auto", view: null },
    { key: "front", view: "camera:Front" },
    { key: "schnitt", view: "camera:Schnitt A" },
    { key: "doppel", view: "camera:Doppel" },
    { key: "unbekannt", view: "camera:Gibtsnicht" },
    { key: "plan", view: "camera:Plan" },
    { key: "stl", view: "camera:Front", stl: true },
  ];

  const shots: Record<string, { hash: number | null; coverage: number; message: string }> = {};

  for (const fall of faelle) {
    const datei = fall.stl === true ? SMOKE_MODEL_STL : SMOKE_MODEL_CAMERAS;
    const zeilen = [`${fence}3d`, `file: ${datei}`, `title: ${CAMERA_BLOCK_TITLE}`];
    if (fall.view !== null) zeilen.push(`view: ${fall.view}`);
    zeilen.push(fence, "");
    await openNote(
      cdp,
      SMOKE_NOTE_CAMERAS,
      [`# GUI-Smoke Kameras — ${fall.key} (automatisch erzeugt)`, "", ...zeilen].join("\n"),
      "preview",
    );

    const bild = await pollUntil<{ hash: number; coverage: number }>(
      cdp,
      `
        ${SAMPLER}
        const canvas = document.querySelector(".markdown-preview-view .tdcb-block canvas");
        const stats = canvas ? sample(canvas) : null;
        if (!stats || stats.coverage < 5) return null;
        return { hash: stats.hash, coverage: stats.coverage };
      `,
      30_000,
    );
    // Die Meldung IMMER lesen, auch wenn ein Bild da ist — und besonders, wenn keins da
    // ist. Ein roter Punkt, der nur "kein Bild" sagt, waehrend einen DOM-Knoten weiter
    // im Klartext steht warum, schickt die Fehlersuche ans falsche Ende (CORE-TEST-14).
    const message = await cdp.evaluate<string>(`
      const box = document.querySelector(".markdown-preview-view .tdcb-block .tdcb-message");
      return box ? box.textContent.trim() : "";
    `);
    shots[fall.key] = { hash: bild?.hash ?? null, coverage: bild?.coverage ?? 0, message };
  }

  const zeige = (key: string): string => {
    const s = shots[key];
    if (!s) return `${key} nicht gemessen`;
    const bild = s.hash === null ? "kein Bild" : `#${s.hash} (${s.coverage}%)`;
    return `${key} ${bild}${s.message ? ` · Meldung ${JSON.stringify(s.message)}` : ""}`;
  };

  const auto = shots["auto"];
  const front = shots["front"];
  const schnitt = shots["schnitt"];
  const doppel = shots["doppel"];
  const unbekannt = shots["unbekannt"];
  const plan = shots["plan"];
  const stl = shots["stl"];

  // K1. Der eigentliche Punkt: die Kamera aus der Datei kommt im BILD an. Verglichen
  // wird gegen das Auto-Einpassen desselben Modells — der Zustand, den es ohne das
  // Feature gaebe. Ein "unterscheidet sich" ohne diesen Bezugspunkt waere wertlos:
  // jedes zweite Bild unterscheidet sich von irgendetwas.
  record(
    "K1. Eine benannte Kamera aus der Datei wird angefahren (Bild ≠ Auto-Einpassen)",
    auto?.hash != null && front?.hash != null && auto.hash !== front.hash && front.message === "",
    `${zeige("auto")} · ${zeige("front")}`,
  );

  // K2. Der Kern-Befund aus S5, und der einzige Weg ihn zu messen: three macht aus
  // "Schnitt A" im geladenen Objekt "Schnitt_A" (sanitizeNodeName). Ein Pruefling, der
  // gegen den Szenengraph sucht, meldet hier "unknown camera" — und genau das ist die
  // Bauart, die ein Unit-Test mit selbstgebauten Infos NICHT ausschliesst, weil er die
  // Sanitisierung gar nicht durchlaeuft.
  record(
    "K2. Ein Kameraname mit Leerzeichen ist erreichbar (`Schnitt A`)",
    schnitt?.hash != null && schnitt.message === "" && schnitt.hash !== auto?.hash,
    zeige("schnitt"),
  );

  // K4. Zwei Behauptungen in einem Punkt, weil sie zusammengehoeren: der Vorwurf
  // "unbekannt" ist nur brauchbar, wenn dabeisteht was es stattdessen gibt — und das
  // Modell darf dabei nicht verschwinden (ein Tippfehler ist kein Ladefehler).
  const nennt = (text: string, namen: string[]): boolean => namen.every((n) => text.includes(n));
  record(
    "K4. Ein unbekannter Name nennt die vorhandenen Kameras und zeigt das Modell trotzdem",
    unbekannt?.hash != null &&
      unbekannt.message.includes("Gibtsnicht") &&
      nennt(unbekannt.message, ["Front", "Schnitt A", "Doppel", "Plan"]),
    zeige("unbekannt"),
  );

  record(
    "K5. Eine orthographische Kamera meldet sich als nicht unterstützt",
    plan?.hash != null &&
      plan.message.toLowerCase().includes("orthographic") &&
      plan.message.toLowerCase().includes("not supported"),
    zeige("plan"),
  );

  // K6. Mehrdeutig heisst NICHT Fehler: der erste Treffer wird angefahren, die Wahl
  // wird nur offengelegt. Deshalb beides pruefen — Meldung UND ein Bild, das vom
  // Auto-Einpassen abweicht. Nur die Meldung zu pruefen liesse offen, ob ueberhaupt
  // eine Kamera gesetzt wurde.
  record(
    "K6. Ein doppelt vergebener Name meldet die Mehrdeutigkeit und fährt trotzdem an",
    doppel?.hash != null &&
      doppel.message.toLowerCase().includes("more than one") &&
      doppel.hash !== auto?.hash,
    zeige("doppel"),
  );

  record(
    "K7. `camera:` auf einer STL nennt das Format als Bedingung",
    stl?.hash != null && stl.message.includes("needs a glTF file"),
    zeige("stl"),
  );

  // K3. Nach dem Anfahren muss der Blick FREI bleiben. Die Sorge ist konkret: die
  // Datei-Kamera setzt Position, Ziel und Bildwinkel auf einmal — bliebe dabei ein
  // Zustand haengen (Controls nicht aktualisiert, Ziel im Ruecken der Kamera), sahe
  // das Standbild richtig aus und waere trotzdem eingefroren. Gemessen wird deshalb
  // ein echter Maus-Drag, nicht `applyView`.
  {
    await openNote(
      cdp,
      SMOKE_NOTE_CAMERAS,
      [
        "# GUI-Smoke Kameras — orbit (automatisch erzeugt)",
        "",
        `${fence}3d`,
        `file: ${SMOKE_MODEL_CAMERAS}`,
        `title: ${CAMERA_BLOCK_TITLE}`,
        "view: camera:Front",
        fence,
        "",
      ].join("\n"),
      "preview",
    );
    const vorher = await pollUntil<{ hash: number }>(
      cdp,
      `
        ${SAMPLER}
        const canvas = document.querySelector(".markdown-preview-view .tdcb-block canvas");
        const stats = canvas ? sample(canvas) : null;
        if (!stats || stats.coverage < 5) return null;
        return { hash: stats.hash };
      `,
      30_000,
    );
    // Drag und Nachmessung in EINEM Renderer-Aufruf, und das Ergebnis in einem Objekt:
    // ein blankes `return null` aus `evaluate` kommt auf der Node-Seite als `undefined`
    // an, der Fehlschlag las sich dann als "Drag scheiterte: undefined" — also als
    // Plugin-Defekt, obwohl der Drag geklappt hatte (gemessen 2026-09-02, erster Lauf).
    const orbit = await cdp.evaluate<{
      before: number | null;
      after: number | null;
      error: string | null;
    }>(`
      ${SAMPLER}
      const canvasOf = () => document.querySelector(".markdown-preview-view .tdcb-block canvas");
      const hashOf = () => {
        const stats = sample(canvasOf());
        return stats && stats.coverage >= 5 ? stats.hash : null;
      };
      const before = hashOf();
      const error = ${dragCanvas("canvasOf()", 140, 40)};
      // OrbitControls laeuft mit Daempfung: nach dem Zug zieht die Kamera noch ueber
      // mehrere Frames nach. Auf die Aenderung WARTEN statt eine Frist abzusitzen —
      // bleibt sie aus, laeuft das Warten in seine Frist und der Punkt wird rot.
      // Langsam ist der bessere Fehlausgang gegenueber falsch.
      let after = hashOf();
      const deadline = Date.now() + 4000;
      while (after === before && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        after = hashOf();
      }
      return { before, after, error };
    `);
    record(
      "K3. Nach dem Anfahren bleibt der Blick frei (Orbit ändert das Bild)",
      orbit.error === null &&
        orbit.before !== null &&
        orbit.after !== null &&
        orbit.before !== orbit.after,
      orbit.error !== null
        ? `Drag scheiterte: ${orbit.error}`
        : `angefahren ${vorher ? `#${vorher.hash}` : "kein Bild"} · vor dem Zug ${orbit.before === null ? "kein Bild" : `#${orbit.before}`} · danach ${orbit.after === null ? "kein Bild" : `#${orbit.after}`}`,
    );
  }

  // Zurück auf den Standard, den main() vor der Sektionsschleife setzt — sonst erbt jede
  // Sektion NACH dieser hier "immediate" und activateBlock() wartet auf ein .tdcb-play,
  // das nie erscheint. Bis 2026-09-16 folgenlos, weil cameras die letzte Sektion war.
  await setSetting(cdp, "viewMode", "on-click");
}

/** Beantwortet die Task-Frage „clickReal misst am ersetzten DOM womoeglich vorbei"
 *  (`control-panel.ts:82` ruft bei jedem Zustandswechsel `root.empty()`, ersetzt also
 *  jeden Panel-Knopf): geht ein Klick zwischen Press und Release ins Leere, wenn das
 *  Panel dazwischen neu zeichnet?
 *
 *  Der Treiber selbst benutzt dafuer nirgends `clickReal` — jeder Panel-Klick
 *  (`clickPanelButton`/`clickEditButton`) ist ein synchrones `element.click()`
 *  INNERHALB eines einzigen `cdp.evaluate()`-Aufrufs, ohne `await` zwischen Suchen und
 *  Klicken. Der Renderer hat einen Thread — `draw()` kann zwischen Suchen und Klicken
 *  darum nicht dazwischenfunken, das ist strukturell sicher. Diese Probe misst es
 *  trotzdem statt es nur zu behaupten (CORE-TEST-01), und liefert die Positivkontrolle
 *  gleich mit: derselbe Knopf, derselbe Sturm, aber mit `clickReal` (echter
 *  Press/Release-Split) geklickt, MUSS Treffer verlieren — sonst waere der Sturm zu
 *  schwach, um ueberhaupt etwas zu beweisen, und R2 (0 Verluste) waere wertlos. */
async function sectionClickRace(cdp: Cdp, model: string): Promise<void> {
  const noteBody = [`${fence}3d`, `file: ${model}`, fence, ""].join("\n");
  await openNote(cdp, SMOKE_NOTE, noteBody, "preview");
  await cdp.evaluate(
    `await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)}); return true;`,
  );
  const active = await activateBlock(cdp, 0);
  if (!active) {
    record("R0. Block aktivierbar (Voraussetzung der Klick-Sturm-Probe)", false, "kein Controller — Probe übersprungen");
    return;
  }
  record("R0. Block aktivierbar (Voraussetzung der Klick-Sturm-Probe)", true, "Controller mit Klick-Fläche");

  const FIT = `[...document.querySelectorAll(".tdcb-panel-actions button")].find((b) => b.textContent === "Fit")`;
  const N = 20;

  // Zaehler auf `document`, nicht am Knopf: der Knopf wird pro Sturm-Tick neu erzeugt,
  // ein Listener direkt darauf ginge mit ihm verloren.
  await cdp.evaluate(`
    window.__tdcbClickHandler = () => { window.__tdcbClicks = (window.__tdcbClicks || 0) + 1; };
    document.addEventListener("click", window.__tdcbClickHandler, true);
    return true;
  `);
  const clickAtomic = async (): Promise<void> => {
    await cdp.evaluate(`
      const el = ${FIT};
      if (el) el.click();
      return true;
    `);
  };

  // --- Grundlinie: ruhiges Ziel, kein Sturm --------------------------------
  await cdp.evaluate(`window.__tdcbClicks = 0; return true;`);
  for (let i = 0; i < N; i++) await clickAtomic();
  const baseline = await cdp.evaluate<number>(`return window.__tdcbClicks;`);
  record("R1. Grundlinie: 20 atomare Klicks ohne Sturm kommen alle an", baseline === N, `${baseline}/${N}`);
  if (baseline !== N) {
    skipIds(["R2", "R3"], "Grundlinie schon nicht 20/20 — alles Folgende wäre wertlos");
    await cdp.evaluate(`document.removeEventListener("click", window.__tdcbClickHandler, true); return true;`);
    return;
  }

  // --- Sturm: root.empty() im 10ms-Takt via active.notify() -----------------
  await cdp.evaluate(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    window.__tdcbStorm = setInterval(() => plugin.active.notify(), 10);
    return true;
  `);
  await new Promise((r) => setTimeout(r, 100));

  // --- Lastfall: derselbe atomare Klick, jetzt unter Sturm -------------------
  await cdp.evaluate(`window.__tdcbClicks = 0; return true;`);
  for (let i = 0; i < N; i++) await clickAtomic();
  const underLoad = await cdp.evaluate<number>(`return window.__tdcbClicks;`);
  record(
    "R2. Lastfall: der reale Klick-Pfad (synchrones element.click()) übersteht den Panel-Sturm",
    underLoad === N,
    `${underLoad}/${N} — root.empty() alle 10ms während geklickt wurde`,
  );

  // --- Positivkontrolle: echter Press/Release-Split (clickReal) im selben Sturm ---
  await cdp.evaluate(`window.__tdcbClicks = 0; return true;`);
  for (let i = 0; i < N; i++) {
    await clickReal(cdp, FIT, 15);
  }
  const splitClicks = await cdp.evaluate<number>(`return window.__tdcbClicks;`);
  record(
    "R3. Positivkontrolle: Press/Release-Split (clickReal, 15ms Haltezeit) verliert Treffer im selben Sturm",
    splitClicks < N,
    `${splitClicks}/${N} click-Events angekommen — belegt, dass der Sturm stark genug ist, den in ` +
      `'clickReal misst am ersetzten DOM womoeglich vorbei' beschriebenen Fehler auszulösen`,
  );

  await cdp.evaluate(`
    clearInterval(window.__tdcbStorm);
    document.removeEventListener("click", window.__tdcbClickHandler, true);
    return true;
  `);
}

// --- SH6–SH12. .shapes-Dateiansicht und Umwandeln -----------------------------
// Eigener Abschnitt (`--section shapesfile`). `Block -> Datei` legt seine Datei in den Attachment-
// Ordner, also an einen nicht vorhersagbaren Pfad. Geloescht wird deshalb NUR, was auf einer
// Weissliste steht: die exakten Namen der SMOKE_*-Konstanten unten plus das nummerierte
// `_tdcb-smoke-moved( N).shapes`. Eine Datei dieses Namens als fremd zu beweisen, ist nicht
// moeglich; der Besitznachweis ist die Treiber-Konvention, dass der Namensraum `_tdcb-smoke-` /
// `_tdcb-gui-smoke-` diesem Treiber gehoert (wie bei allen anderen `_tdcb-`-Konstanten). Jede
// Loeschung vor dem Lauf wird als Infozeile gedruckt; ausserhalb der Weissliste wird nichts angefasst.
// Die Weissliste gilt gleich in der Vorab-Raeumung, am Abschnittsende und in `cleanupState`
// (auch bei SIGINT/SIGTERM). `shapesFileOwned` wird erst gesetzt, wenn danach nichts mehr da ist.
const SHAPES_VIEW_TYPE = "tdcb-shapes-file";
const SMOKE_VIEW_SHAPES = "_tdcb-smoke-view.shapes";
const SMOKE_NOTE_MOVE = "_tdcb-gui-smoke-move.md";
const SMOKE_NOTE_MOVE2 = "_tdcb-gui-smoke-move2.md";
const SMOKE_NOTE_MENU = "_tdcb-gui-smoke-move-menu.md";
const SMOKE_LIVE_SHAPES = "_tdcb-smoke-live.shapes";
const SMOKE_NOTE_LIVE = "_tdcb-gui-smoke-live.md";
const SMOKE_NOTE_KEYS = "_tdcb-gui-smoke-keys.md";
const SMOKE_LINES_5 = "_tdcb-smoke-lines5.shapes";
const SMOKE_LINES_200 = "_tdcb-smoke-lines200.shapes";
const SMOKE_LINES_0 = "_tdcb-smoke-lines0.shapes";
/** `title:` bestimmt den Dateinamen beim Umzug Block -> Datei (exportBaseName). */
const MOVED_TITLE = "_tdcb-smoke-moved";
const CMD_BLOCK_TO_FILE = `${PLUGIN_ID}:convert-shapes-block-to-file`;
const CMD_FILE_TO_BLOCK = `${PLUGIN_ID}:convert-shapes-file-to-block`;
/** Wahr erst, wenn die Vorab-Raeumung gelaufen ist und nichts Weisslistenartiges mehr liegt. */
let shapesFileOwned = false;
/** Renderer-Schnipsel: `mine(file)` = steht auf der Weissliste (exakter Name oder nummerierter Umzugsname). */
const SHAPES_WHITELIST = `
  const exactNames = ${JSON.stringify([
    SMOKE_VIEW_SHAPES,
    SMOKE_NOTE_MOVE,
    SMOKE_NOTE_MOVE2,
    SMOKE_NOTE_MENU,
    SMOKE_LIVE_SHAPES,
    SMOKE_NOTE_LIVE,
    SMOKE_NOTE_KEYS,
    SMOKE_LINES_5,
    SMOKE_LINES_200,
    SMOKE_LINES_0,
  ])};
  const movedRe = new RegExp(${JSON.stringify(`^${MOVED_TITLE}( \\d+)?\\.shapes$`)});
  const mine = (f) => !!f && (exactNames.includes(f.name) || movedRe.test(f.name));
`;
/** Renderer-Schnipsel: schliesst nur Ansichten, deren Datei auf der Weissliste steht, loescht die Dateien
    und liefert deren Pfade. */
const SHAPES_WIPE = `
  ${SHAPES_WHITELIST}
  for (const leaf of app.workspace.getLeavesOfType(${JSON.stringify(SHAPES_VIEW_TYPE)})) {
    if (mine(leaf.view.file)) leaf.detach();
  }
  await new Promise((r) => setTimeout(r, 300));
  const wiped = [];
  for (const f of app.vault.getFiles().filter(mine)) {
    wiped.push(f.path);
    await app.vault.delete(f);
  }
  await new Promise((r) => setTimeout(r, 300));
`;

/** Renderer-Schnipsel: Blatt einer .shapes-Datei und der CodeMirror-View ihres Texteditors. */
const SHAPES_LEAF = `
  const leafFor = (path) => app.workspace.getLeavesOfType(${JSON.stringify(SHAPES_VIEW_TYPE)}).find((l) => l.view.file?.path === path);
  const cmOf = (leaf) => {
    const c = leaf?.view.containerEl.querySelector(".tdcb-shapes-text .cm-content");
    return c ? (c.cmView?.view ?? c.cmTile?.view ?? null) : null;
  };
  const typeAtEnd = (leaf, text) => {
    const v = cmOf(leaf);
    if (v) { v.dispatch({ changes: { from: v.state.doc.length, insert: text } }); return "dispatch"; }
    const c = leaf?.view.containerEl.querySelector(".tdcb-shapes-text .cm-content");
    if (!c) return "kein Editor";
    c.focus();
    const sel = getSelection();
    sel.selectAllChildren(c);
    sel.collapseToEnd();
    document.execCommand("insertText", false, text);
    return "execCommand";
  };
`;

/** Anteil gruener Pixel im Modell-Canvas (0..1), oder null ohne lesbaren Canvas. Gruen heisst
    hier: Kanal g klar vorn — Beleuchtung dunkelt #00ff00 ab, deshalb keine feste Untergrenze 200. */
const GREEN_SHARE = `
  const greenShare = (leaf) => {
    const canvas = leaf?.view.containerEl.querySelector(".tdcb-shapes-model canvas");
    if (!canvas) return null;
    const off = document.createElement("canvas");
    off.width = 256;
    off.height = 192;
    const ctx = off.getContext("2d");
    try { ctx.drawImage(canvas, 0, 0, 256, 192); } catch (e) { return null; }
    const d = ctx.getImageData(0, 0, 256, 192).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 120 && d[i] < 70 && d[i + 2] < 70 && d[i + 1] > d[i] * 2) n++;
    return n / (256 * 192);
  };
`;

/** Wiederholt eine Messung auf der Node-Seite, bis `done` wahr wird — und liefert in jedem Fall
    den letzten Stand, damit ein rotes Ergebnis sagen kann, was gemessen wurde. */
async function pollState<T>(
  cdp: Cdp,
  expression: string,
  done: (state: T) => boolean,
  timeoutMs: number,
  stepMs = 500,
): Promise<{ state: T | null; reached: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let state: T | null = null;
  for (;;) {
    state = await cdp.evaluate<T | null>(expression);
    if (state && done(state)) return { state, reached: true };
    if (Date.now() >= deadline) return { state, reached: false };
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

/** Datei in einem Blatt der Hauptflaeche oeffnen (nicht in einem Split), danach aufraeumen. */
async function openFileInLeaf(cdp: Cdp, path: string): Promise<void> {
  await cdp.evaluate(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit) ?? app.workspace.getLeaf(true);
    await leaf.openFile(file, { active: true });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `);
  await closeExtraLeaves(cdp);
}

/** Cursor im aktiven Quellmodus-Editor auf eine Zeile setzen. */
async function setCursorLine(cdp: Cdp, line: number): Promise<{ mode: string; line: number } | null> {
  return cdp.evaluate<{ mode: string; line: number } | null>(`
    const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
    const view = leaf?.view;
    if (!view?.editor) return null;
    app.workspace.setActiveLeaf(leaf, { focus: true });
    view.editor.setCursor({ line: ${line}, ch: 0 });
    return { mode: view.getMode(), line: view.editor.getCursor().line };
  `);
}

async function sectionShapesFile(cdp: Cdp): Promise<void> {
  // Zustand aus Vorlaeufen VOR dem Abschnitt zuruecksetzen: Ansichten der Weisslisten-Dateien schliessen
  // (sonst schreibt ihr Schlusssichern eine geloeschte Datei neu), die Weisslisten-Dateien loeschen und
  // nachmessen. Jede Loeschung wird gedruckt. Bleibt etwas stehen, wird nichts gemessen.
  const reset = await cdp.evaluate<{ wiped: string[]; remaining: string[] }>(`
    ${SHAPES_WIPE}
    return { wiped, remaining: app.vault.getFiles().filter(mine).map((f) => f.path) };
  `);
  for (const path of reset.wiped) console.log(`  Aufgeräumt (Rest eines früheren Laufs): ${path}`);
  const remaining = reset.remaining;
  if (remaining.length > 0) {
    skipIds(["SH6", "SH6b", "SH7", "SH8", "SH13", "SH14", "SH14b", "SH15", "SH15b", "SH16", "SH16b", "SH17", "SH9", "SH10", "SH11", "SH12", "SH12b"],
      `${remaining.join(", ")} liegt nach dem Zurücksetzen noch im Vault — Besitz nicht bewiesen, nichts gemessen`,
    );
    return;
  }
  shapesFileOwned = true;

  // Pillen haengen an der Breite der Ansicht (>= 700 px: drei). Seitenleisten einklappen, damit
  // die Hauptflaeche breit genug ist, und am Ende zurueckstellen.
  const sidebars = await cdp.evaluate<{ left: boolean; right: boolean }>(`
    const left = !app.workspace.leftSplit.collapsed;
    const right = !app.workspace.rightSplit.collapsed;
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    await new Promise((r) => setTimeout(r, 400));
    return { left, right };
  `);
  try {
    await closeExtraLeaves(cdp);

    // --- SH6. Ansicht mit drei Pillen ---------------------------------------
    await cdp.evaluate(`
      const path = ${JSON.stringify(SMOKE_VIEW_SHAPES)};
      if (!app.vault.getAbstractFileByPath(path)) await app.vault.create(path, ${JSON.stringify(SHAPES_TABLE)});
      return true;
    `);
    createdNotes.add(SMOKE_VIEW_SHAPES);
    await openFileInLeaf(cdp, SMOKE_VIEW_SHAPES);
    const pillsExpr = `
      ${SAMPLER}
      ${SHAPES_LEAF}
      const root = leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector(".tdcb-shapes-view");
      if (!root) return null;
      const canvas = root.querySelector(".tdcb-shapes-model canvas");
      return {
        width: Math.round(root.getBoundingClientRect().width),
        pills: [...root.querySelectorAll(".tdcb-shapes-pill")].map((p) => ({
          label: p.textContent.trim(),
          visible: p.getClientRects().length > 0,
          pressed: p.getAttribute("aria-pressed"),
        })),
        colors: canvas ? (sample(canvas)?.colors ?? 0) : 0,
        editors: root.querySelectorAll(".tdcb-shapes-text .cm-content").length,
      };
    `;
    interface PillState {
      width: number;
      pills: { label: string; visible: boolean; pressed: string | null }[];
      colors: number;
      editors: number;
    }
    const six = await pollState<PillState>(cdp, pillsExpr, (s) => s.colors >= 3 && s.width > 0, 20_000);
    if (six.state === null) {
      record("SH6. Die .shapes-Datei öffnet in der eigenen Ansicht mit Pillen", false, "keine .tdcb-shapes-view im Blatt");
    } else {
      const s = six.state;
      const wide = s.width >= 700;
      const expectedLabels = wide ? ["Model", "Text", "Split"] : ["Model", "Text"];
      const visibleLabels = s.pills.filter((p) => p.visible).map((p) => p.label);
      const pressed = s.pills.filter((p) => p.pressed === "true");
      const expectedPressed = wide ? "Split" : "Model";
      const sixOk =
        visibleLabels.join("|") === expectedLabels.join("|") &&
          pressed.length === 1 &&
          pressed[0]?.visible === true &&
          pressed[0]?.label === expectedPressed &&
          s.colors >= 3 &&
          s.editors === 1;
      record(
        "SH6. Die .shapes-Datei öffnet in der eigenen Ansicht mit Pillen",
        sixOk,
        `Breite ${s.width} px · sichtbar: ${visibleLabels.join("/")} (erwartet ${expectedLabels.join("/")}) · aria-pressed=true: ${pressed.map((p) => p.label).join("/") || "keine"} (erwartet genau ${expectedPressed}) · ${s.colors} Farbtöne · ${s.editors} Texteditor`,
      );
      if (!wide) skipped("SH6b. Drei Pillen und Start in Split ab 700 px", `Ansichtsbreite nur ${s.width} px — der breite Fall wurde nicht gemessen`);
      else record("SH6b. Drei Pillen und Start in Split ab 700 px", sixOk, `Breite ${s.width} px: drei Pillen, Split gedrückt (zusammen mit SH6 gemessen)`);
    }

    // --- SH7. Tippen rendert neu --------------------------------------------
    const greenLine = "box Neu size 0.4 at 0 0.9 0 color #00ff00";
    const before = await cdp.evaluate<number | null>(`
      ${GREEN_SHARE}
      ${SHAPES_LEAF}
      return greenShare(leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)}));
    `);
    const typed = await cdp.evaluate<string>(`
      ${SHAPES_LEAF}
      return typeAtEnd(leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)}), ${JSON.stringify(`\n${greenLine}`)});
    `);
    const seven = await pollState<{ onDisk: boolean; share: number | null }>(
      cdp,
      `
        ${GREEN_SHARE}
        ${SHAPES_LEAF}
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_VIEW_SHAPES)});
        const text = file ? await app.vault.read(file) : "";
        return { onDisk: text.includes(${JSON.stringify(greenLine)}), share: greenShare(leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})) };
      `,
      (s) => s.onDisk && (s.share ?? 0) > 0.003,
      10_000,
    );
    const share = seven.state?.share ?? null;
    record(
      "SH7. Tippen schreibt die Datei und rendert das Modell neu",
      before === 0 && seven.reached,
      `Eingabe per ${typed} · grüner Anteil vorher ${before === null ? "nicht lesbar" : (before * 100).toFixed(2) + " %"} (erwartet 0), nachher ${share === null ? "nicht lesbar" : (share * 100).toFixed(2) + " %"} (erwartet > 0,3 %) · Zeile auf der Platte: ${seven.state?.onDisk ?? false}`,
    );

    // --- SH8. Eine kaputte Zeile ist im Text markiert -----------------------
    await cdp.evaluate(`
      ${SHAPES_LEAF}
      const leaf = leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)});
      const root = leaf.view.containerEl;
      // Im schmalen Fall ist der Text nur ueber die Pille sichtbar.
      if (root.querySelector(".tdcb-shapes-text")?.classList.contains("is-hidden")) {
        root.querySelector('.tdcb-shapes-pill[data-mode="text"]')?.click();
      }
      typeAtEnd(leaf, "\\nbox Kaputt size 1 2");
      return true;
    `);
    const eight = await pollState<{ lines: { text: string; title: string; bb: string; td: string }[]; summary: string; total: number }>(
      cdp,
      `
        ${SHAPES_LEAF}
        const root = leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector(".tdcb-shapes-view");
        if (!root) return null;
        return {
          lines: [...root.querySelectorAll(".tdcb-issue-line.is-error")].map((l) => { const cs = getComputedStyle(l); return { text: l.textContent ?? "", title: l.getAttribute("title") ?? "", bb: cs.borderBottomStyle + " " + cs.borderBottomWidth, td: cs.textDecorationLine }; }),
          summary: root.querySelector(".tdcb-shapes-summary")?.textContent ?? "",
          total: root.querySelectorAll(".tdcb-shapes-text .cm-line").length,
        };
      `,
      (s) => s.lines.length > 0,
      8_000,
    );
    const e8 = eight.state;
    record(
      "SH8. Eine kaputte Zeile ist im Text markiert",
      e8 !== null &&
        e8.lines.length === 1 &&
        e8.lines[0]?.title.includes("needs 1 or 3 numbers") === true &&
        e8.lines[0]?.text.includes("box Kaputt") === true &&
        // Zweiter Kanal sichtbar: Linie unter der Zeile als border-bottom (solid 2px), kein text-decoration (Store-Lint 0.6.1).
        e8.lines[0]?.bb === "solid 2px" &&
        e8.lines[0]?.td === "none" &&
        e8.summary.startsWith("1 error") &&
        e8.summary.includes(`Line ${e8.total}:`),
      e8
        ? `${e8.lines.length} Fehlerzeile(n) (erwartet genau 1) · Linie unter der Zeile: ${e8.lines[0]?.bb ?? "?"} (erwartet solid 2px), text-decoration: ${e8.lines[0]?.td ?? "?"} (erwartet none) · Zeile: ${JSON.stringify(e8.lines[0]?.text ?? "")} · title: ${JSON.stringify(e8.lines[0]?.title ?? "")} · Zusammenfassung: ${JSON.stringify(e8.summary)} (letzte Zeile ${e8.total})`
        : "keine Ansicht",
    );

    // --- SH13. Das Modell sitzt in der Mitte und wird bei jeder Groessenaenderung neu gerahmt ------
    // Ursache des Befunds (Blocker 0.6.0): die Flaeche ragte unten ueber das Pane hinaus, und die Kamera rahmte
    // nur bei der ersten Groesse. Gemessen wird pro Phase die Huellbox der Nicht-Hintergrund-Pixel (das
    // Bodengitter zaehlt mit, Hintergrund = haeufigster Ton): Mitte innerhalb 10 % der Canvasmitte, Abstand zu
    // ALLEN vier Canvasraendern (nichts abgeschnitten), Canvas nicht hoeher als die Flaeche.
    // Die Phasen Seitenleiste ein/aus aendern nur die Breite; solange die HOEHE begrenzt, sieht ein nicht neu
    // gerahmtes Modell gleich aus (Distanz und vertikaler Bildwinkel aendern sich nicht). Der tragende Fall ist
    // deshalb die Phase „schmal“: die Modell-Spalte wird auf Seitenverhaeltnis 0,5 gezwungen. Dort begrenzt die
    // BREITE; mit Refit passt die Huelle (gemessen 63 %, gerechnet ca. 72 % der Breite), ohne Refit ist sie 88 % breit (gemessen im Gegenprobe-Lauf 2026-10-04, Schwelle deshalb 80 %, nicht 90 %; gerechnet 141 % bei anderer Ausgangsgroesse) und
    // beruehrt beide Raender (tests/core/refit-policy.test.ts rechnet beides mit fitCamera nach).
    const centreExpr = `
      ${SAMPLER}
      ${SHAPES_LEAF}
      const root = leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector(".tdcb-shapes-view");
      const canvas = root?.querySelector(".tdcb-shapes-model canvas");
      const model = root?.querySelector(".tdcb-shapes-model");
      if (!canvas || !model || model.classList.contains("is-hidden")) return null;
      const s = sample(canvas);
      const c = canvas.getBoundingClientRect();
      const m = model.getBoundingClientRect();
      const b = root.querySelector(".tdcb-shapes-body").getBoundingClientRect();
      return {
        box: s?.box ?? null,
        canvas: [Math.round(c.width), Math.round(c.height)],
        pane: [Math.round(m.width), Math.round(m.height)],
        body: [Math.round(b.width), Math.round(b.height)],
      };
    `;
    interface CentreState {
      box: { cx: number; cy: number; w: number; h: number; l: number; t: number; r: number; b: number } | null;
      canvas: number[];
      pane: number[];
      body: number[];
    }
    const centred = (s: CentreState): boolean =>
      s.box !== null &&
      Math.abs(s.box.cx - 0.5) < 0.1 &&
      Math.abs(s.box.cy - 0.5) < 0.1 &&
      Math.min(s.box.l, s.box.t, s.box.r, s.box.b) > 0 &&
      (s.canvas[1] ?? 0) <= (s.body[1] ?? 0) + 2;
    const describeCentre = (s: CentreState | null): string =>
      s === null
        ? "keine Modell-Spalte"
        : `Hüllbox-Mitte ${s.box ? `${(s.box.cx * 100).toFixed(0)} %/${(s.box.cy * 100).toFixed(0)} %` : "keine Pixel"} (erwartet 50 % ± 10) · Ausdehnung ${s.box ? `${(s.box.w * 100).toFixed(0)} %×${(s.box.h * 100).toFixed(0)} %` : "-"} · Randabstand l/o/r/u ${s.box ? [s.box.l, s.box.t, s.box.r, s.box.b].map((v) => (v * 100).toFixed(0) + " %").join("/") : "-"} (erwartet je > 0) · Canvas ${s.canvas.join("×")} · Modell-Spalte ${s.pane.join("×")} · Fläche ${s.body.join("×")} px`;
    await cdp.evaluate(`
      ${SHAPES_LEAF}
      leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector('.tdcb-shapes-pill[data-mode="model"]')?.click();
      await new Promise((r) => setTimeout(r, 600));
      return true;
    `);
    const open13 = await pollState<CentreState>(cdp, centreExpr, centred, 10_000);
    // Phase „schmal“: Modell-Spalte auf Seitenverhaeltnis 0,5; der Zwang wird danach IMMER zurueckgenommen.
    let narrow13: { state: CentreState | null; reached: boolean } = { state: null, reached: false };
    try {
      await cdp.evaluate(`
        ${SHAPES_LEAF}
        const model = leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector(".tdcb-shapes-model");
        const h = model.getBoundingClientRect().height;
        // max-width statt Breite/flex: die Hoehe bleibt die der Flaeche (Flex-Wachstum), nur die Breite wird begrenzt.
        model.style.maxWidth = Math.round(h * 0.5) + "px";
        await new Promise((r) => setTimeout(r, 900));
        return true;
      `);
      narrow13 = await pollState<CentreState>(
        cdp,
        centreExpr,
        (s) => centred(s) && (s.canvas[0] ?? 0) / Math.max(s.canvas[1] ?? 1, 1) < 0.7 && (s.box?.w ?? 1) < 0.8,
        10_000,
      );
    } finally {
      await cdp.evaluate(`
        ${SHAPES_LEAF}
        const model = leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector(".tdcb-shapes-model");
        if (model) model.style.maxWidth = "";
        await new Promise((r) => setTimeout(r, 900));
        return true;
      `);
    }
    const restored13 = await pollState<CentreState>(cdp, centreExpr, centred, 10_000);
    // Seitenleiste ein und wieder aus (nur Breite, siehe oben: schaerft den Pane-Zentrum-Teil).
    await cdp.evaluate(`
      app.workspace.leftSplit.expand();
      await new Promise((r) => setTimeout(r, 900));
      return true;
    `);
    const sidebar13 = await pollState<CentreState>(cdp, centreExpr, centred, 10_000);
    await cdp.evaluate(`
      app.workspace.leftSplit.collapse();
      await new Promise((r) => setTimeout(r, 900));
      return true;
    `);
    const back13 = await pollState<CentreState>(cdp, centreExpr, centred, 10_000);
    record(
      "SH13. Das Modell der Dateiansicht sitzt in der Mitte und wird bei jeder Größenänderung neu gerahmt (nichts abgeschnitten, auch im schmalen Pane)",
      open13.reached && narrow13.reached && restored13.reached && sidebar13.reached && back13.reached,
      `Öffnen: ${describeCentre(open13.state)} | schmal (Seitenverhältnis 0,5; erwartet Ausdehnung < 80 % der Breite): ${describeCentre(narrow13.state)} | Zwang zurück: ${describeCentre(restored13.state)} | Seitenleiste ein: ${describeCentre(sidebar13.state)} | wieder aus: ${describeCentre(back13.state)}`,
    );

    // --- SH14. Text- und Split-Ansicht haben ein sichtbares Ende --------------------------------
    // Rand/Hintergrund des Editors (Computed Style), Abschluss der Flaeche und im Split eine Trennlinie; die
    // Hoehe von Editor und Modell-Spalte ueberschreitet die der Flaeche nicht.
    const endsExpr = `
      ${SHAPES_LEAF}
      const root = leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector(".tdcb-shapes-view");
      const editor = root?.querySelector(".tdcb-shapes-text .cm-editor");
      const text = root?.querySelector(".tdcb-shapes-text");
      const model = root?.querySelector(".tdcb-shapes-model");
      const body = root?.querySelector(".tdcb-shapes-body");
      if (!editor || !text || !body || text.classList.contains("is-hidden")) return null;
      const px = (v) => parseFloat(v) || 0;
      const e = getComputedStyle(editor);
      const t = getComputedStyle(text);
      const bd = getComputedStyle(body);
      const modelShown = !!model && !model.classList.contains("is-hidden");
      return {
        editorBorder: Math.max(px(e.borderTopWidth), px(e.borderBottomWidth), px(e.borderLeftWidth), px(e.borderRightWidth)),
        editorBg: e.backgroundColor,
        editorBox: e.boxSizing,
        paneBg: t.backgroundColor,
        bodyBottom: px(bd.borderBottomWidth),
        splitDivider: px(t.borderRightWidth),
        editorH: Math.round(editor.getBoundingClientRect().height),
        modelH: modelShown ? Math.round(model.getBoundingClientRect().height) : null,
        bodyH: Math.round(body.getBoundingClientRect().height),
        split: body.classList.contains("is-split"),
      };
    `;
    interface EndsState {
      editorBorder: number;
      editorBg: string;
      editorBox: string;
      paneBg: string;
      bodyBottom: number;
      splitDivider: number;
      editorH: number;
      modelH: number | null;
      bodyH: number;
      split: boolean;
    }
    const clickPill = async (mode: string): Promise<void> => {
      await cdp.evaluate(`
        ${SHAPES_LEAF}
        leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector('.tdcb-shapes-pill[data-mode="${mode}"]')?.click();
        await new Promise((r) => setTimeout(r, 500));
        return true;
      `);
    };
    const hasEnd = (s: EndsState): boolean =>
      (s.editorBorder > 0 || s.editorBg !== s.paneBg) && s.editorBox === "border-box" && s.bodyBottom > 0 && s.editorH <= s.bodyH;
    await clickPill("text");
    const textEnds = await pollState<EndsState>(cdp, endsExpr, hasEnd, 8_000);
    const wideNow = await cdp.evaluate<boolean>(`
      ${SHAPES_LEAF}
      return !!leafFor(${JSON.stringify(SMOKE_VIEW_SHAPES)})?.view.containerEl.querySelector('.tdcb-shapes-pill[data-mode="split"]:not([hidden])');
    `);
    let splitEnds: { state: EndsState | null; reached: boolean } | null = null;
    if (wideNow) {
      await clickPill("split");
      splitEnds = await pollState<EndsState>(
        cdp,
        endsExpr,
        (s) => hasEnd(s) && s.split && s.splitDivider > 0 && (s.modelH ?? 0) <= s.bodyH,
        8_000,
      );
    }
    const t14 = textEnds.state;
    const s14 = splitEnds?.state ?? null;
    record(
      "SH14. Text- und Split-Ansicht haben ein sichtbares Ende: Rahmen, Abschlusslinie, im Split eine Trennlinie, Höhen innerhalb der Fläche",
      textEnds.reached && (!wideNow || splitEnds?.reached === true),
      `Text: Rand ${t14?.editorBorder ?? "?"} px, Editor-Hintergrund ${t14?.editorBg ?? "?"} gegen Pane ${t14?.paneBg ?? "?"}, box-sizing ${t14?.editorBox ?? "?"} (erwartet border-box), Abschlusslinie ${t14?.bodyBottom ?? "?"} px, Editor ${t14?.editorH ?? "?"} px ≤ Fläche ${t14?.bodyH ?? "?"} px` +
        (wideNow
          ? ` | Split: Trennlinie ${s14?.splitDivider ?? "?"} px, Editor ${s14?.editorH ?? "?"} px, Modell ${s14?.modelH ?? "?"} px ≤ Fläche ${s14?.bodyH ?? "?"} px, is-split ${s14?.split ?? "?"}`
          : " | Split nicht angeboten (Breite < 700 px) — Split-Teil nicht gemessen"),
    );
    if (!wideNow) skipped("SH14b. Trennlinie im Split", "Ansichtsbreite unter 700 px — der Split-Fall wurde nicht gemessen");
    else record("SH14b. Trennlinie im Split", splitEnds?.reached === true, `Trennlinie ${s14?.splitDivider ?? "?"} px, Editor ${s14?.editorH ?? "?"} px, Modell ${s14?.modelH ?? "?"} px ≤ Fläche ${s14?.bodyH ?? "?"} px`);

    // --- SH15. Pfeiltasten schieben die Ansicht (Lesemodus-Block und Live Preview) -----------------
    // Ungemessen waren: bekommt die Flaeche per echtem Klick den Fokus (tabIndex -1: fokussierbar, kein
    // Tab-Stopp), und wirken ECHTE Tastendruecke (Input.dispatchKeyEvent) auf die Kamera? Pan aendert die drei
    // Winkel der Ansicht nicht (siehe B4), gemessen wird deshalb am Bild (Hash der Pixel). Im Live Preview
    // zusaetzlich: die Cursorzeile des Editors bleibt stehen (die Pfeiltasten gehen nicht an CodeMirror).
    const keysBody = ["# Pfeiltasten (automatisch erzeugt)", "", `${fence}shapes`, SHAPES_TABLE, fence, "", "Zeile danach", ""].join("\n");
    // Das Blatt trägt zwei Block-Bäume (Lesemodus und Editor), einer mit Canvas 0×0: nur den sichtbaren nehmen.
    const blockCanvas = `[...(app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view.containerEl.querySelectorAll(".tdcb-block canvas") ?? [])].find((c) => c.getBoundingClientRect().width > 0)`;
    const pressKey = async (key: "ArrowUp" | "ArrowLeft"): Promise<void> => {
      const vk = key === "ArrowLeft" ? 37 : 38;
      const common = { key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
    };
    interface KeysState {
      focused: boolean;
      tabIndex: number | null;
      hash: number | null;
      box: { cx: number; cy: number } | null;
      line: number | null;
    }
    const keysProbe = `
      ${SAMPLER}
      const view = app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view;
      const canvas = [...(view?.containerEl.querySelectorAll(".tdcb-block canvas") ?? [])].find((c) => c.getBoundingClientRect().width > 0);
      if (!canvas) return null;
      const s = sample(canvas);
      return {
        focused: document.activeElement === canvas,
        tabIndex: canvas.tabIndex,
        hash: s?.hash ?? null,
        box: s?.box ? { cx: s.box.cx, cy: s.box.cy } : null,
        line: view.editor?.getCursor?.().line ?? null,
      };
    `;
    const measureKeys = async (live: boolean): Promise<{ ready: boolean; detail: string; ok: boolean }> => {
      // Ein Block steht zuerst als Standbild (`.tdcb-play`) ohne Canvas: erst wecken (gemessen 2026-10-04, wie in PP5).
      await activateBlock(cdp, 0);
      const ready = await pollState<KeysState>(cdp, keysProbe, (s) => s.hash !== null && s.box !== null, 15_000);
      if (!ready.reached) {
        const dbg = await cdp.evaluate<string>(`${SAMPLER}
          const view = app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view;
          const cs = [...(view?.containerEl.querySelectorAll(".tdcb-block canvas") ?? [])];
          return JSON.stringify({ mode: view?.getMode?.(), canvases: cs.map((c) => { const r = c.getBoundingClientRect(); const s = r.width > 0 ? sample(c) : null; return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], px: [c.width, c.height], hash: s?.hash ?? null, box: s?.box ? "ja" : null }; }), posters: view?.containerEl.querySelectorAll(".tdcb-play").length });`);
        return { ready: false, ok: false, detail: `kein gezeichneter Block-Canvas im Blatt · ${dbg}` };
      }
      // Cursor in die Zeile NACH dem Block (nicht in den Block: im Live Preview zeigt ein Cursor im Block den Quelltext
      // statt des Widgets, der Canvas verschwindet).
      if (live) {
        const last = await cdp.evaluate<number>(`return app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view.editor?.lastLine?.() ?? 0;`);
        await setCursorLine(cdp, Math.max(0, last - 1));
      }
      const clicked = await clickReal(cdp, blockCanvas);
      await new Promise((r) => setTimeout(r, 400));
      const before = await cdp.evaluate<KeysState | null>(keysProbe);
      await pressKey("ArrowUp");
      await pressKey("ArrowLeft");
      await new Promise((r) => setTimeout(r, 700));
      const after = await cdp.evaluate<KeysState | null>(keysProbe);
      const moved = !!before && !!after && before.hash !== after.hash;
      const lineKept = !live || (before?.line !== null && before?.line === after?.line);
      const ok = clicked && before?.focused === true && moved && lineKept;
      return {
        ready: true,
        ok,
        detail: `Klick angekommen: ${clicked} · Fokus auf dem Canvas nach dem Klick: ${before?.focused} (erwartet true) · tabIndex ${before?.tabIndex} (erwartet -1) · Bild nach ↑ ← ${moved ? "verändert" : "IDENTISCH"} · Hüllbox-Mitte ${before?.box ? `${(before.box.cx * 100).toFixed(1)}/${(before.box.cy * 100).toFixed(1)}` : "?"} → ${after?.box ? `${(after.box.cx * 100).toFixed(1)}/${(after.box.cy * 100).toFixed(1)}` : "?"}` +
          (live ? ` · Cursorzeile ${before?.line} → ${after?.line} (erwartet gleich)` : ""),
      };
    };
    await closeExtraLeaves(cdp);
    // Wie PP5: der Öffner, der bei leerem Lesemodus neu rendert und den Block aktiviert (ein Block bleibt sonst als
    // Standbild mit unsichtbarem Canvas stehen, gemessen 2026-10-04).
    await ppOpenBlockNote(cdp, SMOKE_NOTE_KEYS, keysBody);
    const readKeys = await measureKeys(false);
    record("SH15. Pfeiltasten schieben die Ansicht eines Blocks im Lesemodus (echter Klick fokussiert, echte Tasten)", readKeys.ok, readKeys.detail);
    await closeExtraLeaves(cdp);
    const previousLive15 = await cdp.evaluate<unknown>(`return app.vault.getConfig("livePreview");`);
    try {
      await openInLivePreview(cdp, SMOKE_NOTE_KEYS);
      const liveKeys = await measureKeys(true);
      record("SH15b. Pfeiltasten schieben die Ansicht eines Blocks im Live Preview, die Cursorzeile des Editors bleibt", liveKeys.ok, liveKeys.detail);
    } finally {
      await cdp.evaluate(`app.vault.setConfig("livePreview", ${JSON.stringify(previousLive15)}); return true;`);
      await closeExtraLeaves(cdp);
    }

    // --- SH16. Die Hoehe des Editors folgt dem Text ------------------------------------------------
    // Regel (Johannes 2026-10-04): so hoch wie der Text (Zeilen x Zeilenhoehe + Rahmen/Padding), nach oben durch
    // die Flaeche begrenzt (dann scrollt er innen), Mindesthoehe drei Zeilen; im Split gilt dasselbe fuer die
    // Textspalte, das Modell bleibt so hoch wie die Flaeche. „Flaeche“ = der Inhaltsbereich der Textspalte
    // (`.tdcb-shapes-text` ohne Padding), das ist die Obergrenze des Editors. Die Zeilenhoehe wird an `.cm-line`
    // gemessen. Die drei Dateien legt der Punkt selbst an (Whitelist), das Aufraeumen loescht sie.
    const lineFile = (n: number): string => ["title: Zeilen", ...Array.from({ length: Math.max(n - 1, 0) }, (_, i) => `box T${i} size 0.2 at ${i} 0 0`)].join("\n");
    const heightExpr = (path: string): string => `
      ${SHAPES_LEAF}
      const root = leafFor(${JSON.stringify(path)})?.view.containerEl.querySelector(".tdcb-shapes-view");
      const editor = root?.querySelector(".tdcb-shapes-text .cm-editor");
      const text = root?.querySelector(".tdcb-shapes-text");
      const model = root?.querySelector(".tdcb-shapes-model");
      const scroller = root?.querySelector(".tdcb-shapes-text .cm-scroller");
      const content = root?.querySelector(".tdcb-shapes-text .cm-content");
      const line = root?.querySelector(".tdcb-shapes-text .cm-line");
      if (!editor || !text || !scroller || !content || !line || text.classList.contains("is-hidden")) return null;
      const px = (v) => parseFloat(v) || 0;
      const e = getComputedStyle(editor);
      const c = getComputedStyle(content);
      const t = getComputedStyle(text);
      const modelShown = !!model && !model.classList.contains("is-hidden");
      return {
        lh: line.getBoundingClientRect().height,
        lines: root.querySelectorAll(".tdcb-shapes-text .cm-line").length,
        editorH: editor.getBoundingClientRect().height,
        extras: px(e.borderTopWidth) + px(e.borderBottomWidth) + px(c.paddingTop) + px(c.paddingBottom),
        paneInner: text.getBoundingClientRect().height - px(t.paddingTop) - px(t.paddingBottom),
        bodyH: root.querySelector(".tdcb-shapes-body").getBoundingClientRect().height,
        scrolls: scroller.scrollHeight > scroller.clientHeight + 1,
        modelH: modelShown ? model.getBoundingClientRect().height : null,
        split: root.querySelector(".tdcb-shapes-body").classList.contains("is-split"),
      };
    `;
    interface HeightState {
      lh: number;
      lines: number;
      editorH: number;
      extras: number;
      paneInner: number;
      bodyH: number;
      scrolls: boolean;
      modelH: number | null;
      split: boolean;
    }
    const f1 = (v: number | null | undefined): string => (v === null || v === undefined ? "?" : v.toFixed(1));
    const describeHeight = (s: HeightState | null): string =>
      s === null
        ? "keine Textspalte"
        : `${s.lines} Zeilen à ${f1(s.lh)} px (+ ${f1(s.extras)} px Rahmen/Padding) → Editor ${f1(s.editorH)} px · Textspalte innen ${f1(s.paneInner)} px · Fläche ${f1(s.bodyH)} px · scrollt innen: ${s.scrolls}` +
          (s.modelH !== null ? ` · Modell ${f1(s.modelH)} px` : "");
    const openLines = async (path: string, text: string, mode: string): Promise<void> => {
      await cdp.evaluate(`
        const path = ${JSON.stringify(path)};
        if (!app.vault.getAbstractFileByPath(path)) await app.vault.create(path, ${JSON.stringify(text)});
        return true;
      `);
      createdNotes.add(path);
      await openFileInLeaf(cdp, path);
      await cdp.evaluate(`
        ${SHAPES_LEAF}
        await new Promise((r) => setTimeout(r, 500));
        leafFor(${JSON.stringify(path)})?.view.containerEl.querySelector('.tdcb-shapes-pill[data-mode="${mode}"]')?.click();
        await new Promise((r) => setTimeout(r, 700));
        return true;
      `);
    };
    // (1) fuenf Zeilen: etwa fuenf Zeilenhoehen, deutlich kleiner als die Flaeche
    await openLines(SMOKE_LINES_5, lineFile(5), "text");
    const five = await pollState<HeightState>(cdp, heightExpr(SMOKE_LINES_5), (s) => s.lines === 5, 10_000);
    const f5 = five.state;
    const five_ok = f5 !== null && Math.abs(f5.editorH - (5 * f5.lh + f5.extras)) <= f5.lh && f5.editorH < f5.bodyH * 0.5;
    // (2) 200 Zeilen: Editor = Textspalte innen (±2 px), scrollt innen
    await openLines(SMOKE_LINES_200, lineFile(200), "text");
    const many = await pollState<HeightState>(cdp, heightExpr(SMOKE_LINES_200), (s) => s.scrolls, 10_000);
    const f200 = many.state;
    const many_ok = f200 !== null && Math.abs(f200.editorH - f200.paneInner) <= 2 && f200.scrolls;
    // (3) eine leere Zeile: mindestens drei Zeilenhoehen
    await openLines(SMOKE_LINES_0, "", "text");
    const empty = await pollState<HeightState>(cdp, heightExpr(SMOKE_LINES_0), (s) => s.lh > 0, 10_000);
    const f0 = empty.state;
    const empty_ok = f0 !== null && f0.editorH >= 3 * f0.lh - 1;
    // (4) Split mit fuenf Zeilen: dieselbe Regel in der Textspalte, das Modell fuellt die Flaeche
    await openFileInLeaf(cdp, SMOKE_LINES_5);
    const wide16 = await cdp.evaluate<boolean>(`
      ${SHAPES_LEAF}
      return !!leafFor(${JSON.stringify(SMOKE_LINES_5)})?.view.containerEl.querySelector('.tdcb-shapes-pill[data-mode="split"]:not([hidden])');
    `);
    let f4: HeightState | null = null;
    let split_ok = true;
    if (wide16) {
      await cdp.evaluate(`
        ${SHAPES_LEAF}
        leafFor(${JSON.stringify(SMOKE_LINES_5)})?.view.containerEl.querySelector('.tdcb-shapes-pill[data-mode="split"]')?.click();
        await new Promise((r) => setTimeout(r, 800));
        return true;
      `);
      const sp = await pollState<HeightState>(cdp, heightExpr(SMOKE_LINES_5), (s) => s.split && s.lines === 5, 10_000);
      f4 = sp.state;
      split_ok = f4 !== null && Math.abs(f4.editorH - (5 * f4.lh + f4.extras)) <= f4.lh && f4.editorH < f4.bodyH * 0.5 && (f4.modelH ?? 0) >= f4.bodyH - 2;
    }
    record(
      "SH16. Die Höhe des Editors folgt dem Text: 5 Zeilen ≈ 5 Zeilenhöhen, 200 Zeilen = Textspalte und scrollen innen, leere Datei ≥ 3 Zeilenhöhen, Split dieselbe Regel",
      five_ok && many_ok && empty_ok && split_ok,
      `5 Zeilen (erwartet Editor = 5×Zeile + Rahmen/Padding ± 1 Zeile, < 50 % der Fläche): ${describeHeight(f5)} | 200 Zeilen (erwartet Editor = Textspalte innen ± 2 px, scrollt innen): ${describeHeight(f200)} | leer (erwartet ≥ 3 Zeilenhöhen): ${describeHeight(f0)} | Split, 5 Zeilen (erwartet wie die erste, Modell ≥ Fläche − 2 px): ${wide16 ? describeHeight(f4) : "Split nicht angeboten (Breite < 700 px) — nicht gemessen"}`,
    );
    if (!wide16) skipped("SH16b. Split-Teil der Editor-Höhe", "Ansichtsbreite unter 700 px — der Split-Fall wurde nicht gemessen");
    else record("SH16b. Split-Teil der Editor-Höhe", split_ok, `Split: Editor ${f4?.editorH ?? "?"} px, Fläche ${f4?.bodyH ?? "?"} px`);

    // --- SH17. Der Editor-Rahmen bleibt durchgezogen, auch im Fokus -----------------------------
    // CodeMirrors Basisthema setzt auf den fokussierten Editor `outline: 1px dotted #212121`; das sah wie ein
    // gepunkteter Rand aus. Erwartet: ohne Fokus Rand solid 1 px; im Fokus kein Outline (none oder Breite 0),
    // Rand weiter solid, Randfarbe im Fokus anders als ohne Fokus (der Fokus bleibt erkennbar).
    const frameExpr = `
      ${SHAPES_LEAF}
      const editor = leafFor(${JSON.stringify(SMOKE_LINES_5)})?.view.containerEl.querySelector(".tdcb-shapes-text .cm-editor");
      if (!editor) return null;
      const e = getComputedStyle(editor);
      return {
        focused: editor.classList.contains("cm-focused"),
        outlineStyle: e.outlineStyle,
        outlineWidth: parseFloat(e.outlineWidth) || 0,
        borderStyle: e.borderTopStyle,
        borderWidth: parseFloat(e.borderTopWidth) || 0,
        borderColor: e.borderTopColor,
      };
    `;
    interface FrameState {
      focused: boolean;
      outlineStyle: string;
      outlineWidth: number;
      borderStyle: string;
      borderWidth: number;
      borderColor: string;
    }
    await openFileInLeaf(cdp, SMOKE_LINES_5);
    await cdp.evaluate(`
      ${SHAPES_LEAF}
      leafFor(${JSON.stringify(SMOKE_LINES_5)})?.view.containerEl.querySelector('.tdcb-shapes-pill[data-mode="text"]')?.click();
      await new Promise((r) => setTimeout(r, 600));
      document.activeElement?.blur?.();
      await new Promise((r) => setTimeout(r, 300));
      return true;
    `);
    const idle17 = await pollState<FrameState>(cdp, frameExpr, (s) => !s.focused, 6_000, 250);
    const clicked17 = await clickReal(
      cdp,
      `app.workspace.getLeavesOfType(${JSON.stringify(SHAPES_VIEW_TYPE)}).find((l) => l.view.file?.path === ${JSON.stringify(SMOKE_LINES_5)})?.view.containerEl.querySelector(".tdcb-shapes-text .cm-content")`,
    );
    const focus17 = await pollState<FrameState>(cdp, frameExpr, (s) => s.focused, 6_000, 250);
    const i17 = idle17.state;
    const f17 = focus17.state;
    record(
      "SH17. Der Editor-Rahmen bleibt durchgezogen 1 px, im Fokus ohne gepunkteten Outline und mit anderer Randfarbe",
      i17 !== null &&
        f17 !== null &&
        clicked17 &&
        !i17.focused &&
        i17.borderStyle === "solid" &&
        i17.borderWidth === 1 &&
        f17.focused &&
        f17.borderStyle === "solid" &&
        f17.borderWidth === 1 &&
        (f17.outlineStyle === "none" || f17.outlineWidth === 0) &&
        f17.borderColor !== i17.borderColor,
      `ohne Fokus: Rand ${i17?.borderStyle ?? "?"} ${i17?.borderWidth ?? "?"} px ${i17?.borderColor ?? "?"}, Outline ${i17?.outlineStyle ?? "?"} ${i17?.outlineWidth ?? "?"} px (cm-focused: ${i17?.focused ?? "?"}) | Klick angekommen: ${clicked17} | im Fokus: Rand ${f17?.borderStyle ?? "?"} ${f17?.borderWidth ?? "?"} px ${f17?.borderColor ?? "?"}, Outline ${f17?.outlineStyle ?? "?"} ${f17?.outlineWidth ?? "?"} px (cm-focused: ${f17?.focused ?? "?"}) · Randfarbe wechselt: ${!!i17 && !!f17 && i17.borderColor !== f17.borderColor}`,
    );

    // --- SH9. Block -> Datei -------------------------------------------------
    const movedBody = [`title: ${MOVED_TITLE}`, "box A size 1", "box B size 0.5 at 1 0 0 color #ff0000"].join("\n");
    const noteHead = "# GUI-Smoke move (automatisch erzeugt)";
    await closeExtraLeaves(cdp);
    await openNote(cdp, SMOKE_NOTE_MOVE, [noteHead, "", `${fence}shapes`, movedBody, fence, ""].join("\n"), "source");
    await closeExtraLeaves(cdp);
    const cursor9 = await setCursorLine(cdp, 4);
    await clearNotices(cdp);
    const ran9 = await cdp.evaluate<boolean>(`return app.commands.executeCommandById(${JSON.stringify(CMD_BLOCK_TO_FILE)});`);
    const nine = await pollState<{ note: string; files: { path: string; text: string }[] }>(
      cdp,
      `
        const mine = app.vault.getFiles().filter((f) => f.name.startsWith(${JSON.stringify(MOVED_TITLE)}) && f.extension === "shapes");
        const note = await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_MOVE)}));
        const files = [];
        for (const f of mine) files.push({ path: f.path, text: await app.vault.read(f) });
        return { note, files };
      `,
      (s) => s.files.length > 0 && !s.note.includes("```shapes"),
      10_000,
    );
    const n9 = nine.state;
    const linkMatch = n9 ? /^(.*)\n\n```3d\nfile: (.+)\n```\n?$/s.exec(n9.note) : null;
    const movedPath = n9?.files[0]?.path ?? "";
    const linkResolves = linkMatch
      ? await cdp.evaluate<boolean>(`
          return app.metadataCache.getFirstLinkpathDest(${JSON.stringify(linkMatch[2])}, ${JSON.stringify(SMOKE_NOTE_MOVE)})?.path === ${JSON.stringify(movedPath)};
        `)
      : false;
    const notice9 = await notices(cdp);
    record(
      "SH9. Block → Datei: neue .shapes-Datei mit dem Blocktext, die Notiz verweist darauf",
      cursor9?.mode === "source" &&
        ran9 === true &&
        nine.reached &&
        n9?.files.length === 1 &&
        n9.files[0]?.text === `${movedBody}\n` &&
        linkMatch?.[1] === noteHead &&
        linkResolves,
      `Cursor-Zeile ${cursor9?.line ?? "?"} im Modus ${cursor9?.mode ?? "?"} · Befehl lief: ${ran9} · Dateien: ${n9?.files.map((f) => f.path).join(", ") || "keine"} · Text gleich Blocktext+LF: ${n9?.files[0]?.text === `${movedBody}\n`} · Verweis ${linkMatch ? JSON.stringify(linkMatch[2]) : "fehlt"} löst auf die Datei auf: ${linkResolves} · Meldung: ${notice9.slice(0, 80)}`,
    );

    // --- SH10. Datei -> Block: bei zwei Verweisen abgelehnt, bei einem durchgefuehrt --
    if (movedPath === "" || !linkMatch) {
      skipped("SH10. Datei → Block: abgelehnt bei zwei Verweisen, durchgeführt bei einem", "SH9 hat keine Datei erzeugt — nichts zum Zurückwandeln");
    } else {
      const link = linkMatch[2];
      const second = [`# Zweite Notiz`, "", `![[${link}]]`, ""].join("\n");
      await cdp.evaluate(`
        await app.vault.create(${JSON.stringify(SMOKE_NOTE_MOVE2)}, ${JSON.stringify(second)});
        return true;
      `);
      createdNotes.add(SMOKE_NOTE_MOVE2);
      const baseline = await cdp.evaluate<{ move: string; second: string; file: string }>(`
        const get = (p) => app.vault.read(app.vault.getAbstractFileByPath(p));
        return { move: await get(${JSON.stringify(SMOKE_NOTE_MOVE)}), second: await get(${JSON.stringify(SMOKE_NOTE_MOVE2)}), file: await get(${JSON.stringify(movedPath)}) };
      `);
      // Papierkorb: nur messbar, wenn Obsidian lokal in `.trash` ablegt; sonst (System-Papierkorb,
      // endgueltig) laesst sich der Verbleib von hier nicht pruefen und bleibt ungemessen.
      const trashProbe = (base: string): string => `
        const opt = app.vault.getConfig("trashOption");
        let count = 0;
        if (await app.vault.adapter.exists(".trash")) {
          const l = await app.vault.adapter.list(".trash");
          count = l.files.filter((p) => p.split("/").pop().startsWith(${JSON.stringify(base)})).length;
        }
        return { opt, count };
      `;
      const movedBase = (movedPath.split("/").pop() ?? "").replace(/\.shapes$/, "");
      const trashBefore = await cdp.evaluate<{ opt: string; count: number }>(trashProbe(movedBase));
      const cursorRefuse = await setCursorLine(cdp, 3);
      await clearNotices(cdp);
      const ranRefuse = await cdp.evaluate<boolean>(`return app.commands.executeCommandById(${JSON.stringify(CMD_FILE_TO_BLOCK)});`);
      const refused = await pollState<{ notice: string }>(
        cdp,
        `
          const text = [...document.querySelectorAll(".notice")].map((n) => n.textContent.trim()).join(" | ");
          return text.includes("is used in") || text.includes("is now a code block") ? { notice: text } : null;
        `,
        () => true,
        8_000,
        250,
      );
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const afterRefuse = await cdp.evaluate<{ move: string; second: string; fileExists: boolean }>(`
        const get = (p) => app.vault.read(app.vault.getAbstractFileByPath(p));
        return {
          move: await get(${JSON.stringify(SMOKE_NOTE_MOVE)}),
          second: await get(${JSON.stringify(SMOKE_NOTE_MOVE2)}),
          fileExists: !!app.vault.getAbstractFileByPath(${JSON.stringify(movedPath)}),
        };
      `);
      const refusalOk =
        cursorRefuse?.mode === "source" &&
        ranRefuse === true &&
        (refused.state?.notice ?? "").includes("is used in 2 places") &&
        afterRefuse.fileExists &&
        afterRefuse.move === baseline.move &&
        afterRefuse.second === baseline.second;

      // Zweite Notiz weg, dann genau ein Verweis: der Umzug laeuft.
      await cdp.evaluate(`
        await app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_MOVE2)}));
        await new Promise((r) => setTimeout(r, 500));
        return true;
      `);
      await setCursorLine(cdp, 3);
      await clearNotices(cdp);
      const ranDone = await cdp.evaluate<boolean>(`return app.commands.executeCommandById(${JSON.stringify(CMD_FILE_TO_BLOCK)});`);
      const done10 = await pollState<{ note: string; fileExists: boolean; sameName: number }>(
        cdp,
        `
          const note = await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_MOVE)}));
          return {
            note,
            fileExists: !!app.vault.getAbstractFileByPath(${JSON.stringify(movedPath)}),
            sameName: app.vault.getFiles().filter((f) => f.name === ${JSON.stringify(movedPath.split("/").pop() ?? "")}).length,
          };
        `,
        (s) => s.note.includes("```shapes") && !s.fileExists,
        10_000,
      );
      const trashAfter = await cdp.evaluate<{ opt: string; count: number }>(trashProbe(movedBase));
      const trashMeasurable = trashAfter.opt === "local";
      const trashOk = !trashMeasurable || trashAfter.count > trashBefore.count;
      const notice10 = await notices(cdp);
      const expectedNote = [noteHead, "", `${fence}shapes`, movedBody, fence, ""].join("\n");
      record(
        "SH10. Datei → Block: abgelehnt bei zwei Verweisen, durchgeführt bei einem",
        refusalOk && ranDone === true && done10.reached && done10.state?.sameName === 0 && trashOk && done10.state.note.replace(/\n+$/, "") === expectedNote.replace(/\n+$/, ""),
        `Ablehnung: Meldung ${JSON.stringify((refused.state?.notice ?? "keine").slice(0, 70))} · Datei blieb: ${afterRefuse.fileExists} · Notizen unverändert: ${afterRefuse.move === baseline.move && afterRefuse.second === baseline.second} · Umzug: Datei weg ${done10.state ? !done10.state.fileExists : "?"} · Dateien gleichen Namens ${done10.state?.sameName ?? "?"} · Papierkorb (${trashAfter.opt}): ${trashMeasurable ? `Kopie in .trash ${trashBefore.count} → ${trashAfter.count}` : "Verbleib von hier nicht messbar, nur „nicht im Vault“ geprüft"} · Notiz wieder mit shapes-Block und Originaltext: ${done10.state ? done10.state.note.replace(/\n+$/, "") === expectedNote.replace(/\n+$/, "") : "?"} · Meldung: ${notice10.slice(0, 60)}`,
      );
    }

    // --- SH11. Offene Ansicht mit ungespeichertem Tippen verliert nichts -----
    const liveLine = "box Frisch size 0.2 at 0 0 1 color #00ff00";
    await cdp.evaluate(`
      await app.vault.create(${JSON.stringify(SMOKE_LIVE_SHAPES)}, ${JSON.stringify(SHAPES_TABLE)});
      await app.vault.create(${JSON.stringify(SMOKE_NOTE_LIVE)}, ${JSON.stringify(["# Live", "", `${fence}3d`, `file: ${SMOKE_LIVE_SHAPES}`, fence, ""].join("\n"))});
      return true;
    `);
    createdNotes.add(SMOKE_LIVE_SHAPES);
    createdNotes.add(SMOKE_NOTE_LIVE);
    await openFileInLeaf(cdp, SMOKE_LIVE_SHAPES);
    const liveReady = await pollUntil<boolean>(
      cdp,
      `
        ${SHAPES_LEAF}
        const leaf = leafFor(${JSON.stringify(SMOKE_LIVE_SHAPES)});
        return leaf && cmOf(leaf) && leaf.view.getViewData() === ${JSON.stringify(SHAPES_TABLE)} ? true : null;
      `,
      10_000,
      250,
    );
    if (!liveReady) {
      record("SH11. Datei → Block bei offener Ansicht mit ungespeichertem Tippen verliert nichts", false, "Ansicht der Live-Datei kam nicht zustande");
    } else {
      await clearNotices(cdp);
      // Tippen, Platte pruefen und Befehl in EINEM Renderer-Aufruf: weit innerhalb der 2 s
      // Speicherverzoegerung. Steht die Zeile schon auf der Platte, wurde der Fall nicht erzeugt;
      // dann laeuft der Befehl NICHT, sondern es wird einmal neu getippt (nach dem Durchschreiben).
      const typedLines: string[] = [];
      const attempt = async (line: string): Promise<{ method: string; pending: boolean; ran: boolean; ms: number }> => {
        typedLines.push(line);
        return cdp.evaluate(`
          ${SHAPES_LEAF}
          const t0 = Date.now();
          const leaf = leafFor(${JSON.stringify(SMOKE_LIVE_SHAPES)});
          const method = typeAtEnd(leaf, ${JSON.stringify(`\n${line}`)});
          const disk = await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_LIVE_SHAPES)}));
          const pending = !disk.includes(${JSON.stringify(line)}) && leaf.view.getViewData().includes(${JSON.stringify(line)});
          const ran = pending ? app.commands.executeCommandById(${JSON.stringify(CMD_FILE_TO_BLOCK)}) : false;
          return { method, pending, ran, ms: Date.now() - t0 };
        `);
      };
      let fired = await attempt(liveLine);
      if (!fired.pending) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        fired = await attempt(`${liveLine.replace("Frisch", "Frisch2")}`);
      }
      if (!fired.pending) {
        const text = `der Ausgangsfall (getippt, noch nicht gespeichert) entstand auch im zweiten Versuch nicht: Eingabe per ${fired.method}, nach ${fired.ms} ms schon auf der Platte oder nicht im Ansichtspuffer`;
        if (fired.method === "dispatch") {
          record("SH11. Datei → Block bei offener Ansicht mit ungespeichertem Tippen verliert nichts", false, `${text} — der Editor nahm die Eingabe an (CM-View erreichbar), der Zustand ließ sich trotzdem nicht erzeugen`);
        } else {
          skipped("SH11. Datei → Block bei offener Ansicht mit ungespeichertem Tippen verliert nichts", `${text} (Rückfall-Eingabe per ${fired.method}, nicht über die CM-View)`);
        }
      } else {
        const fileState = `
          const note = await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_LIVE)}));
          return {
            note,
            fileExists: !!app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_LIVE_SHAPES)}),
            onFs: await app.vault.adapter.exists(${JSON.stringify(SMOKE_LIVE_SHAPES)}),
            views: app.workspace.getLeavesOfType(${JSON.stringify(SHAPES_VIEW_TYPE)}).length,
          };
        `;
        const eleven = await pollState<{ note: string; fileExists: boolean; onFs: boolean; views: number }>(
          cdp,
          fileState,
          (st) => st.note.includes("```shapes") && !st.fileExists && !st.onFs,
          10_000,
        );
        // Wiederauferstehung: ein veralteter Puffer koennte die Datei nach dem Papierkorb neu anlegen.
        // Ueber 3,5 s alle 250 ms messen, Index UND Dateisystem; EIN Auftauchen genuegt fuer Rot.
        // Der Poll beginnt erst nach dem Befehl (und nach dem erreichten Endzustand).
        let reappeared = false;
        for (let i = 0; i < 14 && eleven.reached; i++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const back = await cdp.evaluate<boolean>(`
            return !!app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_LIVE_SHAPES)}) ||
              app.vault.getFiles().some((f) => f.name === ${JSON.stringify(SMOKE_LIVE_SHAPES)}) ||
              (await app.vault.adapter.exists(${JSON.stringify(SMOKE_LIVE_SHAPES)}));
          `);
          if (back) reappeared = true;
        }
        const notice11 = await notices(cdp);
        const block = eleven.state?.note.includes(`${fence}shapes\n${[SHAPES_TABLE, ...typedLines].join("\n")}\n${fence}`) ?? false;
        record(
          "SH11. Datei → Block bei offener Ansicht mit ungespeichertem Tippen verliert nichts",
          fired.ran === true && eleven.reached && block && eleven.state?.fileExists === false && eleven.state.onFs === false && eleven.state.views === 0 && !reappeared,
          `${typedLines.length} Versuch(e) bis zum ausstehenden Speichern · Eingabe per ${fired.method}, Befehl ${fired.ms} ms nach dem Tippen (Zeile noch nicht auf der Platte) · Befehl lief: ${fired.ran} · Notiz trägt Block samt frischer Zeile(n): ${block} · Datei weg (Index/Dateisystem): ${eleven.state ? `${!eleven.state.fileExists}/${!eleven.state.onFs}` : "?"} · offene Ansichten danach: ${eleven.state?.views ?? "?"} · Datei binnen 3,5 s wieder aufgetaucht (Index oder Dateisystem): ${reappeared} · Meldung: ${notice11.slice(0, 70)}`,
        );
      }
    }

    // --- SH12. Befehle, Menüeinträge, Icons ---------------------------------
    const menuBlock = ["title: Menue", "box A size 1"].join("\n");
    await closeExtraLeaves(cdp);
    await openNote(
      cdp,
      SMOKE_NOTE_MENU,
      ["# Menü", "", `${fence}shapes`, ...menuBlock.split("\n"), fence, "", `![[${SMOKE_VIEW_SHAPES}]]`, ""].join("\n"),
      "source",
    );
    await closeExtraLeaves(cdp);
    // Zeile 0 = Ueberschrift, 3 = im Block, 7 = Embed-Zeile. Je Ort: Verfuegbarkeit laut
    // checkCallback UND das echte Kontextmenue — ein `contextmenu`-Ereignis an der Cursorposition,
    // gelesen wird das DOM (`.menu .menu-item`, Titel, Icon-<svg>). Ein Menue, das gar nicht
    // aufgeht (kein einziger Eintrag), ist KEINE Messung von „kein Eintrag“.
    interface MenuProbe {
      block: boolean;
      file: boolean;
      opened: boolean;
      titles: string[];
      iconOf: Record<string, boolean>;
    }
    const probe = async (line: number): Promise<MenuProbe | null> => {
      const placed = await setCursorLine(cdp, line);
      if (!placed) return null;
      const result = await cdp.evaluate<MenuProbe>(`
        const check = (id) => app.commands.commands[id].checkCallback(true) === true;
        const view = app.workspace.getMostRecentLeaf(app.workspace.rootSplit).view;
        const cm = view.editor.cm;
        const out = { block: check(${JSON.stringify(CMD_BLOCK_TO_FILE)}), file: check(${JSON.stringify(CMD_FILE_TO_BLOCK)}), opened: false, titles: [], iconOf: {} };
        const pos = view.editor.posToOffset(view.editor.getCursor());
        const rect = cm.coordsAtPos(pos);
        if (!rect) return out;
        const x = rect.left + 4, y = (rect.top + rect.bottom) / 2;
        const target = document.elementFromPoint(x, y) ?? cm.contentDOM;
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && document.querySelectorAll(".menu .menu-item").length === 0) {
          await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 200));
        const items = [...document.querySelectorAll(".menu .menu-item")];
        out.opened = items.length > 0;
        for (const item of items) {
          const title = item.querySelector(".menu-item-title")?.textContent?.trim() ?? "";
          out.titles.push(title);
          out.iconOf[title] = !!item.querySelector(".menu-item-icon svg");
        }
        // Menue schliessen: Escape, und zur Sicherheit wegklicken.
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
        if (document.querySelector(".menu")) document.body.click();
        await new Promise((r) => setTimeout(r, 200));
        return out;
      `);
      return result;
    };
    const registered = await cdp.evaluate<{ block: string; file: string }>(`
      return {
        block: app.commands.commands[${JSON.stringify(CMD_BLOCK_TO_FILE)}]?.name ?? "",
        file: app.commands.commands[${JSON.stringify(CMD_FILE_TO_BLOCK)}]?.name ?? "",
      };
    `);
    const onHeading = await probe(0);
    const inBlock = await probe(3);
    const onEmbed = await probe(7);
    const titleBlock = "Move shapes block into a file";
    const titleFile = "Move .shapes file into a code block";
    const count = (s: MenuProbe | null, t: string): number => s?.titles.filter((x) => x === t).length ?? -1;
    const gatingOk =
      onHeading !== null && inBlock !== null && onEmbed !== null &&
      !onHeading.block && !onHeading.file &&
      inBlock.block && !inBlock.file &&
      !onEmbed.block && onEmbed.file;
    const probes = [onHeading, inBlock, onEmbed];
    const menuMeasured = probes.every((p) => p !== null && p.opened);
    const menuOk =
      menuMeasured &&
      count(onHeading, titleBlock) === 0 && count(onHeading, titleFile) === 0 &&
      count(inBlock, titleBlock) === 1 && inBlock?.iconOf[titleBlock] === true && count(inBlock, titleFile) === 0 &&
      count(onEmbed, titleFile) === 1 && onEmbed?.iconOf[titleFile] === true && count(onEmbed, titleBlock) === 0;
    const namesOk =
      registered.block.endsWith("Move shapes block into a .shapes file") && registered.file.endsWith("Move .shapes file into a code block");
    const describe = (s: MenuProbe | null): string =>
      s ? `${s.opened ? "Menü offen" : "Menü NICHT offen"}: Block-Eintrag ${count(s, titleBlock)}${s.iconOf[titleBlock] ? " mit svg" : ""}, Datei-Eintrag ${count(s, titleFile)}${s.iconOf[titleFile] ? " mit svg" : ""}` : "Cursor nicht setzbar";
    if (menuMeasured) {
      record(
        "SH12. Befehle sind registriert und nur am richtigen Ort verfügbar",
        namesOk && gatingOk,
        `Namen: ${registered.block} / ${registered.file} · verfügbar (Überschrift | im Block | auf Embed) Block→Datei ${onHeading?.block}|${inBlock?.block}|${onEmbed?.block}, Datei→Block ${onHeading?.file}|${inBlock?.file}|${onEmbed?.file} · Kontextmenü Überschrift [${describe(onHeading)}] · im Block [${describe(inBlock)}] · auf Embed [${describe(onEmbed)}]`,
      );
      record("SH12b. Kontextmenü-Einträge mit Icon", menuOk, `Block-Eintrag ${count(inBlock, titleBlock)}${inBlock?.iconOf[titleBlock] ? " mit svg" : ""} im Block, Datei-Eintrag ${count(onEmbed, titleFile)}${onEmbed?.iconOf[titleFile] ? " mit svg" : ""} auf dem Embed, keiner auf der Überschrift`);
    } else {
      record(
        "SH12. Befehle sind registriert und nur am richtigen Ort verfügbar",
        namesOk && gatingOk,
        `Namen: ${registered.block} / ${registered.file} · verfügbar (Überschrift | im Block | auf Embed) Block→Datei ${onHeading?.block}|${inBlock?.block}|${onEmbed?.block}, Datei→Block ${onHeading?.file}|${inBlock?.file}|${onEmbed?.file}`,
      );
      skipped(
        "SH12b. Kontextmenü-Einträge mit Icon",
        `das Kontextmenü ging per contextmenu-Ereignis nicht auf (Überschrift [${describe(onHeading)}], im Block [${describe(inBlock)}], auf Embed [${describe(onEmbed)}]) — nur Befehle und Verfügbarkeit gemessen`,
      );
    }
  } finally {
    // Eigene Dateien am Abschnittsende wegraeumen (cleanupState bleibt das Netz): sie sollen nicht
    // durch `edit`, `cameras` und `clickrace` leben.
    await cdp
      .evaluate(`
        ${SHAPES_WIPE}
        return true;
      `)
      .catch(() => undefined);
    await cdp
      .evaluate(`
        if (${sidebars.left}) app.workspace.leftSplit.expand();
        if (${sidebars.right}) app.workspace.rightSplit.expand();
        return true;
      `)
      .catch(() => undefined);
  }
}

// --- PP1–PP9. Prompt-Panel gegen einen Ersatz-Endpunkt --------------------------
// Eigener Abschnitt (`--section promptpanel`). **Der Ersatz-Endpunkt prüft die Verdrahtung, nicht das LLM:**
// ein lokaler HTTP-Server (`node:http`, Port 0) antwortet mit AUFGEZEICHNETEN Modellantworten aus den
// Fixtures (Erzeugen: Spike A, Eintrag A02; Verfeinern: Lab-Lauf 2026-10-03, Fall R01). Er sagt nichts über
// die Qualität eines Modells — dafür gibt es die Messzeile und docs/LAB.md.
//
// Zustand, den dieser Abschnitt anlegt, wird VOR dem Lauf zurückgesetzt UND beim Aufräumen entfernt
// (CORE-TEST-21: ein `finally` erreicht einen Abbruch nicht — `ppCleanup` hängt deshalb auch in `cleanupState`):
// die Ersatz-Endpunktzeile in den Plugin-Einstellungen, das Panel-Blatt, `acceptAs`, die vier Notizen
// (`_tdcb-gui-smoke-pp-*.md`, jede wird zu Beginn neu geschrieben) und der Server.
const PANEL_VIEW_TYPE = "tdcb-prompt-panel";
const SMOKE_NOTE_PP_NEW = "_tdcb-gui-smoke-pp-new.md";
const SMOKE_NOTE_PP_EDIT = "_tdcb-gui-smoke-pp-edit.md";
const SMOKE_NOTE_PP_STALE = "_tdcb-gui-smoke-pp-stale.md";
const SMOKE_NOTE_PP_BLANK = "_tdcb-gui-smoke-pp-blank.md";
const PP_NOTES = [SMOKE_NOTE_PP_NEW, SMOKE_NOTE_PP_EDIT, SMOKE_NOTE_PP_STALE, SMOKE_NOTE_PP_BLANK];
const PP_ENDPOINT_ID = "tdcb-smoke-ep";
const PP_MODEL = "smoke-model";
/** Abstand zwischen den drei Stücken einer Antwort: gross genug, dass der Transport sie nicht zu einem
 *  Fortschrittsereignis verschmilzt und der Tail sichtbar in drei Ständen wächst. */
const PP_CHUNK_DELAY_MS = 800;
const PP_IDS = ["PP1", "PP2", "PP3", "PP4", "PP5", "PP6", "PP7", "PP8", "PP9", "PP10", "PP11", "PP12", "PP13", "PP14", "PP15", "PP16", "PP17", "PP18", "PP19", "PP20"] as const;
const PP_TITEL = {
  PP1: "Settings zeigen den LLM-Abschnitt (Endpunkt-Zeile und Anfrage)",
  PP2: "Panel öffnet mit Hub, Messzeile und Beispiel-Platzhalter",
  PP3: "Erzeugen streamt in Stücken und zeigt eine Vorschau",
  PP4: "Übernehmen als Codeblock schreibt einen shapes-Block in die Notiz",
  PP5: "Ändern über die Aktionsleiste: Ziel, Diff, nur die Platte-Zeile ändert sich",
  PP6: "Abbruch: „Stopped.“, keine Runde, der Server sah den Abbruch",
  PP7: "Aktionsleiste: jeder Knopf trägt ein Icon, „Edit in prompt panel“ öffnet das Panel",
  PP8: "Übernehmen nach Handänderung am Block wird abgelehnt, Notiz unverändert",
  PP9: "Block mit Leerzeile am Rumpfende: Übernehmen wendet an oder lehnt sicher ab",
  PP10: "Die Ersatz-Zeile ist ERREICHBAR (Status is-ok, Modell in der Liste), nicht nur vorhanden",
  PP12: "Altwert llmModel im data.json: nach dem Laden steht er in der Zeile, der Schlüssel ist weg, keine Zeile „Model“, keine Option „global model“",
  PP13: "Folge-Regel: Hochscrollen mitten im Strom wird respektiert",
  PP14: "Kontrolle: ohne Störung folgt der Strom bis zum Ende",
  PP15: "Denkblock live: der Denk-Text ist während des Stroms sichtbar und wächst",
  PP16: "Kontrolle mit absatzgroßen Stücken: der Strom folgt auch dann bis zum Ende",
  PP17: "Wiederaufnahme: steht der Nutzer nach dem Hochscrollen wieder unten, folgt der Strom wieder",
  PP18: "Gemma 4 ohne Öffner: der Denktext steht im Denkblock, nicht im Antwortbereich, und die Antwort wird gelesen",
  PP20: "Denkblock kopierbar: der Kopier-Knopf erscheint erst mit Denk-Text, kopiert ihn in die Zwischenablage, quittiert am Knopf und klappt den Block nicht um",
  PP19: "Lange Zeile im Antwortbereich: nichts ragt rechts aus der Box des Streams, der Rumpf rollt nicht waagerecht",
  PP11: "Panel mit zwei Runden, Diff-Liste und langem Denkblock: Apply/Discard erreichbar, die lange „Done“-Zeile überlagert die Vorschau-Beschriftung nicht, Stream nicht zusammengefallen",
} as const;
const PP_CREATE_PROMPT = "A table: top 1.2 x 0.7 m, four legs, 0.75 m high.";
const PP_REFINE_PROMPT = "Raise the table top by 20 cm.";
const PP_STALE_MESSAGE = "The block changed — nothing was applied.";
const PP_EDIT_LABEL = "Edit in prompt panel";
/** Selektor der Formen, die ein Lucide-Icon in seinem `<svg>` trägt — ein leeres `<svg>` (unbekannte Icon-ID) hat keine. */
const PP_ICON_SHAPE = "svg path, svg line, svg circle, svg rect, svg polyline, svg polygon, svg ellipse";

/** Punkte, die dieser Lauf gemessen oder als „nichts gemessen“ verbucht hat. Was am Ende fehlt (Abbruch
 *  mitten im Abschnitt), wird im `finally` als „nichts gemessen“ nachgetragen, nie als gruen. */
const ppDone = new Set<string>();
function ppRecord(id: string, title: string, passed: boolean, detail: string): void {
  ppDone.add(id);
  record(`${id}. ${title}`, passed, detail);
}
function ppNothing(id: string, title: string, reason: string): void {
  ppDone.add(id);
  nothingMeasured(`${id}. ${title}`, reason);
}

interface Substitute {
  url: string;
  /** Wahr: nach dem ersten Stück schweigen (PP6) — die Verbindung bleibt offen, bis der Client sie schliesst. */
  hang: boolean;
  /** Nicht leer: jede Chat-Antwort traegt diesen Denk-Text (PP11: langer Denkblock ueber einer langen „Done“-Zeile). */
  reasoning: string;
  requests: { kind: "create" | "refine" | "models" | "unknown"; stream: boolean }[];
  /** Chat-Verbindungen, die der Client schloss, bevor der Server fertig war. */
  clientClosed: number;
  /** Laufende Generierungen (der Strom ist noch offen). */
  unterwegs: number;
  /** Methode und Pfad jeder Anfrage, die der strenge Stub mit 404 beantwortete (Mitschnitt). */
  unknownPaths: string[];
  /** Die nächste Chat-Antwort ist diese (statt der Fixture-Antwort), danach gilt wieder die Fixture. */
  queue(antwort: Antwort): void;
  close(): Promise<void>;
}

let ppSubstitute: Substitute | null = null;
let ppOriginalAcceptAs: unknown = null;

/** Der Ersatz-Endpunkt: der zentrale LLM-Stub (`tools/obsidian-cdp/llm-stub.ts`). Strenge Pfade, LM-Studio-404,
 *  drei Stücke im Takt, `hang` und der Zähler für vom Client geschlossene Verbindungen sind dort Schalter. */
async function startSubstitute(answers: { create: string; refine: string }): Promise<Substitute> {
  const kindOf = (a: StubAnfrage): "create" | "refine" | "models" | "unknown" => {
    if (a.route === "models") return "models";
    if (a.route !== "chat") return "unknown";
    const system = (a.json as { messages?: { role?: string; content?: unknown }[] } | null)?.messages?.find((m) => m.role === "system")?.content;
    return typeof system === "string" && system.includes("Du änderst") ? "refine" : "create";
  };
  const state = { hang: false, reasoning: "" };
  const stub = await startLlmStub({
    models: [PP_MODEL],
    takt: PP_CHUNK_DELAY_MS,
    teile: 3,
    antwort: (a) => ({ text: kindOf(a) === "refine" ? answers.refine : answers.create, ...(state.hang ? { haengtNach: 1 } : {}), ...(state.reasoning !== "" ? { reasoning: state.reasoning } : {}) }),
  });
  return {
    url: stub.urlV1,
    get hang() { return state.hang; },
    set hang(v: boolean) { state.hang = v; },
    get reasoning() { return state.reasoning; },
    set reasoning(v: string) { state.reasoning = v; },
    get requests() { return stub.anfragen().map((a) => ({ kind: kindOf(a), stream: a.stream === true })); },
    get clientClosed() { return stub.zaehler().clientGeschlossen; },
    get unterwegs() { return stub.zaehler().unterwegs; },
    get unknownPaths() { return stub.anfragen().filter((a) => kindOf(a) === "unknown").map((a) => `${a.methode} ${a.pfad}`); },
    queue: (antwort) => stub.antworten([antwort]),
    close: () => stub.stop(),
  };
}

/** Die aufgezeichneten Antworten aus den Fixtures — oder der Grund, warum es sie nicht gibt. */
function loadPpAnswers(): { ok: true; create: string; refine: string; sources: string } | { ok: false; reason: string } {
  const read = (file: string, id: string): string | null => {
    if (!existsSync(file)) return null;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const rec = JSON.parse(line) as { id?: string; answer?: string };
      if (rec.id?.startsWith(id) && typeof rec.answer === "string") return rec.answer;
    }
    return null;
  };
  const createFile = "tests/fixtures/shapes-spike/a-q27-dsl.jsonl";
  const refineFile = "tests/fixtures/shapes-lab/qwen3.8-27b-refine-2026-10-03-71051822.jsonl";
  const create = read(createFile, "A02");
  const refine = read(refineFile, "R01");
  if (create === null) return { ok: false, reason: `kein Eintrag A02 mit Feld answer in ${createFile}` };
  if (refine === null) return { ok: false, reason: `kein Eintrag R01 mit Feld answer in ${refineFile}` };
  // Gegen das AKTUELLE Protokoll prüfen: eine Aufzeichnung, die der heutige Leser ablehnt, würde als
  // „Plugin-Fehler“ erscheinen, obwohl der Ersatz falsch antwortet.
  const parts = readPartsAnswer(create);
  if (!parts.ok || parts.parts.length === 0) return { ok: false, reason: `A02 ist für das aktuelle Protokoll nicht lesbar (${parts.ok ? "keine Teile" : parts.reason})` };
  const changes = readChangesAnswer(refine);
  if (!changes.ok || changes.changes.length === 0 || changes.dropped.length > 0) {
    return { ok: false, reason: `R01 ist für das aktuelle Protokoll nicht lesbar (${changes.ok ? `${changes.dropped.length} verworfen` : changes.reason})` };
  }
  return { ok: true, create, refine, sources: `Erzeugen ${createFile} A02.answer · Verfeinern ${refineFile} R01.answer` };
}

/** Renderer-Schnipsel: Ersatz-Zeile und Ersatz-Modell aus den Einstellungen nehmen, Panel-Blätter schliessen.
 *  Speichert nur, wenn etwas zu entfernen war. Liefert, was entfernt wurde. */
const PP_RESET = `
  const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
  const removed = [];
  if (plugin) {
    const isSmoke = (e) => e && (e.id === ${JSON.stringify(PP_ENDPOINT_ID)} || (e.model === ${JSON.stringify(PP_MODEL)} && /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/v1$/.test(e.url ?? "")));
    const before = Array.isArray(plugin.settings.endpoints) ? plugin.settings.endpoints : [];
    const kept = before.filter((e) => !isSmoke(e));
    let changed = kept.length !== before.length;
    for (const e of before) if (isSmoke(e)) removed.push(e.url);
    if (changed) plugin.settings.endpoints = kept;
    if (changed) { await plugin.saveSettings?.(); plugin.llm?.invalidate?.(); }
  }
  app.workspace.detachLeavesOfType(${JSON.stringify(PANEL_VIEW_TYPE)});
  await new Promise((r) => setTimeout(r, 200));
  return removed;
`;

/** Strom-Probe im Prompt-Panel (PP13–PP17): ein langer Strom aus tokengrossen Stuecken (8 Zeichen, 20 ms), dessen Tail den
 *  auf `max-height: 14em` begrenzten Rumpf (`.okit-stream-body`, der Scroll-Container) ueberlaufen laesst. Die Folge-Regel misst
 *  `messeFolge` der Bruecke (README § Folge-Messung: Kontrolle, Stoerung `scrollTop = 0`, Wiederaufnahme); hier bleibt, was die
 *  Bruecke nicht kennt: der Denk-Text (PP15) und das Starten des Stroms im Panel. */
const PP_STREAM_UNIT = 8;
const PP_STREAM_TAKT_MS = 20;
const PP_STREAM_REASONING = "Ich ueberlege die Teile des Tisches: Platte, vier Beine, Masse, Lage. ".repeat(6);
const PP_STREAM_BODY = ".tdcb-prompt .tdcb-prompt-stream .okit-stream-body";
const ppStreamAnswer = (teile = 45): string => {
  const parts = Array.from({ length: teile }, (_, i) => ({ name: `Teil-${i + 1}`, shape: "box", size: [0.1, 0.1, 0.1], at: [i * 0.05, 0.5, 0], color: "#8b5a2b" }));
  return JSON.stringify({ parts });
};
interface PpReasoningRow { rl: number; open: boolean; vis: boolean }

interface PpStreamForm { unit: number; takt: number; reasoning: string; teile: number }
const PP_STREAM_TOKEN: PpStreamForm = { unit: PP_STREAM_UNIT, takt: PP_STREAM_TAKT_MS, reasoning: PP_STREAM_REASONING, teile: 45 };
/** Absatzgrosse Stuecke (ein Push mit mehreren Zeilen, ~6 Zeilen im 14em-Rumpf): bei „unten?“ erst NACH dem Wachsen gemessen
 *  (obsidian-kit < 0.59.0) springt der Abstand ueber die Folge-Schwelle von 40 px, und der Strom folgt nach dem ersten Absatz nicht mehr. */
const PP_STREAM_PARAGRAPH: PpStreamForm = { unit: 300, takt: 150, reasoning: "", teile: 45 };
/** Fuer die Wiederaufnahme: die dritte Phase (Kontrolle, Stoerung, Wiederaufnahme) braucht einen laengeren Strom; der Hebel ist
 *  die Antwortlaenge (README § Folge-Messung), nie die Schwelle. */
const PP_STREAM_LANG: PpStreamForm = { unit: PP_STREAM_UNIT, takt: PP_STREAM_TAKT_MS, reasoning: "", teile: 120 };

interface PpStreamOptionen { kontrolle: boolean; stoerung: boolean; wiederaufnahme: boolean }

/** Ein Strom im Panel, gemessen mit `messeFolge`. `null`: das Panel oeffnete nicht oder das Eingabefeld fehlte (Umgebung, kein Befund).
 *  `reasoning` sind die Staende des Denk-Textes (leer, wenn die Form keinen sendet). */
async function ppStromMessen(
  cdp: Cdp,
  sub: Substitute,
  opt: PpStreamOptionen,
  form: PpStreamForm = PP_STREAM_TOKEN,
): Promise<{ ergebnis: Awaited<ReturnType<typeof messeFolge>>; finalPhase: string; reasoning: PpReasoningRow[] } | null> {
  if (!(await ppOpenFresh(cdp))) return null;
  await ppType(cdp, PP_CREATE_PROMPT);
  sub.queue({
    text: ppStreamAnswer(form.teile),
    ...(form.reasoning !== "" ? { reasoning: form.reasoning } : {}),
    laenge: form.unit,
    takt: form.takt,
    nachlaufMs: 8 * form.takt,
  });
  // Beobachter fuer den Denk-Text (PP15): die Bruecke kennt ihn nicht. Haengt vor dem Start des Stroms.
  const armed = await cdp.evaluate<boolean>(`
    const area = document.querySelector(".tdcb-prompt .tdcb-prompt-stream");
    if (!area) return false;
    window.__ppReasoning = [];
    window.__ppReasoningObs?.disconnect();
    let prevRl = 0;
    window.__ppReasoningObs = new MutationObserver(() => {
      const pre = area.querySelector(".okit-stream-reasoning > pre");
      const det = area.querySelector(".okit-stream-reasoning");
      const rl = pre ? (pre.textContent ?? "").length : 0;
      if (rl <= prevRl) return;
      prevRl = rl;
      window.__ppReasoning.push({ rl, open: det ? det.open : false, vis: pre ? pre.getBoundingClientRect().height > 0 : false });
    });
    window.__ppReasoningObs.observe(area, { childList: true, characterData: true, subtree: true });
    return true;
  `);
  if (!armed) return null;
  const ergebnis = await messeFolge(cdp, {
    selector: PP_STREAM_BODY,
    laeuft: () => sub.unterwegs > 0,
    starte: () => ppClick(cdp, ".tdcb-prompt-send"),
    kontrolle: opt.kontrolle,
    stoerung: opt.stoerung,
    wiederaufnahme: opt.wiederaufnahme,
    takt: Math.min(100, form.takt),
  });
  const run = await pollState<PpState>(cdp, PP_READ, (st) => st.phase === "ok" || st.phase === "error", 60_000, 300);
  const reasoning = await cdp.evaluate<PpReasoningRow[]>(`window.__ppReasoningObs?.disconnect(); return window.__ppReasoning ?? [];`);
  return { ergebnis, finalPhase: run.state?.phase ?? "?", reasoning };
}

/** Wie `cleanupState` und das `finally` des Abschnitts es brauchen: schliesst Server, räumt die Einstellungen,
 *  stellt `acceptAs` zurück. Wirft nie. */
async function ppCleanup(cdp: Cdp): Promise<void> {
  const sub = ppSubstitute;
  ppSubstitute = null;
  if (sub) await sub.close().catch(() => undefined);
  if (ppSettingsOpened) {
    ppSettingsOpened = false;
    await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
  }
  await cdp.evaluate(PP_RESET).catch(() => undefined);
  if (ppOriginalAcceptAs !== null) {
    const value = ppOriginalAcceptAs;
    ppOriginalAcceptAs = null;
    await setSetting(cdp, "acceptAs", value).catch(() => undefined);
  }
}

interface PpState {
  phase: string;
  status: string;
  tail: string;
  target: string;
  send: string;
  rounds: number;
  diff: string[];
  previewVisible: boolean;
  colors: number;
  stopVisible: boolean;
  applyDisabled: boolean;
  sendDisabled: boolean;
}

/** Renderer-Schnipsel: der sichtbare Stand des Panels (oder `null`, wenn keines offen ist). */
const PP_READ = `
  ${SAMPLER}
  const root = document.querySelector(".tdcb-prompt");
  if (!root) return null;
  const statusRow = root.querySelector(".tdcb-prompt-status");
  const phase = ["checking", "ok", "error", "warning"].find((p) => statusRow?.classList.contains("is-" + p)) ?? "idle";
  const canvas = root.querySelector(".tdcb-prompt-preview canvas");
  const wrap = root.querySelector(".tdcb-prompt-preview");
  return {
    phase,
    status: statusRow?.querySelector(".tdcb-prompt-status-label")?.textContent ?? "",
    tail: root.querySelector(".okit-stream-tail")?.textContent ?? "",
    target: root.querySelector(".tdcb-prompt-target")?.textContent ?? "",
    send: root.querySelector(".tdcb-prompt-send")?.textContent ?? "",
    rounds: app.workspace.getLeavesOfType("tdcb-prompt-panel")[0]?.view?.state?.()?.rounds?.rounds?.length ?? 0,
    diff: [...root.querySelectorAll(".tdcb-prompt-diff li")].map((l) => l.textContent ?? ""),
    previewVisible: !!wrap && !wrap.classList.contains("is-hidden"),
    colors: canvas ? (sample(canvas)?.colors ?? 0) : 0,
    stopVisible: !!root.querySelector(".tdcb-prompt-stop:not(.is-hidden)"),
    applyDisabled: root.querySelector(".tdcb-prompt-apply")?.disabled ?? true,
    sendDisabled: root.querySelector(".tdcb-prompt-send")?.disabled ?? true,
  };
`;


/** PP1 lässt die Einstellungen offen (siehe dort); `ppCleanup` schließt sie am Ende des Laufs. */
let ppSettingsOpened = false;

const ppRead = (cdp: Cdp): Promise<PpState | null> => cdp.evaluate<PpState | null>(PP_READ);
const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Die Seitenleiste gleitet beim Einblenden herein (gemessen: ~1 s, x = Fensterbreite → Sollbreite); ein echter Klick
 *  vorher trifft ausserhalb des Fensters und tut nichts. Warten, bis das Panel ganz im Fenster steht. */
async function ppWaitPanelInside(cdp: Cdp): Promise<boolean> {
  const settled = await pollState<{ inside: boolean }>(
    cdp,
    `const r = document.querySelector(".tdcb-prompt")?.getBoundingClientRect(); return r ? { inside: r.width > 0 && r.left >= 0 && r.right <= innerWidth } : null;`,
    (s) => s.inside,
    10_000,
    200,
  );
  return settled.reached;
}


/** Das Panel frisch öffnen (Blatt zu, Befehl `open-prompt-panel`, Ziel „new“) und warten, bis es steht. */
async function ppOpenFresh(cdp: Cdp): Promise<boolean> {
  await cdp.evaluate(`app.workspace.detachLeavesOfType(${JSON.stringify(PANEL_VIEW_TYPE)}); await new Promise((r) => setTimeout(r, 300)); return true;`);
  await cdp.evaluate(`await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-prompt-panel`)}); return true;`);
  const up = await pollState<PpState>(cdp, PP_READ, (s) => s.send !== "", 10_000, 250);
  if (!up.reached) return false;
  return ppWaitPanelInside(cdp);
}

/** Text ins Eingabefeld des Panels schreiben (das Panel liest `value` beim Senden). */
async function ppType(cdp: Cdp, text: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`
    const ta = document.querySelector(".tdcb-prompt .tdcb-prompt-input");
    if (!ta) return false;
    ta.value = ${JSON.stringify(text)};
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `);
}

/** Echter Mausklick auf einen Knopf des Panels. */
const ppClick = (cdp: Cdp, selector: string): Promise<boolean> =>
  clickReal(cdp, `document.querySelector(${JSON.stringify(`.tdcb-prompt ${selector}`)})`);

/** Den Knopf mit dieser Beschriftung in der Aktionsleiste des ersten Blocks im Lesemodus klicken. */
const ppClickActionButton = (cdp: Cdp, label: string): Promise<boolean> =>
  clickReal(
    cdp,
    `([...document.querySelectorAll(".workspace-leaf-content[data-type='markdown'] .tdcb-block .tdcb-toolbar-button")].find((b) => b.getAttribute("aria-label") === ${JSON.stringify(label)} && b.getBoundingClientRect().width > 0))`,
  );

/** Notiztext von der Platte lesen. */
const ppReadNote = (cdp: Cdp, path: string): Promise<string> =>
  cdp.evaluate<string>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    return file ? await app.vault.read(file) : "";
  `);

/** Das Fenster muss JETZT sichtbar sein (Lesemodus rendert in einem verdeckten Fenster nichts, 0 Bilder je Sekunde): nach
 *  der Brücke fiel es gemessen 2026-10-04 mitten im Lauf wieder auf hidden. Hidden → show/moveTop/focus, danach pollen. */
async function ppEnsureVisible(cdp: Cdp): Promise<string> {
  const now = await cdp.evaluate<string>(`return document.visibilityState;`);
  if (now === "visible") return "sichtbar";
  await cdp.evaluate(`const w = window.require("electron").remote.getCurrentWindow(); if (w.isMinimized()) w.restore(); w.show(); w.moveTop(); w.focus(); return true;`).catch(() => undefined);
  const later = await pollUntil(cdp, `return document.visibilityState === "visible" ? true : null;`, 5000, 300);
  return later ? "war hidden, geholt" : "bleibt hidden";
}

/** Eine Notiz mit Tisch-Block im Lesemodus öffnen und warten, bis der Block samt Aktionsleiste steht.
 *  `null` = der Block rendert nicht (Umgebung, nicht Befund).
 *
 *  Der Lesemodus rendert nach dem Öffnen gelegentlich GAR NICHTS (gemessen 2026-10-04: Sizer ohne Abschnitte, 0 Blöcke,
 *  0 Standbilder, 0 roher Codeblock — nach dem Schließen der Seitenleiste in 1 von 3 Läufen). Erst neu rendern lassen
 *  (`previewMode.rerender(true)`), dann die Notiz neu öffnen; erst danach heißt es „rendert nicht“. */
async function ppOpenBlockNote(
  cdp: Cdp,
  path: string,
  body: string,
): Promise<{ buttons: { label: string; svg: boolean; children: number }[] } | null> {
  createdNotes.add(path);
  const visibility = await ppEnsureVisible(cdp);
  if (visibility !== "sichtbar") console.log(`  (Fenster vor ${path}: ${visibility})`);
  const open = async (): Promise<void> => {
    const diag = await cdp.evaluate<string>(`
      try {
        const path = ${JSON.stringify(path)};
        const body = ${JSON.stringify(body)};
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing) await app.vault.modify(existing, body);
        else await app.vault.create(path, body);
        const file = app.vault.getAbstractFileByPath(path);
        // Ein NEUES Blatt statt des zuletzt benutzten: ein Blatt, das vorher im Quellmodus stand (PP4), rendert den
        // Lesemodus danach in der Zweitinstanz gelegentlich gar nicht (gemessen 2026-10-04, auch mit Build 52d8134;
        // ein frisches Blatt renderte in jedem Versuch). Die alten Markdown-Blätter danach schließen.
        const old = app.workspace.getLeavesOfType("markdown");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file, { state: { mode: "preview" } });
        for (const l of old) l.detach();
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await new Promise((r) => setTimeout(r, 200));
        return "ok";
      } catch (e) { return "FEHLER " + (e && e.stack ? e.stack : String(e)); }
    `);
    if (diag !== "ok") console.log(`  (openNote ${path}: ${diag.slice(0, 600)})`);
  };
  const anyBlock = `const root = document.querySelector(".workspace-leaf-content[data-type='markdown']"); return { n: root ? root.querySelectorAll(".tdcb-block, .tdcb-play").length : 0 };`;
  let rendered = false;
  for (let attempt = 0; attempt < 2 && !rendered; attempt++) {
    await ppEnsureVisible(cdp);
    await open();
    rendered = (await pollState<{ n: number }>(cdp, anyBlock, (s) => s.n > 0, 6_000, 300)).reached;
    if (!rendered) {
      const vis = await ppEnsureVisible(cdp);
      if (vis !== "sichtbar") console.log(`  (Fenster beim Rendern von ${path}: ${vis})`);
      await cdp.evaluate(`app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view?.previewMode?.rerender?.(true); return true;`);
      rendered = (await pollState<{ n: number }>(cdp, anyBlock, (s) => s.n > 0, 5_000, 300)).reached;
    }
  }
  // Ein Block steht zuerst als Standbild (`.tdcb-play`); die Aktionsleiste gehört zum lebenden Viewport und
  // entsteht erst mit der Aktivierung (gemessen 2026-10-04: ohne Klick auf das Standbild keine Leiste).
  if (rendered) await activateBlock(cdp, 0);
  const probe = `
    const bar = document.querySelector(".workspace-leaf-content[data-type='markdown'] .tdcb-block .tdcb-toolbar");
    if (!bar) return document.querySelector(".workspace-leaf-content[data-type='markdown'] .tdcb-block") ? { buttons: [] } : null;
    return {
      buttons: [...bar.querySelectorAll("button")].map((b) => ({
        label: b.getAttribute("aria-label") ?? "",
        svg: !!b.querySelector("svg"),
        children: b.querySelectorAll(${JSON.stringify(PP_ICON_SHAPE)}).length,
      })),
    };
  `;
  const up = await pollState<{ buttons: { label: string; svg: boolean; children: number }[] }>(cdp, probe, (s) => s.buttons.length > 0, rendered ? 15_000 : 1_000, 400);
  if (!up.state) {
    console.log(`  (Block-Notiz ${path}: ${await describeScene(cdp)})`);
    console.log(`  (Lesemodus-Diagnose: ${await cdp.evaluate<string>(`
      const leaves = app.workspace.getLeavesOfType("markdown").map((l) => ({ mode: l.view.getMode?.(), file: l.view.file?.path, sizer: l.view.containerEl.querySelector(".markdown-preview-sizer")?.children.length ?? null, visible: l.view.containerEl.isShown?.(), active: app.workspace.activeLeaf === l }));
      const probeLeaf = app.workspace.getLeaf("tab");
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
      await probeLeaf.openFile(f, { state: { mode: "preview" } });
      await new Promise((r) => setTimeout(r, 2500));
      const fresh = probeLeaf.view.containerEl.querySelector(".markdown-preview-sizer")?.children.length ?? null;
      probeLeaf.detach();
      return JSON.stringify({ leaves, freshTabSizer: fresh, settingsOpen: !!document.querySelector(".modal-container"), popouts: app.workspace.floatingSplit?.children?.length ?? 0, rightCollapsed: app.workspace.rightSplit.collapsed });
    `)})`);
  }
  return up.state;
}

/** Notiz mit einem Tisch-Block (Platte auf 0,725 m). `after` hängt Zeilen an den Rumpf (Leerzeile für PP9). */
const ppBlockNote = (title: string, bodySuffix = ""): string =>
  [`# ${title} (automatisch erzeugt, wird nach dem Lauf gelöscht)`, "", `${fence}shapes`, `${SHAPES_TABLE}${bodySuffix}`, fence, ""].join("\n");

/** Zeilen ohne Leerzeilen — Vergleichsform für „bis auf die Platte unverändert“. */
const nonBlank = (text: string): string[] => text.split("\n").filter((l) => l.trim() !== "");

/** Panel für eine Notiz mit Block öffnen, Wunsch senden und auf das Ende der Runde warten (PP5, PP8, PP9). */
async function ppRefineRound(cdp: Cdp, path: string, body: string): Promise<{ ready: boolean; reason: string; round: PpState | null; buttons: { label: string; svg: boolean; children: number }[] }> {
  let step = "Notiz öffnen";
  let buttons: { label: string; svg: boolean; children: number }[] = [];
  try {
    // Panel ZUERST schließen: das Einklappen der Seitenleiste ändert die Breite der Hauptfläche, und ein Block, der
    // dabei neu rendert, verliert Aktivierung und Aktionsleiste (gemessen 2026-10-04: Knopf danach Breite 0).
    step = "Panel schließen";
    await cdp.evaluate(`app.workspace.detachLeavesOfType(${JSON.stringify(PANEL_VIEW_TYPE)}); await new Promise((r) => setTimeout(r, 1200)); return true;`);
    step = "Notiz öffnen";
    const note = await ppOpenBlockNote(cdp, path, body);
    if (note === null) return { ready: false, reason: "der shapes-Block rendert nicht", round: null, buttons: [] };
    buttons = note.buttons;
    step = "Aktionsknopf klicken";
    // Das Schließen des Panels klappt die Seitenleiste ein, die Hauptfläche wird breiter, der Block rendert neu
    // (Standbild → Aktivierung) — erst warten, bis der Knopf wieder eine Größe hat.
    const barBack = await pollState<{ w: number; poster: number }>(
      cdp,
      `const b = [...document.querySelectorAll(".workspace-leaf-content[data-type='markdown'] .tdcb-block .tdcb-toolbar-button")].filter((x) => x.getAttribute("aria-label") === ${JSON.stringify(PP_EDIT_LABEL)}).find((x) => x.getBoundingClientRect().width > 0); return { w: b ? b.getBoundingClientRect().width : 0, poster: document.querySelectorAll(".workspace-leaf-content[data-type='markdown'] .tdcb-play").length };`,
      (s) => s.w > 0,
      6_000,
      300,
    );
    if (!barBack.reached) {
      const vis = await ppEnsureVisible(cdp);
      if (vis !== "sichtbar") console.log(`  (Fenster vor dem Klick in ${path}: ${vis})`);
      await activateBlock(cdp, 0);
      await sleepMs(500);
    }
    if (!(await ppClickActionButton(cdp, PP_EDIT_LABEL))) {
      const where = await cdp.evaluate<string>(`const root = document.querySelector(".workspace-leaf-content[data-type='markdown']"); const bs = [...(root?.querySelectorAll(".tdcb-toolbar-button") ?? [])].map((b) => (b.getAttribute("aria-label") ?? "?") + ":" + Math.round(b.getBoundingClientRect().width)); const bar = root?.querySelector(".tdcb-toolbar"); const r = root?.getBoundingClientRect(); return JSON.stringify({ win: [innerWidth, innerHeight], leaf: r ? [Math.round(r.width), Math.round(r.height)] : null, left: app.workspace.leftSplit.collapsed, right: app.workspace.rightSplit.collapsed, poster: root?.querySelectorAll(".tdcb-play").length, live: root?.querySelectorAll(".tdcb-block canvas").length, buttons: bs, barDisplay: bar ? getComputedStyle(bar).display + "/" + getComputedStyle(bar).opacity : null });`);
      return { ready: false, reason: `Knopf „${PP_EDIT_LABEL}“ nicht klickbar (Breite ${barBack.state?.w ?? "?"}, Standbilder ${barBack.state?.poster ?? "?"}) · ${where}`, round: null, buttons };
    }
    step = "Panel mit Ziel abwarten";
    const up = await pollState<PpState>(cdp, PP_READ, (s) => s.target.startsWith("Edit:"), 10_000, 250);
    if (!up.reached) return { ready: false, reason: `Panel zeigte kein Ziel „Edit: …“ (Ziel: ${up.state?.target ?? "kein Panel"})`, round: up.state, buttons };
    step = "Panel stehen lassen";
    await ppWaitPanelInside(cdp);
    step = "Wunsch senden";
    await ppType(cdp, PP_REFINE_PROMPT);
    await ppClick(cdp, ".tdcb-prompt-send");
    step = "Ende der Runde abwarten";
    const done = await pollState<PpState>(cdp, PP_READ, (s) => s.phase === "ok" || s.phase === "error", 40_000, 400);
    return { ready: done.reached && done.state?.phase === "ok", reason: done.state ? `Status ${done.state.phase}: ${done.state.status}` : "kein Panel", round: done.state, buttons };
  } catch (error) {
    // Ein Abbruch (Ctrl-C) ist kein Renderer-Fehler: weiterwerfen, sonst steht er als Befund in der Bilanz.
    if (error instanceof AbbruchAusnahme) throw error;
    return { ready: false, reason: `Renderer-Fehler im Schritt „${step}“: ${error instanceof Error ? error.message : String(error)}`, round: null, buttons };
  }
}

async function sectionPromptPanel(cdp: Cdp, _model: string): Promise<void> {
  ppDone.clear();
  const T = PP_TITEL;
  const nothingFor = (reason: string): void => {
    for (const id of PP_IDS) if (!ppDone.has(id)) ppNothing(id, T[id], reason);
  };

  // Zustand aus Vorläufen VOR dem Abschnitt zurücksetzen: eine Ersatz-Zeile eines abgebrochenen Laufs zeigt auf
  // einen toten Port und würde sich als Befund tarnen.
  const removed = await cdp.evaluate<string[]>(PP_RESET);
  for (const url of removed) console.log(`  Aufgeräumt (Rest eines früheren Laufs): Ersatz-Endpunkt ${url}`);
  try {
    // Voraussetzungen: ohne sie ist nichts gemessen, nicht rot.
    const manager = await cdp.evaluate<boolean>(`return app.plugins.plugins["llm-endpoint-manager"] !== undefined;`);
    if (manager) {
      nothingFor("das Plugin llm-endpoint-manager ist im Vault aktiv — dann gilt dessen Endpunktliste, nicht die lokale; der Ersatz-Endpunkt wäre wirkungslos");
      return;
    }
    const answers = loadPpAnswers();
    if (!answers.ok) {
      nothingFor(answers.reason);
      return;
    }
    console.log(`  Ersatz-Antworten: ${answers.sources}`);
    ppOriginalAcceptAs = await cdp.evaluate<unknown>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.acceptAs ?? null;`);
    const sub = await startSubstitute(answers);
    ppSubstitute = sub;
    console.log(`  Ersatz-Endpunkt: ${sub.url} (Modell ${PP_MODEL})`);
    await cdp.evaluate(`
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      plugin.settings.endpoints = [{ id: ${JSON.stringify(PP_ENDPOINT_ID)}, url: ${JSON.stringify(sub.url)}, model: ${JSON.stringify(PP_MODEL)} }];
      plugin.settings.acceptAs = "block";
      await plugin.saveSettings();
      plugin.llm.invalidate();
      return true;
    `);

    // --- PP1. Settings --------------------------------------------------------
    // Erster GUI-Beleg für `renderSettings`. Der Anfrage-Titel stammt aus dem vendorten Kit-Modul, nicht aus dem Gedächtnis.
    const requestTitle = LLM_CONNECTION_STRINGS_EN.request.title;
    ppSettingsOpened = true;
    const settings = await cdp.evaluate<{ rows: number; endpointRow: boolean; endpointValues: string[]; titles: string[]; group: boolean; statusOk: boolean; statusError: boolean }>(`
      app.setting.open();
      app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
      const read = () => {
        const container = app.setting.activeTab?.containerEl;
        const inputs = [...(container?.querySelectorAll(".okit-ep-row input") ?? [])].map((i) => i.value);
        return {
          rows: container?.querySelectorAll(".setting-item").length ?? 0,
          endpointRow: inputs.some((v) => v.includes(${JSON.stringify(sub.url)})),
          endpointValues: inputs,
          titles: [...(container?.querySelectorAll(".okit-collapsible-title") ?? [])].map((t) => t.textContent ?? ""),
          group: [...(container?.querySelectorAll(".setting-item-heading, .setting-item-name") ?? [])].some((h) => (h.textContent ?? "").includes("Model by prompt")),
          statusOk: !!container?.querySelector(".okit-ep-row .okit-ep-status.is-ok"),
          statusError: !!container?.querySelector(".okit-ep-row .okit-ep-status.is-error"),
        };
      };
      const deadline = Date.now() + 12000;
      let state = read();
      // Auch auf das Ergebnis der Erreichbarkeits-Probe warten (Symbol is-ok oder is-error), nicht nur auf die Zeile.
      while (Date.now() < deadline && !(state.endpointRow && state.titles.length > 0 && (state.statusOk || state.statusError))) {
        await new Promise((r) => setTimeout(r, 300));
        state = read();
      }
      // NICHT schließen: in der Zweitinstanz ist das Einstellungen-Fenster ein Pop-out, und sein Schließen mitten im Lauf
      // lässt den Lesemodus des Hauptfensters danach nichts mehr rendern (gemessen 2026-10-04: mit Schließen 4 von 10
      // Punkten „nichts gemessen“ in zwei von drei Läufen, ohne Schließen 10/10 grün). Das Schließen folgt in ppCleanup.
      return state;
    `);
    if (settings.rows === 0) {
      ppNothing("PP1", T.PP1, "der Settings-Tab lieferte keine Zeilen (Einstellungen-Fenster nicht lesbar)");
    } else {
      ppRecord(
        "PP1",
        T.PP1,
        settings.endpointRow && settings.titles.includes(requestTitle),
        `Zeile mit Ersatz-URL: ${settings.endpointRow ? "ja" : `nein (Felder: ${settings.endpointValues.join(" | ") || "keine"})`} · Abschnitt „${requestTitle}“: ${settings.titles.includes(requestTitle) ? "ja" : `nein (Titel: ${settings.titles.join(" | ") || "keine"})`} · Gruppe „Model by prompt“: ${settings.group ? "ja" : "nein"} · ${settings.rows} Zeilen`,
      );
    }

    // --- PP10. Die Ersatz-Zeile ist ERREICHBAR ----------------------------------
    // „Vorhanden“ (PP1) ist nicht „erreichbar“: am 2026-10-04 fragte die Kit-Probe `/models` statt `/v1/models`, und jede
    // echte lokale Zeile (LM Studio, Ollama) stand als „not reachable — skipped“ da, während der damalige Ersatz (der auch
    // `/models` bediente) grün blieb. Der Ersatz bedient jetzt nur noch `/v1/…`; dieser Punkt misst die Wirkung: Symbol der
    // Zeile is-ok, die Auflösung wählt die Ersatz-Zeile, und das Modell steht in der Modell-Liste.
    if (settings.rows === 0) {
      ppNothing("PP10", T.PP10, "der Settings-Tab lieferte keine Zeilen (Einstellungen-Fenster nicht lesbar)");
    } else {
      const reach = await cdp.evaluate<{ resolvedUrl: string | null; resolvedModel: string; listed: boolean; listDetail: string }>(`
        const llm = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].llm;
        const source = await llm.resolve({ force: true });
        const list = await llm.models({ force: true });
        const text = JSON.stringify(list);
        return {
          resolvedUrl: source?.config?.url ?? null,
          resolvedModel: source?.model ?? "",
          listed: text.includes(${JSON.stringify(PP_MODEL)}),
          listDetail: text.slice(0, 160),
        };
      `);
      const unknownHits = sub.requests.filter((r) => r.kind === "unknown").length;
      ppRecord(
        "PP10",
        T.PP10,
        settings.statusOk && !settings.statusError && reach.resolvedUrl !== null && reach.resolvedUrl === sub.url.replace(/\/v1$/, "") && reach.listed,
        `Symbol der Zeile: ${settings.statusOk ? "is-ok" : settings.statusError ? "is-error" : "ohne Ergebnis"} · Auflösung: ${reach.resolvedUrl !== null && reach.resolvedUrl === sub.url.replace(/\/v1$/, "") ? "Ersatz-Zeile" : `${reach.resolvedUrl ?? "keine Zeile"} (erwartet ${sub.url.replace(/\/v1$/, "")})`}, Modell „${reach.resolvedModel}“ · Modell „${PP_MODEL}“ in der Liste: ${reach.listed ? "ja" : `nein (${reach.listDetail})`} · Anfragen an unbekannte Pfade: ${unknownHits} (${sub.unknownPaths.join(", ") || "keine"})`,
      );
    }

    // --- PP2. Panel öffnet ----------------------------------------------------
    const opened = await ppOpenFresh(cdp);
    const two = await cdp.evaluate<{ tabs: string[]; quality: string; qualityWarning: boolean; placeholder: string; send: string; examples: string } | null>(`
      const root = document.querySelector(".tdcb-prompt");
      if (!root) return null;
      const q = root.querySelector(".tdcb-prompt-quality");
      return {
        tabs: [...root.querySelectorAll(".okit-hub-tab-label")].map((t) => t.textContent ?? ""),
        quality: q?.textContent ?? "",
        qualityWarning: !!q && q.classList.contains("is-warning"),
        placeholder: root.querySelector(".tdcb-prompt-input")?.getAttribute("placeholder") ?? "",
        send: root.querySelector(".tdcb-prompt-send")?.textContent ?? "",
        examples: root.querySelector(".tdcb-prompt-examples:not(.is-hidden)")?.textContent ?? "",
      };
    `);
    if (!opened || two === null) {
      ppRecord("PP2", T.PP2, false, "kein Panel nach dem Befehl open-prompt-panel");
    } else {
      ppRecord(
        "PP2",
        T.PP2,
        two.tabs.join("|") === "Prompt|Versions" && two.quality.startsWith("Not measured for this model") && two.qualityWarning && /e\.g\./.test(two.placeholder) && two.send === "Create" && /snowman/.test(two.examples),
        `Tabs ${two.tabs.join("/")} · Messzeile ${two.qualityWarning ? "is-warning" : "ohne is-warning"}: „${two.quality.slice(0, 60)}…“ · Platzhalter „${two.placeholder.slice(0, 50)}…“ · Knopf „${two.send}“ · Beispiel-Empty-State: ${two.examples ? `„${two.examples.slice(0, 40)}…“` : "nicht sichtbar"}`,
      );
    }

    // --- PP3. Erzeugen --------------------------------------------------------
    if (!opened) {
      ppNothing("PP3", T.PP3, "PP2 öffnete das Panel nicht");
    } else {
      await ppType(cdp, PP_CREATE_PROMPT);
      const armed = await cdp.evaluate<boolean>(`
        const tail = document.querySelector(".tdcb-prompt .okit-stream-tail");
        if (!tail) return false;
        window.__ppTail = [];
        window.__ppObs?.disconnect();
        window.__ppObs = new MutationObserver(() => {
          const n = (tail.textContent ?? "").length;
          const list = window.__ppTail;
          if (n > 0 && list[list.length - 1] !== n) list.push(n);
        });
        window.__ppObs.observe(tail, { childList: true, characterData: true, subtree: true });
        return true;
      `);
      const clicked = await ppClick(cdp, ".tdcb-prompt-send");
      const run = await pollState<PpState>(cdp, PP_READ, (s) => s.phase === "ok" || s.phase === "error", 40_000, 300);
      // Vorschau-Canvas braucht einen Moment nach dem Status.
      const shown = await pollState<PpState>(cdp, PP_READ, (s) => s.phase === "ok" && s.colors >= 3, 15_000, 400);
      const lens = (await cdp.evaluate<number[] | null>(`window.__ppObs?.disconnect(); return window.__ppTail ?? null;`)) ?? [];
      const finalLen = lens.length > 0 ? Math.max(...lens) : 0;
      const intermediate = lens.filter((n) => n < finalLen).length;
      const final = shown.state ?? run.state;
      const createSeen = sub.requests.some((r) => r.kind === "create" && r.stream);
      ppRecord(
        "PP3",
        T.PP3,
        armed && clicked && run.reached && intermediate >= 2 && shown.reached && createSeen,
        `Tail-Stände ${lens.join("→") || "keine"} (${intermediate} Zwischenstände, erwartet ≥ 2) · Status ${final?.phase ?? "?"}: „${final?.status ?? ""}“ · Vorschau ${final?.previewVisible ? "sichtbar" : "nicht sichtbar"}, ${final?.colors ?? 0} Farbtöne (erwartet ≥ 3) · Ersatz sah Erzeugen als Stream: ${createSeen} · Ziel „${final?.target ?? "?"}“ · Senden gesperrt: ${final?.sendDisabled ?? "?"} · Ersatz-Anfragen: ${sub.requests.map((r) => r.kind).join(",") || "keine"}`,
      );
    }

    // --- PP4. Übernehmen als Codeblock ----------------------------------------
    // Quellmodus und Cursor am Ende: nur dort fügt das Panel einen Block ein. Die Runde aus PP3 steht im Panel.
    const roundsBefore = (await ppRead(cdp))?.rounds ?? 0;
    if (roundsBefore === 0) {
      ppNothing("PP4", T.PP4, "das Panel trägt keine Runde (PP3 lieferte keine)");
    } else {
      await setSetting(cdp, "acceptAs", "block");
      await openNote(cdp, SMOKE_NOTE_PP_NEW, "# PP4 (automatisch erzeugt, wird nach dem Lauf gelöscht)\n\nEine Zeile vor dem Block.\n", "source");
      await cdp.evaluate(`
        const view = app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view;
        const editor = view?.editor;
        if (!editor) return false;
        const last = editor.lastLine();
        editor.setCursor({ line: last, ch: editor.getLine(last).length });
        return true;
      `);
      const clicked = await ppClick(cdp, ".tdcb-prompt-apply");
      const written = await pollState<{ text: string; buffer: string; bufferPath: string }>(
        cdp,
        `
          // Die Einfügung steht zuerst im Editor-Puffer; die Platte folgt mit dem Autospeichern. Wir speichern
          // selbst, damit das Prüfen nicht von dessen Takt abhängt (der Einfüge-Weg ist der Editor, nicht die Datei).
          const leafView = app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view;
          if (leafView?.editor?.getValue?.().includes(${JSON.stringify(`${fence}shapes`)})) await leafView.save?.();
          const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_PP_NEW)});
          const text = file ? await app.vault.read(file) : "";
          const view = app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.view;
          return { text, buffer: view?.editor?.getValue?.() ?? "", bufferPath: view?.file?.path ?? "" };
        `,
        (s) => s.text.includes(`${fence}shapes`),
        12_000,
        500,
      );
      const after = await ppRead(cdp);
      const text = written.state?.text ?? "";
      const block = /```shapes\n([\s\S]*?)\n```/.exec(text)?.[1] ?? "";
      ppRecord(
        "PP4",
        T.PP4,
        clicked && written.reached && /^box Platte /m.test(block) && after !== null && after.rounds === 0,
        `Block auf der Platte: ${written.reached ? "ja" : "nein"} (${block.split("\n").length} Zeilen, Platte ${/^box Platte /m.test(block) ? "ja" : "nein"}) · Editor-Puffer ${written.state?.bufferPath ?? "?"} ${written.state?.buffer.includes(`${fence}shapes`) ? "trägt den Block" : "ohne Block"} (${written.state?.buffer.length ?? 0} Zeichen; Platte ${text.length}) · Runden danach ${after?.rounds ?? "?"} (erwartet 0) · Status ${after?.phase ?? "?"}: „${after?.status ?? ""}“`,
      );
    }
    await setSetting(cdp, "acceptAs", ppOriginalAcceptAs ?? "block");

    // --- PP5 + PP7. Ändern über die Aktionsleiste -----------------------------
    const editBody = ppBlockNote("PP5");
    const edit = await ppRefineRound(cdp, SMOKE_NOTE_PP_EDIT, editBody);
    // PP7 zuerst: Icons und Öffnen des Panels sind eigene Punkte, auch wenn der Wunsch danach scheitert.
    if (edit.buttons.length === 0) {
      ppNothing("PP7", T.PP7, edit.reason);
    } else {
      const panelLeaves = await cdp.evaluate<number>(`return app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW_TYPE)}).length;`);
      const icons = edit.buttons.map((b) => `${b.label || "(ohne Beschriftung)"}: ${b.svg ? `svg, ${b.children} Formen` : "KEIN svg"}`);
      ppRecord(
        "PP7",
        T.PP7,
        edit.buttons.every((b) => b.svg && b.children > 0) && edit.buttons.some((b) => b.label === PP_EDIT_LABEL) && panelLeaves === 1,
        `${icons.join(" · ")} · Blätter vom Typ ${PANEL_VIEW_TYPE} nach dem Klick: ${panelLeaves} (erwartet 1)`,
      );
    }
    if (edit.round === null) {
      ppNothing("PP5", T.PP5, edit.reason);
    } else {
      const s = edit.round;
      const targetOk = /^Edit: Tisch/.test(s.target);
      const diffOk = s.diff.some((l) => /^Platte: at/.test(l));
      let applied = false;
      let detail = "";
      if (edit.ready && diffOk && targetOk) {
        await ppClick(cdp, ".tdcb-prompt-apply");
        const changed = await pollState<{ text: string }>(
          cdp,
          `const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_PP_EDIT)}); return { text: file ? await app.vault.read(file) : "" };`,
          (n) => n.text !== editBody,
          12_000,
          500,
        );
        const before = editBody.split("\n");
        const now = (changed.state?.text ?? editBody).split("\n");
        const differing = before.map((l, i) => i).filter((i) => before[i] !== now[i]);
        const platte = now.find((l) => l.startsWith("box Platte "));
        applied = changed.reached && now.length === before.length && differing.length === 1 && platte !== undefined && platte.includes(" 0.925 ");
        detail = `geänderte Zeilen ${differing.length} (erwartet 1, Länge ${before.length}→${now.length}) · Platte-Zeile „${platte ?? "fehlt"}“`;
      } else {
        detail = `Apply nicht gefahren (${edit.ready ? "" : edit.reason}${targetOk ? "" : " · Ziel falsch"}${diffOk ? "" : " · Diff ohne „Platte: at“"})`;
      }
      ppRecord("PP5", T.PP5, applied && targetOk && diffOk, `Ziel „${s.target}“ · Diff ${JSON.stringify(s.diff)} · ${detail}`);
    }

    // --- PP6. Abbruch ---------------------------------------------------------
    // Ersatz-Endpunkt schweigt nach dem ersten Stück; nach 1 s „Stop“.
    if (!(await ppOpenFresh(cdp))) {
      ppNothing("PP6", T.PP6, "das Panel öffnete nicht");
    } else {
      const closedBefore = sub.clientClosed;
      sub.hang = true;
      try {
        await ppType(cdp, PP_CREATE_PROMPT);
        await ppClick(cdp, ".tdcb-prompt-send");
        const streaming = await pollState<PpState>(cdp, PP_READ, (s) => s.tail.length > 0 && s.stopVisible, 15_000, 250);
        await sleepMs(1000);
        const stopClicked = streaming.reached ? await ppClick(cdp, ".tdcb-prompt-stop") : false;
        const stopped = await pollState<PpState>(cdp, PP_READ, (s) => s.status === "Stopped." && !s.stopVisible, 10_000, 250);
        const seenAbort = await (async () => {
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline) {
            if (sub.clientClosed > closedBefore) return true;
            await sleepMs(250);
          }
          return false;
        })();
        const s = stopped.state;
        ppRecord(
          "PP6",
          T.PP6,
          streaming.reached && stopClicked && stopped.reached && s?.rounds === 0 && seenAbort,
          `Lauf sichtbar (Tail + Stop): ${streaming.reached} · Stop geklickt: ${stopClicked} · Status „${s?.status ?? "?"}“ (${s?.phase ?? "?"}) · Runden ${s?.rounds ?? "?"} (erwartet 0) · Server sah die geschlossene Verbindung: ${seenAbort}`,
        );
      } finally {
        sub.hang = false;
      }
    }

    // --- PP8. Handänderung zwischen Anfrage und Übernehmen ---------------------
    const staleBody = ppBlockNote("PP8");
    const stale = await ppRefineRound(cdp, SMOKE_NOTE_PP_STALE, staleBody);
    if (!stale.ready) {
      ppNothing("PP8", T.PP8, stale.reason);
    } else {
      const edited = staleBody.replace("box Bein-2 size 0.05 0.7 0.05 at 0.55 0.35 -0.3", "box Bein-2 size 0.05 0.7 0.05 at 0.55 0.35 -0.3 color #112233");
      await cdp.evaluate(`
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_NOTE_PP_STALE)});
        await app.vault.modify(file, ${JSON.stringify(edited)});
        await new Promise((r) => setTimeout(r, 1500));
        return true;
      `);
      const clicked = await ppClick(cdp, ".tdcb-prompt-apply");
      const refused = await pollState<PpState>(cdp, PP_READ, (s) => s.status !== "" && s.status !== stale.round?.status, 8000, 250);
      const noteNow = await ppReadNote(cdp, SMOKE_NOTE_PP_STALE);
      ppRecord(
        "PP8",
        T.PP8,
        edited !== staleBody && clicked && refused.state?.status === PP_STALE_MESSAGE && refused.state.phase === "error" && noteNow === edited,
        `Meldung „${refused.state?.status ?? "keine"}“ (${refused.state?.phase ?? "?"}) · Notiz gleich der Handfassung: ${noteNow === edited}`,
      );
    }

    // --- PP9. Leerzeile am Ende des Rumpfs --------------------------------------
    // Messung, keine Wertung der Wahl: gemessen wird, ob das Ergebnis SICHER ist (angewendet und bis auf die
    // Platte unverändert, oder abgelehnt und die Notiz unverändert) und welcher der beiden Ausgänge eintrat.
    const blankBody = ppBlockNote("PP9", "\n");
    const blank = await ppRefineRound(cdp, SMOKE_NOTE_PP_BLANK, blankBody);
    if (!blank.ready) {
      ppNothing("PP9", T.PP9, blank.reason);
    } else {
      const target = await cdp.evaluate<{ len: number; endsWithNewline: boolean; tail: string } | null>(`
        const view = app.workspace.getLeavesOfType(${JSON.stringify(PANEL_VIEW_TYPE)})[0]?.view;
        const body = view?.state?.().target?.body;
        return typeof body === "string" ? { len: body.length, endsWithNewline: body.endsWith("\\n"), tail: JSON.stringify(body.slice(-8)) } : null;
      `);
      await ppClick(cdp, ".tdcb-prompt-apply");
      const outcome = await pollState<PpState>(cdp, PP_READ, (s) => s.status !== "" && s.status !== blank.round?.status, 10_000, 250);
      await sleepMs(1200);
      const noteNow = await ppReadNote(cdp, SMOKE_NOTE_PP_BLANK);
      const message = outcome.state?.status ?? "";
      const ok = outcome.state?.phase === "ok";
      const before = nonBlank(blankBody);
      const now = nonBlank(noteNow);
      const differing = before.map((_, i) => i).filter((i) => before[i] !== now[i]);
      const platte = now.find((l) => l.startsWith("box Platte "));
      const opens = (noteNow.match(/^```shapes$/gm) ?? []).length;
      const safeApplied = ok && now.length === before.length && differing.length === 1 && platte !== undefined && platte.includes(" 0.925 ") && opens === 1;
      const safeRefused = !ok && outcome.state !== null && noteNow === blankBody;
      ppRecord(
        "PP9",
        T.PP9,
        safeApplied || safeRefused,
        `Ausgang: ${ok ? "angewendet" : "abgelehnt"} — Meldung „${message}“ · Rumpf-Fingerabdruck des Panels: ${target ? `${target.len} Zeichen, endet mit Zeilenumbruch: ${target.endsWithNewline}, Ende ${target.tail}` : "nicht lesbar"} · Notiz: ${noteNow === blankBody ? "unverändert" : `geändert (nicht-leere Zeilen ${before.length}→${now.length}, abweichend ${differing.length}, Leerzeile am Ende ${/\n\n```\n?$/.test(noteNow) ? "erhalten" : "weg"})`}`,
      );
    }

    // --- PP11. Panel mit zwei Runden und Diff-Liste: nichts abgeschnitten, nichts ueberlagert --------
    // Befund der Realprobe (Fenster 1500x949): der Stream-Bereich fiel auf einen leeren Streifen zusammen, die
    // Statuszeile ueberlagerte „Preview of round 2“, Apply/Discard waren unten halb abgeschnitten. Gemessen werden
    // die Rects: Apply und Discard liegen ganz im Fenster UND ganz im sichtbaren Bereich des Rumpfs, Statuszeile
    // und Vorschau-Beschriftung schneiden sich nicht, der Stream hat mehr als 60 px. Die Fensterhoehe steht im
    // Detail (der Punkt sagt nur dann etwas, wenn das Panel wirklich voll ist: Erzeugen, dann gleich Verfeinern).
    const opened11 = await ppOpenFresh(cdp);
    if (!opened11) {
      ppNothing("PP11", T.PP11, "das Panel öffnete nicht");
    } else {
      // Ein echtes Modell denkt lang (gemessen mit Gemma 4: 3 700 Zeichen): der offene Denkblock fuellt den Stream bis zur Obergrenze, und
      // die Statuszeile „Done — …“ (zwei Zeilen im schmalen Panel) ragte aus der Box ueber „Preview of round 1“ (Bild der Modell-Runde Welle 23).
      sub.reasoning = PP_STREAM_REASONING.repeat(8);
      await ppType(cdp, PP_CREATE_PROMPT);
      const clickedCreate = await ppClick(cdp, ".tdcb-prompt-send");
      const first = await pollState<PpState>(cdp, PP_READ, (s) => s.phase === "ok" && s.rounds === 1 && s.colors >= 3, 40_000, 300);
      await ppType(cdp, PP_REFINE_PROMPT);
      const clickedRefine = first.reached ? await ppClick(cdp, ".tdcb-prompt-send") : false;
      const second = await pollState<PpState>(cdp, PP_READ, (s) => (s.phase === "ok" || s.phase === "error") && s.rounds === 2 && s.diff.length > 0, 40_000, 300);
      sub.reasoning = "";
      await sleepMs(600);
      // Das Panel ist erst bei knapper Hoehe „voll“ (Gegenprobe 2026-10-04: mit dem alten styles.css blieb PP11 bei
      // Fenster 1024x800 gruen, weil die Zeilen noch passten): Fenster fuer die Messung auf 640 px Hoehe, danach zurueck.
      const sizeBefore = await cdp.evaluate<number[] | null>(`const w = window.require("electron").remote.getCurrentWindow(); const s = w.getSize(); w.setSize(s[0], 640); await new Promise((r) => setTimeout(r, 900)); return s;`).catch(() => null);
      const geo = await cdp.evaluate<{
        innerH: number;
        buttons: { name: string; top: number; bottom: number }[];
        panel: { top: number; bottom: number };
        statusRect: number[];
        captionRect: number[];
        streamRect: number[];
        streamH: number;
        sticky: string;
        scrollable: boolean;
      } | null>(`
        const root = document.querySelector(".tdcb-prompt");
        if (!root) return null;
        const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
        const panel = root.querySelector(".okit-hub-panel:not(.is-hidden)");
        const pr = panel.getBoundingClientRect();
        const btn = (cls, name) => { const b = root.querySelector(cls).getBoundingClientRect(); return { name, top: b.top, bottom: b.bottom }; };
        return {
          innerH: innerHeight,
          buttons: [btn(".tdcb-prompt-apply", "Apply"), btn(".tdcb-prompt-discard", "Discard")],
          panel: { top: pr.top, bottom: pr.bottom },
          statusRect: r(root.querySelector(".tdcb-prompt-status")),
          captionRect: r(root.querySelector(".tdcb-prompt-preview-caption")),
          streamRect: r(root.querySelector(".tdcb-prompt-stream")),
          streamH: root.querySelector(".tdcb-prompt-stream").getBoundingClientRect().height,
          sticky: getComputedStyle(root.querySelector(".tdcb-prompt-end")).position,
          scrollable: panel.scrollHeight > panel.clientHeight + 1,
        };
      `);
      // Sichtbare Folge (Regel 12): mit SMOKE_SHOT_DIR schreibt der Punkt die Endlage (Denkblock, lange Done-Zeile, Vorschau) als PNG.
      const shotDir11 = process.env.SMOKE_SHOT_DIR;
      if (shotDir11 && geo !== null) {
        const { boxOf, capture } = await import("../../tools/obsidian-cdp/shot.js");
        // Die Stelle zeigen, um die es geht: Statuszeile und Beschriftung in der Mitte des (scrollenden) Rumpfs.
        await cdp.evaluate(`document.querySelector(".tdcb-prompt .tdcb-prompt-status")?.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 400)); return true;`);
        const box = await boxOf(cdp, ".tdcb-prompt", 4);
        if (box) { mkdirSync(shotDir11, { recursive: true }); writeFileSync(join(shotDir11, "pp11-endlage.png"), await capture(cdp, box, 2)); }
      }
      if (sizeBefore) await cdp.evaluate(`const w = window.require("electron").remote.getCurrentWindow(); w.setSize(${sizeBefore[0] ?? 1024}, ${sizeBefore[1] ?? 800}); await new Promise((r) => setTimeout(r, 700)); return true;`).catch(() => undefined);
      if (geo === null || !second.reached) {
        ppRecord("PP11", T.PP11, false, `Vorbereitung unvollständig: Erzeugen ${clickedCreate ? (first.reached ? "ok" : "ohne zweite Vorbedingung") : "Klick fehlt"}, Verfeinern ${clickedRefine ? (second.reached ? "ok" : `nicht fertig (Runden ${second.state?.rounds ?? "?"}, Diff ${second.state?.diff.length ?? "?"}, Status „${second.state?.status ?? ""}“)`) : "Klick fehlt"}, Geometrie ${geo ? "gelesen" : "nicht lesbar"}`);
      } else {
        const inWindow = geo.buttons.every((b) => b.top >= 0 && b.bottom <= geo.innerH);
        const inPanel = geo.buttons.every((b) => b.top >= geo.panel.top - 1 && b.bottom <= geo.panel.bottom + 1);
        const [sl, st, sr, sb] = geo.statusRect as [number, number, number, number];
        const [cl, ct, cr, cb] = geo.captionRect as [number, number, number, number];
        const overlap = sl < cr && cl < sr && st < cb && ct < sb;
        // Die Statuszeile bleibt in der Box des Streams (sonst ragt sie in die Nachbarn, auch wenn die Beschriftung gerade frei ist).
        const statusInStream = sb <= (geo.streamRect[3] ?? 0) + 1;
        ppRecord(
          "PP11",
          T.PP11,
          inWindow && inPanel && !overlap && statusInStream && geo.streamH > 60,
          `Fensterhöhe ${geo.innerH} px · ${geo.buttons.map((b) => `${b.name} ${b.top.toFixed(0)}–${b.bottom.toFixed(0)}`).join(", ")} (Rumpf sichtbar ${geo.panel.top.toFixed(0)}–${geo.panel.bottom.toFixed(0)}; im Fenster: ${inWindow}, im Rumpf: ${inPanel}) · Knopfzeile ${geo.sticky} · Rumpf scrollbar: ${geo.scrollable} · Statuszeile ${[st, sb].map((v) => v.toFixed(0)).join("–")} gegen Beschriftung ${[ct, cb].map((v) => v.toFixed(0)).join("–")}: ${overlap ? "ÜBERLAGERT" : "getrennt"} · in der Box des Streams (Unterkante ${geo.streamRect[3]?.toFixed(0)}): ${statusInStream} · Stream ${geo.streamH.toFixed(0)} px (erwartet > 60) · Runden ${second.state?.rounds}, Diff-Zeilen ${second.state?.diff.length}`,
        );
      }
    }

    // --- PP13–PP17. Stream-Bereich im Prompt-Panel: Folge-Regel, Kontrolle, Denkblock live, Wiederaufnahme --------------------
    // Gemessen mit `messeFolge` der Bruecke (README § Folge-Messung): der scrollende Rumpf (`.okit-stream-body`) ist durch
    // `.tdcb-prompt-stream .okit-stream-body { max-height: 14em }` begrenzt. Die Gueltigkeit steht im Urteil der Bruecke (Ueberlauf >= 80 px, mindestens
    // 3 Staende, Vorbedingung „Bereich folgte vor der Stoerung“); sonst „nichts gemessen“ (CORE-TEST-22).
    {
      const namen = { PP14: T.PP14, PP16: T.PP16, PP13: T.PP13, PP17: T.PP17 };
      const nichts = (ids: (keyof typeof namen)[], grund: string): void => { for (const id of ids) ppNothing(id, namen[id], grund); };
      const eintragen = (id: "PP13" | "PP14" | "PP16" | "PP17", teil: "kontrolle" | "folge" | "wiederaufnahme", e: Awaited<ReturnType<typeof messeFolge>>): void => {
        ppDone.add(id);
        zeichneFolge(bilanz, { [teil]: `${id}. ${namen[id]}` }, e);
      };
      // PP14 + PP15: Kontrolle mit tokengrossen Stuecken und Denk-Text.
      const control = await ppStromMessen(cdp, sub, { kontrolle: true, stoerung: false, wiederaufnahme: false });
      if (control === null) {
        nichts(["PP14"], "das Panel öffnete nicht");
        ppNothing("PP15", T.PP15, "das Panel öffnete nicht");
      } else {
        eintragen("PP14", "kontrolle", control.ergebnis);
        // PP15: der Denk-Text steht vor dem Inhalt, ist offen, sichtbar und waechst waehrend des Stroms.
        const distinct = new Set(control.reasoning.map((x) => x.rl)).size;
        if (distinct < 2) {
          ppNothing("PP15", T.PP15, `der Denk-Text wuchs höchstens ${distinct}-mal (Reasoning-Feld kam nicht an oder zu kurz)`);
        } else {
          const open = control.reasoning.every((x) => x.open);
          const visible = control.reasoning.every((x) => x.vis);
          ppRecord("PP15", T.PP15, open && visible, `${distinct} Wachstumsstände (${control.reasoning[0]?.rl}→${control.reasoning[control.reasoning.length - 1]?.rl} Zeichen) · geöffnet: ${open} · sichtbar: ${visible}`);
        }
      }
      // PP16: dieselbe Kontrolle mit absatzgrossen Stuecken (Befund kuro-w20).
      const paragraph = await ppStromMessen(cdp, sub, { kontrolle: true, stoerung: false, wiederaufnahme: false }, PP_STREAM_PARAGRAPH);
      if (paragraph === null) nichts(["PP16"], "das Panel öffnete nicht");
      else eintragen("PP16", "kontrolle", paragraph.ergebnis);
      // PP13 + PP17: Stoerung (scrollTop = 0), danach darf der Bereich nicht wieder zum Ende springen; steht der Nutzer wieder
      // unten, folgt er wieder. Laengerer Strom, weil die dritte Phase Staende braucht.
      const disturbed = await ppStromMessen(cdp, sub, { kontrolle: false, stoerung: true, wiederaufnahme: true }, PP_STREAM_LANG);
      if (disturbed === null) nichts(["PP13", "PP17"], "das Panel öffnete nicht");
      else {
        eintragen("PP13", "folge", disturbed.ergebnis);
        eintragen("PP17", "wiederaufnahme", disturbed.ergebnis);
      }
    }

    // --- PP18. Gemma 4 ohne Öffner (Welle 23, Gegenprobe zu `onContentReset`) -----------------------------------------
    // Gemma 4 auf LM Studio schreibt das Denken OHNE Öffner in `content` und beendet es mit `<channel|>`; die Antwort folgt. Der Stub
    // streamt genau das. Gemessen wird der Antwortbereich MITTEN im Strom (am Ende setzt das Ergebnis den Text neu) und der Ausgang:
    // auf dem alten Pin (code-kit 0.27.1) kennt der Trenner das Kanalende nicht, die Antwort bleibt Denktext + JSON und das Panel meldet
    // einen Fehler; mit 0.27.2 ohne `onContentReset` bliebe der Denktext bis zum Ende im Antwortbereich stehen.
    {
      const GEDANKE = "Ich wäge erst die Maße ab und rechne dann die Beine nach.";
      const antwort = ppStreamAnswer(6);
      const dritt = Math.ceil(antwort.length / 3);
      // Das Modell der Ersatz-Zeile heisst hier wie Gemma 4: der Kit-Client erkennt das Kanalformat am Modellnamen.
      const setzeModell = (m: string): Promise<unknown> => cdp.evaluate(`
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        plugin.settings.endpoints = plugin.settings.endpoints.map((e) => (e.id === ${JSON.stringify(PP_ENDPOINT_ID)} ? { ...e, model: ${JSON.stringify(m)} } : e));
        plugin.llm.invalidate();
        return true;`);
      await setzeModell("google/gemma-4-e4b");
      try {
      if (!(await ppOpenFresh(cdp))) {
        ppNothing("PP18", T.PP18, "das Panel öffnete nicht");
      } else {
        await ppType(cdp, PP_CREATE_PROMPT);
        sub.queue({ stuecke: [GEDANKE.slice(0, 20), GEDANKE.slice(20) + "<channel|>", antwort.slice(0, dritt), antwort.slice(dritt, 2 * dritt), antwort.slice(2 * dritt)], takt: 700 });
        const clicked = await ppClick(cdp, ".tdcb-prompt-send");
        const mid = await pollUntil<string>(cdp, `
          const t = document.querySelector(".tdcb-prompt .okit-stream-tail")?.textContent ?? "";
          return t.includes('"parts"') && !t.includes('"Teil-6"') ? t : null;`, 20_000, 50);
        const reasoning = await cdp.evaluate<string>(`return document.querySelector(".tdcb-prompt .okit-stream-reasoning > pre")?.textContent ?? "";`);
        // Sichtbare Folge (Regel 12): mit SMOKE_SHOT_DIR schreibt der Punkt den Antwortbereich mit dem Denkblock als PNG.
        const shotDir = process.env.SMOKE_SHOT_DIR;
        if (shotDir && typeof mid === "string") {
          const { boxOf, capture } = await import("../../tools/obsidian-cdp/shot.js");
          const box = await boxOf(cdp, ".tdcb-prompt .tdcb-prompt-stream", 12);
          if (box) { mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, "pp18-gemma-denkblock.png"), await capture(cdp, box, 2)); }
        }
        const run = await pollState<PpState>(cdp, PP_READ, (st) => st.phase === "ok" || st.phase === "error", 40_000, 300);
        ppRecord(
          "PP18",
          T.PP18,
          clicked && typeof mid === "string" && !mid.includes("wäge") && !mid.includes("channel") && reasoning.includes("wäge") && run.state?.phase === "ok",
          `mitten im Strom „${String(mid ?? "").slice(0, 50)}“ · Denkblock „${reasoning.slice(0, 40)}“ · Status ${run.state?.phase ?? "?"}: „${run.state?.status ?? ""}“`,
        );
      }
      } finally {
        await setzeModell(PP_MODEL);
      }
    }

    // --- PP19. Lange Zeile im Antwortbereich (Task „lange JSON-Zeile im Antwort-Tail wird rechts abgeschnitten“) ------
    // Bild pp11-endlage (Welle 23): die JSON-Antwort lief rechts aus dem Panel. Der Strom traegt eine Zeile ohne Leerzeichen
    // (mehr als die Panelbreite); gemessen wird MITTEN im Strom im Tail: jeder Nachfahre des Streams endet in dessen Box, der Rumpf
    // hat keinen waagerechten Ueberlauf. Ohne lange Zeile im Tail ist der Punkt „nichts gemessen“ (CORE-TEST-22).
    {
      const LANG = "L".repeat(400);
      const antwort = ppStreamAnswer(6);
      const haelfte = Math.ceil(antwort.length / 2);
      if (!(await ppOpenFresh(cdp))) {
        ppNothing("PP19", T.PP19, "das Panel öffnete nicht");
      } else {
        await ppType(cdp, PP_CREATE_PROMPT);
        sub.queue({ stuecke: [antwort.slice(0, haelfte), LANG, antwort.slice(haelfte)], takt: 900 });
        const clicked = await ppClick(cdp, ".tdcb-prompt-send");
        const wide = await pollUntil<{ over: number; scrollX: number; worst: string }>(cdp, `
          const stream = document.querySelector(".tdcb-prompt .tdcb-prompt-stream");
          const tail = stream?.querySelector(".okit-stream-tail");
          if (!stream || !tail || !(tail.textContent || "").includes(${JSON.stringify(LANG)})) return null;
          const sr = stream.getBoundingClientRect();
          let over = 0, worst = "";
          for (const el of stream.querySelectorAll("*")) {
            const b = el.getBoundingClientRect();
            if (b.width === 0 && b.height === 0) continue;
            if (b.right - sr.right > over) { over = b.right - sr.right; worst = String(el.className || el.tagName); }
          }
          const body = stream.querySelector(".okit-stream-body");
          return { over, scrollX: body ? body.scrollWidth - body.clientWidth : -1, worst };`, 20_000, 50);
        const shotDir19 = process.env.SMOKE_SHOT_DIR;
        if (shotDir19 && wide !== null) {
          const { boxOf, capture } = await import("../../tools/obsidian-cdp/shot.js");
          const box = await boxOf(cdp, ".tdcb-prompt .tdcb-prompt-stream", 12);
          if (box) { mkdirSync(shotDir19, { recursive: true }); writeFileSync(join(shotDir19, "pp19-lange-zeile.png"), await capture(cdp, box, 2)); }
        }
        await pollState<PpState>(cdp, PP_READ, (st) => st.phase === "ok" || st.phase === "error", 40_000, 300);
        if (!clicked || wide === null) ppNothing("PP19", T.PP19, clicked ? "die lange Zeile erschien nie im Tail" : "Klick auf Erzeugen fehlt");
        else ppRecord("PP19", T.PP19, wide.over <= 1 && wide.scrollX <= 1, `Zeile von ${LANG.length} Zeichen im Tail · ragt ${wide.over.toFixed(0)} px über die Box${wide.over > 1 ? ` (${wide.worst})` : ""} · waagerechter Überlauf des Rumpfs ${wide.scrollX} px`);
      }
    }

    // --- PP20. Denkblock kopierbar (obsidian-kit 0.63.0, Task „Denkblock kopierbar“) ----------------------------------
    // Gegenprobe VOR dem Denken: ohne Denk-Text gibt es keinen Knopf. Danach streamt der Stub einen Denk-Text mit Marke; gemessen werden
    // Knopf (aria-label), Zwischenablage (Electron-Clipboard, der vorherige Inhalt wird zurueckgeschrieben), Quittung am Knopf (`is-copied`)
    // und der Zustand des `<details>` vor/nach dem Klick (der Klick darf den Block nicht umklappen).
    {
      const MARKE = "Kopierprobe-W24";
      const DENKEN = `${MARKE}: erst die Platte, dann vier Beine, dann die Masse nachrechnen.`;
      if (!(await ppOpenFresh(cdp))) {
        ppNothing("PP20", T.PP20, "das Panel öffnete nicht");
      } else {
        const vorher = await cdp.evaluate<number>(`return document.querySelectorAll(".tdcb-prompt .okit-stream-reasoning-copy").length;`);
        sub.reasoning = DENKEN;
        await ppType(cdp, PP_CREATE_PROMPT);
        const clicked = await ppClick(cdp, ".tdcb-prompt-send");
        // Gueltig ist die Messung, sobald der Denk-Text im Block steht; fehlt der Knopf DANN, ist das der Befund (rot), nicht „nichts gemessen“.
        const knopf = await pollUntil<{ label: string | null; offen: boolean }>(cdp, `
          const d = document.querySelector(".tdcb-prompt .okit-stream-reasoning");
          if (!d || !(d.querySelector("pre")?.textContent ?? "").includes(${JSON.stringify(MARKE)})) return null;
          const b = d.querySelector(".okit-stream-reasoning-copy");
          return { label: b ? (b.getAttribute("aria-label") ?? "") : null, offen: d.open };`, 20_000, 100);
        await pollState<PpState>(cdp, PP_READ, (st) => st.phase === "ok" || st.phase === "error", 40_000, 300);
        sub.reasoning = "";
        if (!clicked || knopf === null) {
          ppNothing("PP20", T.PP20, clicked ? "der Denk-Text erschien nicht im Block" : "Klick auf Erzeugen fehlt");
        } else if (knopf.label === null) {
          ppRecord("PP20", T.PP20, false, `Knöpfe vor dem Denken: ${vorher} · der Denk-Text steht im Block, aber es gibt keinen Kopier-Knopf`);
        } else {
          const gelesen = await cdp.evaluate<{ davor: string; danach: string; quittiert: boolean; offenDanach: boolean }>(`
            const cb = window.require("electron").clipboard;
            const davor = cb.readText();
            cb.writeText("");
            const b = document.querySelector(".tdcb-prompt .okit-stream-reasoning-copy");
            const d = document.querySelector(".tdcb-prompt .okit-stream-reasoning");
            const offenVorher = d.open;
            b.click();
            let danach = "";
            for (let i = 0; i < 40 && danach === ""; i++) { await new Promise((r) => setTimeout(r, 50)); danach = cb.readText(); }
            await new Promise((r) => setTimeout(r, 100));
            const quittiert = b.classList.contains("is-copied");
            cb.writeText(davor);
            return { davor, danach, quittiert, offenDanach: d.open === offenVorher };`);
          const kopiert = gelesen.danach.includes(MARKE);
          ppRecord(
            "PP20",
            T.PP20,
            vorher === 0 && knopf.label !== "" && kopiert && gelesen.quittiert && gelesen.offenDanach,
            `Knöpfe vor dem Denken: ${vorher} (erwartet 0) · aria-label „${knopf.label}“ · Zwischenablage trägt die Marke: ${kopiert} („${gelesen.danach.slice(0, 40)}“) · Quittung is-copied: ${gelesen.quittiert} · Block unverändert offen/zu: ${gelesen.offenDanach}`,
          );
        }
      }
    }

    // --- PP12. Migration des globalen Modells ------------------------------------
    // Das Feld `llmModel` gibt es nicht mehr. Ein Altwert im data.json zieht beim Laden einmal in die Zeile ohne Modell,
    // der Schlüssel verschwindet, und die Einstellungen kennen weder eine eigene Zeile „Model“ noch die Option
    // „global model (…)“ in der Zeilenauswahl. Das Plugin wird dafür aus- und wieder eingeschaltet (Laden = onload).
    {
      const mig = await cdp.evaluate<{ rowModel: string | null; keyGone: boolean; modelRow: boolean; globalOption: boolean; rows: number }>(`
        const id = ${JSON.stringify(PLUGIN_ID)};
        const plugin = app.plugins.plugins[id];
        await plugin.saveData({ ...plugin.settings, endpoints: [{ id: ${JSON.stringify(PP_ENDPOINT_ID)}, url: ${JSON.stringify(sub.url)} }], llmModel: "legacy-smoke-model" });
        await app.plugins.disablePlugin(id);
        await app.plugins.enablePlugin(id);
        const fresh = app.plugins.plugins[id];
        const stored = (await fresh.loadData()) ?? {};
        app.setting.open();
        app.setting.openTabById(id);
        await new Promise((r) => setTimeout(r, 1500));
        const c = app.setting.activeTab?.containerEl;
        const names = [...(c?.querySelectorAll(".setting-item-name") ?? [])].map((n) => (n.textContent ?? "").trim());
        const options = [...(c?.querySelectorAll("option") ?? [])].map((o) => o.textContent ?? "");
        return {
          rowModel: fresh.settings.endpoints?.[0]?.model ?? null,
          keyGone: !("llmModel" in stored) && !("llmModel" in fresh.settings),
          modelRow: names.includes("Model"),
          globalOption: [...options, c?.textContent ?? ""].some((t) => /global model/i.test(t)),
          rows: c?.querySelectorAll(".setting-item").length ?? 0,
        };
      `);
      ppRecord(
        "PP12",
        T.PP12,
        mig.rows > 0 && mig.rowModel === "legacy-smoke-model" && mig.keyGone && !mig.modelRow && !mig.globalOption,
        `Modell der Zeile: ${mig.rowModel === null ? "keines" : `„${mig.rowModel}“`} (erwartet „legacy-smoke-model“) · Schlüssel llmModel weg: ${mig.keyGone ? "ja" : "NEIN"} · Zeile „Model“: ${mig.modelRow ? "VORHANDEN" : "keine"} · Option „global model“: ${mig.globalOption ? "VORHANDEN" : "keine"} · ${mig.rows} Zeilen`,
      );
    }
  } finally {
    await ppCleanup(cdp);
    await cdp
      .evaluate(`
        for (const path of ${JSON.stringify(PP_NOTES)}) {
          const file = app.vault.getAbstractFileByPath(path);
          if (file) await app.vault.delete(file);
        }
        return true;
      `)
      .catch(() => undefined);
    // Ein Abbruch mitten im Abschnitt: was nicht verbucht wurde, ist nicht gemessen — nie grün.
    nothingFor("der Abschnitt endete, bevor dieser Punkt lief");
  }
}

/** Soll-Liste (Nenner der Bilanz): jeder Punktname, den ein Abschnitt aufzeichnen kann, nach Abschnitt. Bei `--section` ist die
 *  Teilmenge das Soll; ein Name ausserhalb wirft in `createBilanz`. Jeder Punkt hat GENAU EINEN Namen (Erfolg, Fehlschlag und
 *  Uebersprungen zeichnen dieselbe Zeile auf) — Sammelnamen wie „B2-B12“ gibt es nicht, `skipIds` verbucht jede Kennung einzeln. */
const PUNKTE_VORLAUF = ["Keine liegen gebliebenen Smoke-Dateien aus einem abgebrochenen frueheren Lauf"] as const;
const PUNKTE_JE_SECTION: Record<string, readonly string[]> = {
  active: [
    "1. Modus 'erst auf Klick': beide Blöcke starten als Standbild",
    "2. Sidebar zeigt zunächst den Platzhalter",
    "3. Klick aufs Standbild füllt die Sidebar (Smoke-#4-Befund)",
    "4. 'Save view' ist bedienbar, nicht nur sichtbar",
    "5. Genau ein Block ist als aktiv markiert",
    "6. Der Titel des aktiven Blocks hebt sich ab",
    "7. Der Aktiv-Rahmen liegt auf der Bühne",
    "8. Der Akzent folgt dem Theme (hell ≠ dunkel)",
    "9. 'Save current view as image' legt ein PNG an, das das Modell zeigt",
  ],
  view: [
    "V1. Drehen per echter Maus-Interaktion bewegt die Kamera",
    "V2. 'Save view' schreibt eine view:-Zeile in den Block",
    "V3. Die gemerkte Ansicht steht nach dem Neuöffnen wieder da",
    "V3b. Ein zweiter Speicherzyklus verschiebt die Ansicht nicht weiter",
    "V4. Nahe an einem Standardwinkel steht der Name im Block, nicht drei Zahlen",
    "V5. 'Clear view' entfernt die Zeile wieder (Lesemodus)",
    "V6. Im Editor gespeichert, per Undo rückgängig",
    "V7. Sidebar zu → Hover-Leiste erscheint, Sidebar auf → verschwindet",
    "V8. Der Wechsel läuft ohne Neuaufbau der Notiz",
    "V9. Im Embed sind 'Save view'/'Clear view' deaktiviert, 'Fit' nicht",
    "V10. Der deaktivierte Knopf sagt auch, warum",
    "V11. Die geöffnete Datei zeigt das Modell, kann aber nichts merken",
    "V12. 'view: quatsch' erzeugt eine Hinweiszeile",
    "V13. Das Modell bleibt trotz kaputter Ansicht sichtbar",
    "SMOKE.md 'Ansicht merken' Punkt 5 (fünf Etagen, Aktiv-Rahmen)",
  ],
  basis: [
    "B1. Der Block rendert ein sichtbares Modell (nicht nur ein Canvas)",
    "B2. Orbit per echter Maus dreht die Kamera",
    "B3. Das Mausrad ändert die Distanz",
    "B4. Pan (rechte Maustaste) verschiebt das Bild",
    "B5. Doppelklick setzt die Ansicht auf den Einpass-Zustand zurück",
    "B5b. Nach dem Reset gilt der Blick nicht als vom Nutzer bewegt",
    "B6. Im Split schrumpft der Viewport mit — auch der Renderer-Puffer",
    "B6b. Ein bewegter Blick bleibt, wenn der Viewport schmaler wird",
    "B6c. Ein nicht bewegter Blick wird neu eingepasst, wenn der Viewport schmaler wird",
    "B7. Der Viewport folgt dem Theme (hell ≠ dunkel)",
    "B8. Eine extern neu erzeugte Datei erneuert die Ansicht ohne Neustart",
    "B9. Achtmal im Block getippt hinterlässt keine verwaisten Canvas",
    "B10. Beim Durchscrollen zeigen alle fünf Blöcke ein Modell",
    "B11. 'Maximum live 3D views' = 2 hält nur zwei Ansichten live",
    "B12. Das Standbild zeigt das Modell, nicht eine leere Fläche",
    "B13. Fehlende Datei nennt den Pfad",
    "B14. Falsche Endung nennt die unterstützten Formate",
    "B15. Ein Tippfehler im Schlüssel meldet sich, versteckt aber das Modell nicht",
    "B16. Eine STL-Datei lädt und ist sichtbar",
    "B17. Die drei Beleuchtungs-Zustände erzeugen drei verschiedene Bilder",
    "B18. Ein mehrteiliges glTF findet seine .bin im Vault",
    "B19. Eine Draco-GLB nennt Grund und Ausweg und zeigt kein Modell",
    "B20. Eine 3MF-Datei lädt und ist sichtbar",
    "B21. Eine OBJ-Datei ohne MTL lädt im Theme-Material",
    "B22. Eine OBJ-Datei mit MTL im selben Ordner zeigt die Materialfarben der MTL",
    "B23. Eine PLY-Datei mit Flächen und Eckenfarben lädt und ist sichtbar",
    "B24. Eine G-Code-Datei zeigt ihre Linien",
    "B25. Eine XYZ-Punktwolke mit Farben lädt und ist sichtbar",
    "B26. Eine PCD-Punktwolke ohne Farbe lädt im Theme-Material",
    "B27. Bei ausgeschaltetem „Allow external resources“ geht keine Anfrage an eine externe Textur-URL",
    "SMOKE.md 'Zusätzlich' (Popout-Fenster)",
    "SMOKE.md Punkt 8 (Klick-Modus)",
  ],
  files: [
    "F1. Eine 3D-Datei öffnet sich als eigene View und zeigt das Modell",
    "F2. In der Datei-Ansicht drehen und per Doppelklick zurücksetzen",
    "F3. Das zweite Format lädt in der Datei-Ansicht",
    "F4. Ein `![[modell]]`-Embed rendert im Lesemodus",
    "F5. Die Höhenangabe aus `![[modell|300]]` kommt an",
    "F6. Ein `gltf`-Codeblock rendert seinen eigenen Quelltext",
    "F7. Kaputtes glTF-JSON sagt genau das",
    "SH1. Ein ```shapes-Block rendert seine Teile",
    "SH2. Eine kaputte Zeile kostet nur sich selbst und wird mit Nummer gemeldet",
    "SH3. Ein Block ohne gültiges Teil sagt das und zeichnet nichts",
    "SH4. Dieselbe DSL als Datei rendert über ```3d file: und als Embed",
    "SH5. Export schreibt eine glTF-Datei, die ihre Quelle nennt",
    "F8. 'Maximum live 3D views' ist ein Slider von 0 bis 12",
    "F8b. Die Hilfe-Zeile steht als ERSTE Zeile im Settings-Tab",
    "F9. 'Maximum live 3D views' = 0 friert nichts ein",
    "F10. Codeblock und Embed rendern in derselben Notiz nebeneinander",
    "F11. Codeblock UND Embed folgen dem Theme",
  ],
  shapesfile: [
    "SH6. Die .shapes-Datei öffnet in der eigenen Ansicht mit Pillen",
    "SH6b. Drei Pillen und Start in Split ab 700 px",
    "SH7. Tippen schreibt die Datei und rendert das Modell neu",
    "SH8. Eine kaputte Zeile ist im Text markiert",
    "SH13. Das Modell der Dateiansicht sitzt in der Mitte und wird bei jeder Größenänderung neu gerahmt (nichts abgeschnitten, auch im schmalen Pane)",
    "SH14. Text- und Split-Ansicht haben ein sichtbares Ende: Rahmen, Abschlusslinie, im Split eine Trennlinie, Höhen innerhalb der Fläche",
    "SH14b. Trennlinie im Split",
    "SH15. Pfeiltasten schieben die Ansicht eines Blocks im Lesemodus (echter Klick fokussiert, echte Tasten)",
    "SH15b. Pfeiltasten schieben die Ansicht eines Blocks im Live Preview, die Cursorzeile des Editors bleibt",
    "SH16. Die Höhe des Editors folgt dem Text: 5 Zeilen ≈ 5 Zeilenhöhen, 200 Zeilen = Textspalte und scrollen innen, leere Datei ≥ 3 Zeilenhöhen, Split dieselbe Regel",
    "SH16b. Split-Teil der Editor-Höhe",
    "SH17. Der Editor-Rahmen bleibt durchgezogen 1 px, im Fokus ohne gepunkteten Outline und mit anderer Randfarbe",
    "SH9. Block → Datei: neue .shapes-Datei mit dem Blocktext, die Notiz verweist darauf",
    "SH10. Datei → Block: abgelehnt bei zwei Verweisen, durchgeführt bei einem",
    "SH11. Datei → Block bei offener Ansicht mit ungespeichertem Tippen verliert nichts",
    "SH12. Befehle sind registriert und nur am richtigen Ort verfügbar",
    "SH12b. Kontextmenü-Einträge mit Icon",
  ],
  edit: [
    "E1. 'Edit model' schaltet den Bearbeitungsmodus ein",
    "E2. Ein Klick aufs Modell wählt einen Knoten aus",
    "E3. Verschieben macht 'Save edits' bedienbar und schreibt die .edit-Datei",
    "E4. Die Original-Datei wird dabei nicht angefasst",
    "E5. Beim Wiedereinstieg sitzt die gespeicherte Verschiebung wieder",
    "E6. Ein 'env__'-Knoten ist gesperrt — und ohne Sperre wäre er auswählbar",
    "E8. Ein Klick auf einen Knoten mit geteiltem Mesh wählt nichts aus — und meldet warum",
    "E7. Ungespeicherte Änderungen fragen nach — 'Keep editing' bleibt, 'Discard' verlässt",
    "SMOKE.md Edit mode Punkt 6 (Abnahme-Test im outpost-Repo)",
    "SMOKE.md Edit mode Punkt 7 (Regeneration bei offenem Edit-Modus)",
    "Gizmo-Drag selbst",
  ],
  cameras: [
    "K1. Eine benannte Kamera aus der Datei wird angefahren (Bild ≠ Auto-Einpassen)",
    "K2. Ein Kameraname mit Leerzeichen ist erreichbar (`Schnitt A`)",
    "K4. Ein unbekannter Name nennt die vorhandenen Kameras und zeigt das Modell trotzdem",
    "K5. Eine orthographische Kamera meldet sich als nicht unterstützt",
    "K6. Ein doppelt vergebener Name meldet die Mehrdeutigkeit und fährt trotzdem an",
    "K7. `camera:` auf einer STL nennt das Format als Bedingung",
    "K3. Nach dem Anfahren bleibt der Blick frei (Orbit ändert das Bild)",
  ],
  clickrace: [
    "R0. Block aktivierbar (Voraussetzung der Klick-Sturm-Probe)",
    "R1. Grundlinie: 20 atomare Klicks ohne Sturm kommen alle an",
    "R2. Lastfall: der reale Klick-Pfad (synchrones element.click()) übersteht den Panel-Sturm",
    "R3. Positivkontrolle: Press/Release-Split (clickReal, 15ms Haltezeit) verliert Treffer im selben Sturm",
  ],
  promptpanel: PP_IDS.map((id) => `${id}. ${PP_TITEL[id]}`),
};

const SECTIONS: { key: string; title: string; run: (cdp: Cdp, model: string) => Promise<void> }[] = [
  { key: "active", title: "Aktiver Block + Sidebar (2026-08-04)", run: sectionActiveBlock },
  { key: "view", title: "Ansicht merken (SMOKE.md 2026-07-25)", run: sectionSaveView },
  { key: "basis", title: "Basis-Checkliste (SMOKE.md Punkte 1-10)", run: sectionBasics },
  { key: "files", title: "Datei-nativer Ausbau (SMOKE.md 2026-07-24)", run: sectionFiles },
  { key: "shapesfile", title: "shapes-Dateiansicht und Umwandeln (SMOKE.md 2026-10-03)", run: sectionShapesFile },
  { key: "promptpanel", title: "Prompt-Panel gegen Ersatz-Endpunkt (SMOKE.md 2026-10-03)", run: sectionPromptPanel },
  { key: "edit", title: "Edit mode (SMOKE.md 2026-07-26)", run: sectionEditMode },
  { key: "cameras", title: "Kameras aus der Datei (SMOKE.md 2026-09-02)", run: sectionCameras },
  { key: "clickrace", title: "Klick-Sturm-Probe (Task 'clickReal misst am ersetzten DOM womoeglich vorbei')", run: sectionClickRace },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const flag = (name: string): string | undefined => args.value(name);
  const port = Number(flag("port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port <1024-65535> ist Pflicht (kein Standardport: 9222 gehoert der regulaeren Instanz). Beispiel: npm run smoke:gui -- --port 9390 --vault 3d-codeblocks");
  }
  const keep = args.has("keep");
  const modelArg = flag("model");
  const vault = flag("vault");
  const sectionArg = flag("section");

  // `--skip a,b` lässt Abschnitte weg (Gegenprobe: misst ein Abschnitt den Rest des Laufs mit?).
  const skipped = new Set((flag("skip") ?? "").split(",").filter((k) => k !== ""));
  // `--section a,b` fährt mehrere Abschnitte in der Reihenfolge von SECTIONS (Bisektion von Zustandslecks, Fokus-Lauf auf die WebGL-Abschnitte schneiden).
  const wanted = sectionArg ? sectionArg.split(",").map((k) => k.trim()) : null;
  const sections = (wanted ? SECTIONS.filter((s) => wanted.includes(s.key)) : SECTIONS).filter((s) => !skipped.has(s.key));
  if (sections.length === 0) {
    throw new Error(`Unbekannter --section ${sectionArg}. Bekannt: ${SECTIONS.map((s) => s.key).join(", ")}`);
  }

  // Soll-Liste der gewaehlten Abschnitte (plus Vorlauf-Punkt) = Nenner der Bilanz.
  const ohneSoll = sections.filter((x) => PUNKTE_JE_SECTION[x.key] === undefined).map((x) => x.key);
  if (ohneSoll.length > 0) throw new Error(`Abschnitt ohne Soll-Liste in PUNKTE_JE_SECTION: ${ohneSoll.join(", ")}`);
  sollListe = [...PUNKTE_VORLAUF, ...sections.flatMap((x) => PUNKTE_JE_SECTION[x.key] ?? [])];
  bilanz = createBilanz({ punkte: sollListe });

  console.log(`GUI-Smoke — Obsidian auf Port ${port}`);
  // Herkunft des Builds prueft `ladePluginNeu` unten (`repoMainJs` → `requireEigenerBuild`): ein Lauf gegen einen Store-Build
  // oder fremden Stand wird dort abgelehnt, bevor etwas neu geladen wird. Gemessen 2026-08-30: Vault-Build vom 15.08. gegen
  // das Repo, beide 0.3.1 — `manifest.version` ist dafuer blind.
  const repoMainJs = join(cwd(), "main.js");
  if (!existsSync(repoMainJs)) throw new Error("main.js fehlt — erst `npm run build`, dann den Smoke.");

  // Staging-Vault aus dem getrackten Fixture bauen (wie `shots.ts --setup`): Notizen, Modelle, Einstellungen und Layout kommen
  // aus dem Repo, nicht aus dem Zustand eines frueheren Laufs. Nur fuer den eigenen Staging-Vault; ein anderer Vault
  // (`--vault outpost-worldbuilding`) wird nie ueberschrieben, `--ohne-fixture` schaltet es fuer den eigenen ab.
  // Der Vault wird VOR dem Anhaengen gebaut; das Plugin laedt danach neu und liest `data.json` frisch.
  if ((vault ?? REPO_NAME) === REPO_NAME && !args.has("ohne-fixture")) {
    const vaultDir = stagingVaultDir(REPO_NAME);
    console.log(`Staging-Vault aus dem Fixture: ${vaultDir}`);
    for (const zeile of buildVault({
      repoRoot: cwd(),
      vaultDir,
      fixtureDir: join(cwd(), "docs/images/fixture"),
      generator: "make-models.mjs",
      pluginId: PLUGIN_ID,
    })) {
      console.log(`  ${zeile}`);
    }
  }
  const cdp = await Cdp.attach(port, vault);
  // Ein verdecktes Fenster (anderer Space, Fokus bei einer anderen App) rendert nichts: Lesemodus leer, 0 Bilder je Sekunde,
  // `visibilityState` hidden (gemessen 2026-10-04: PP5/7/8/9 und SH15 rot oder nicht gemessen, ohne Codeaenderung). Erst sichtbar
  // machen, sonst misst der Lauf nur die Umgebung (CORE-TEST-22). Die Brücke legt das Fenster zuerst nur daneben (setBounds),
  // statt den Vordergrund zu nehmen.
  await requireVisible(cdp).catch((e: unknown) => console.error(`requireVisible: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`));
  // Stufe 1b meldet „genuegte“, solange `visibilityState` im Moment der Verschiebung sichtbar war; gemessen 2026-10-04
  // fiel das Fenster danach zurück auf hidden (0 Bilder je Sekunde, Lesemodus leer). Deshalb NACH der Brücke noch einmal
  // prüfen und im Space-Fall (Stufe 2 der Brücke) das Fenster wirklich holen: show/moveTop/focus. Nimmt den Vordergrund
  // — der Lock (`--exclusive focus`) ist dafür da.
  const stillVisible = await pollUntil(cdp, `return document.visibilityState === "visible" ? true : null;`, 2500, 300);
  if (!stillVisible) {
    console.error("requireVisible: Fenster nach der Brücke wieder hidden — hole es nach vorn (show/moveTop/focus)");
    await cdp.evaluate(`const w = window.require("electron").remote.getCurrentWindow(); if (w.isMinimized()) w.restore(); w.show(); w.moveTop(); w.focus(); return true;`).catch(() => undefined);
    const later = await pollUntil(cdp, `return document.visibilityState === "visible" ? true : null;`, 5000, 300);
    if (!later) throw new Error("Obsidian-Fenster bleibt hidden (anderer Space, Bildschirm gesperrt?) — der DOM misst dann nichts; Fenster von Hand nach vorn holen und den Lauf wiederholen.");
  }
  // Ausserhalb des try, damit das `finally` ihn auch nach einem Abbruch mitten im Lauf
  // zurueckschreiben kann — sonst bliebe der Vault im Smoke-Zustand stehen.
  // Ein Schnappschuss der GANZEN Einstellungen, nicht nur des einen Feldes: die
  // Abschnitte stellen um, was sie brauchen (Ansichtsmodus, Kontext-Budget), und die
  // Wiederherstellung darf nicht daran hängen, dass jeder von ihnen sauber zu Ende läuft.
  let previousSettings: string | null = null;

  // Dieselbe Aufraeumarbeit wie im `finally` unten — als eigene Funktion, damit der
  // SIGINT/SIGTERM-Handler sie aufrufen kann, ohne Code zu duplizieren. Ein Ctrl-C mitten
  // im Lauf ueberspringt das `finally` NICHT (try/catch-Semantik), sondern beendet den
  // Node-Prozess sofort — ohne eigenen Handler bleiben `previousSettings` unwiederhergestellt
  // und `createdNotes` im Vault stehen (gemessen: der naechste Lauf liest sie als Fremdzustand,
  // z. B. `viewMode: on-click` verfaelscht B-Pruefpunkte, `_tdcb-*`-Notizen verstopfen B9/B10).
  const cleanupState = async (): Promise<void> => {
    if (previousSettings !== null) {
      await cdp
        .evaluate(`
          const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          if (plugin) {
            Object.assign(plugin.settings, JSON.parse(${JSON.stringify(previousSettings)}));
            await plugin.saveSettings?.();
          }
          return true;
        `)
        .catch(() => undefined);
    }
    // Prompt-Panel-Abschnitt: Ersatz-Endpunkt aus den Einstellungen, Panel-Blatt zu, Server zu. Nach der
    // Wiederherstellung oben, weil ein Schnappschuss aus einem abgebrochenen Vorlauf den Ersatz mitbringen kann.
    await ppCleanup(cdp);
    if (!keep && shapesFileOwned) {
      // Nur Weissliste (siehe sectionShapesFile); Ansichten zuerst schliessen, sonst legt ihr
      // Schlusssichern eine geloeschte Datei neu an.
      await cdp
        .evaluate(`
          ${SHAPES_WIPE}
          return true;
        `)
        .catch(() => undefined);
    }
    if (!keep && shapesExportOwned) {
      await cdp
        .evaluate(`
          for (const f of app.vault.getFiles().filter((f) => f.name === ${JSON.stringify(SHAPES_EXPORT_NAME)})) {
            await app.vault.delete(f);
          }
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
  };

  // Abbruch-Modul der Bruecke (README § Abbruch): bei Ctrl-C raeumt es `cleanupState` auf, druckt die Bilanz und endet mit
  // Exit 130. Angemeldet VOR der ersten Mutation.
  const zustand = beimAbbruch(cleanupState, "Smoke-Zustand zurücksetzen");

  try {
    // Ohne Fokus drosselt Chromium den Renderer. `Page.bringToFront` allein genuegt auf
    // macOS NICHT: es holt das Fenster innerhalb der App nach vorn, nicht die App nach
    // vorn. Gemessen 2026-08-04 — im Hintergrund blieb das DOM der Notiz komplett leer
    // (`.tdcb-block` = 0, kein Notiztext), obwohl `app.workspace` die Datei korrekt als
    // aktiv meldete. Man debuggt dann ein Phantom: Zustand richtig, Anzeige nicht da.
    await cdp.send("Page.bringToFront");
    // Die Fokus-Emulation setzt `requireVisible` oben (Bruecke, seit 9eb35c2); gemessen 2026-08-14: ohne sie flackerte der
    // Lauf zwischen 21/21 und Totalausfall.
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
    // Frisches Profil: Vertrauensdialog bestätigen, Restricted Mode aufheben, Plugin laden (Dach-AGENTS § Staging-Vaults).
    const instanz = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: "3d-codeblocks", sprache: "en" });
    if (instanz.plugins[PLUGIN_ID] === "fehlt") console.error(`bereiteInstanzVor: ${instanz.hinweis}`);
    const neu = await ladePluginNeu(cdp, PLUGIN_ID, { repoMainJs, melde: console.error });
    if (!neu.geladen) throw new Error(`Plugin ${PLUGIN_ID} ist nicht aktiv — ${neu.hinweis}`);
    if (!neu.aktuell) throw new Error(neu.hinweis);
    // Die Sidebar-Leaf aus einem früheren Lauf überlebt den Reload mit einer View-Instanz aus dem ALTEN Code — sie sieht
    // richtig aus, ist aber an nichts mehr angeschlossen. Abräumen; der open-controls-Befehl erzeugt gleich eine frische.
    await cdp.evaluate(`app.workspace.detachLeavesOfType(${JSON.stringify(CONTROLS_VIEW)}); await new Promise((r) => setTimeout(r, 300)); return true;`);
    console.log(`${neu.hinweis}\n`);

    // Alle Namen, die dieser Treiber je anlegt, tragen das Praefix `_tdcb-` (SMOKE_NOTE_*/
    // SMOKE_MODEL_* oben, ausnahmslos) — das macht liegen gebliebene Dateien aus einem per
    // SIGINT/SIGTERM abgebrochenen frueheren Lauf erkennbar, BEVOR dieser Lauf selbst welche
    // anlegt. Ohne diesen Punkt faellt so ein Rest still unter den Tisch: `createdNotes` ist
    // in diesem Lauf leer, das `finally` raeumt also nur eigene Spuren weg, nie fremde.
    const leftover = await cdp.evaluate<string[]>(`
      return app.vault.getFiles().map((f) => f.path).filter((p) => p.startsWith("_tdcb-"));
    `);
    record(
      "Keine liegen gebliebenen Smoke-Dateien aus einem abgebrochenen frueheren Lauf",
      leftover.length === 0,
      leftover.length === 0
        ? "kein Rest im Vault"
        : `${leftover.length} Datei(en) gefunden und entfernt: ${leftover.join(", ")} — vermutlich Ctrl-C/Crash im vorigen Lauf vor dessen Aufraeumen; dieser Lauf faehrt normal weiter`,
    );
    if (leftover.length > 0) {
      await cdp.evaluate(`
        for (const path of ${JSON.stringify(leftover)}) {
          const file = app.vault.getAbstractFileByPath(path);
          if (file) await app.vault.delete(file);
        }
        return true;
      `);
    }

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

      // ⚠️ Feste Reihenfolge statt der von getFiles(): Obsidian legt sie nicht fest, und je nach
      // Instanzstart war das erste ladbare Modell eines ohne auswählbaren Knoten (E1-E8
      // übersprungen: 68 gegenüber 78 Punkten, gemessen 2026-10-01). Die benannte Fixture-Datei
      // geht vor, der Rest wird nach Pfad sortiert.
      const preferred = ${JSON.stringify(PREFERRED_MODEL)};
      const candidates = app.vault.getFiles()
        .filter((f) => /\\.(glb|gltf)$/i.test(f.path) && !/\\.edit\\./.test(f.path))
        .sort((a, b) => (a.path === preferred ? -1 : b.path === preferred ? 1 : a.path.localeCompare(b.path)));
      const skipped = [];
      for (const file of candidates) {
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
    // so zurück, wie er ihn vorgefunden hat. `schliesse` räumt im Normalweg auf und meldet den
    // Schritt ab; nach Ctrl-C hat das Abbruch-Modul ihn schon gefahren und beendet den Prozess selbst.
    await zustand.schliesse();
    if (istAbgebrochen()) return;
    cdp.close();
  }

  bilanz.abschluss();
}

runDriver(main);
