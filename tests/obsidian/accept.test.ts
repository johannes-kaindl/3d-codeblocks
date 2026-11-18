import { describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile } from "obsidian";
import { acceptText } from "../../src/core/shapes/panel-state";
import { acceptKind, acceptSpecFor, buildAcceptEnv, readTargetText, saveOpenShapesViews, type AcceptOutcome } from "../../src/obsidian/accept";
import { acceptPanel as acceptWithKit, type AcceptEnv as KitAcceptEnv } from "../../src/vendor/kit-obsidian/panel-accept";
import type { PanelState, PanelTarget, ShapesRound } from "../../src/core/shapes/panel-state";
import { pushRound, type Rounds } from "../../src/vendor/kit/rounds";
import { EMPTY_ROUNDS } from "../../src/vendor/kit/rounds";
import type { PluginSettings } from "../../src/core/settings-types";
import type { RawChange } from "../../src/core/shapes/protocol";
import { PANEL_TEXTS } from "../../src/i18n/strings";

// Seit K9 Etappe 3 schreibt der Kit-Rahmen (Station 7) mit der Beschreibung dieses Plugins; die Kette der Kit-Aufrufe, wie `acceptVia` des Rahmens sie macht
// (erst `prepare`, dann `acceptPanel` des Kits mit der Beschreibung ohne `beforeWrite`), steht hier einmal nach, damit die Fälle dieser Datei weiter an der
// echten Beschreibung und am echten Kit-Schreibweg laufen. Den Schnappschuss setzt der Rahmen (Kit-Test, GUI-Smoke PP34); hier ist keiner im Spiel.
type AcceptEnv = KitAcceptEnv;
const whereOf = new WeakMap<object, "block" | "file" | undefined>();
async function acceptPanel(env: AcceptEnv, state: PanelState): Promise<AcceptOutcome> {
  try {
    await saveOpenShapesViews(env.app, state);
  } catch (error) {
    return { ok: false, message: env.strings.notApplied(error instanceof Error ? error.message : String(error)) };
  }
  return acceptWithKit(env, acceptSpecFor(state), state.target, acceptKind(state), whereOf.get(env));
}

vi.mock("../../src/core/shapes/panel-state", async (orig) => {
  const mod = await orig<typeof import("../../src/core/shapes/panel-state")>();
  return { ...mod, acceptText: vi.fn(mod.acceptText) };
});

const TABLE = "box Platte size 1.2 0.05 0.7 at 0 0.725 0\nbox Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3";
const refine = (changes: RawChange[], text = TABLE): ShapesRound => ({
  kind: "refine", instruction: "x", changes, basedOn: null, text, diff: [], model: "m", at: 1,
});
const create = (text: string): ShapesRound => ({ kind: "create", instruction: "x", text, model: "m", at: 1 });
const rounds = (...rs: ShapesRound[]): Rounds<ShapesRound> => rs.reduce((a, r) => pushRound(a, r), EMPTY_ROUNDS as Rounds<ShapesRound>);
const retargetOf = (r: AcceptOutcome): PanelTarget | undefined => ("retarget" in r ? r.retarget : undefined);
const UP = [{ op: "change" as const, name: "Platte", at: [0, 0.925, 0] }];
const stateOf = (target: PanelTarget, ...rs: ShapesRound[]): PanelState => ({ target, rounds: rounds(...rs) });

interface Opts {
  editorOpen?: boolean; // n.md im Quellmodus offen (Schreibweg + lastEditor)
  /** Der Schreibweg beim neuen Ziel (früher die Einstellung `acceptAs`; seit K9 ein Knopf je Weg, `where` am Weg). */
  settings?: Partial<Pick<PluginSettings, "acceptAs">>;
  attachments?: string[];
  onCreateFails?: boolean;
  /** Der Editor wirft beim Schreiben (kit 0.86.0: `insertAtCursor` schreibt über `replaceRange` am Hauptcursor, nie über `replaceSelection`). */
  replaceRangeThrows?: boolean;
  noEditorView?: boolean;
  /** Offene ShapesFileView von Anhänge/Tisch.shapes: `data` ist ihr ungespeicherter Puffer. */
  shapesView?: { data: string };
  previewMode?: boolean;
  /** Auswahl im Editor: Ende (`to`) der Auswahl. */
  selection?: { to: { line: number; ch: number } };
  cursorLine?: number;
}

function setup(files: Record<string, string>, opts: Opts = {}) {
  const store = { ...files };
  const tfile = (path: string) =>
    Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.[^.]+$/, ""), extension: path.split(".").pop()!, name: path.split("/").pop()! });
  const replaceCalls: string[] = [];
  // Schreibaufrufe genau an der Cursorstelle ohne Auswahl (früher `replaceSelection`); gezielte Einfügungen hinter Zaun, Auswahl oder Frontmatter zählen nicht.
  const selections: string[] = [];
  const editor = {
    getValue: () => store["n.md"],
    somethingSelected: () => opts.selection !== undefined,
    getCursor: (which?: string) => (which === "to" && opts.selection ? opts.selection.to : { line: opts.cursorLine ?? 0, ch: 0 }),
    replaceRange: (text: string, from: { line: number; ch: number }, to: { line: number; ch: number } = from) => {
      if (opts.replaceRangeThrows) throw new Error("editor gone");
      replaceCalls.push(text);
      const cursor = { line: opts.cursorLine ?? 0, ch: 0 };
      if (opts.selection === undefined && from.line === cursor.line && from.ch === cursor.ch) selections.push(text);
      const lines = store["n.md"].split("\n");
      const head = [...lines.slice(0, from.line), lines[from.line].slice(0, from.ch)].join("\n");
      const tail = [lines[to.line].slice(to.ch), ...lines.slice(to.line + 1)].join("\n");
      store["n.md"] = head + text + tail;
    },
    // Nie gerufen: ein Aufruf wäre der Rückfall auf den Mehrfach-Cursor-Weg (Kit 0.86.0).
    replaceSelection: () => { throw new Error("replaceSelection darf nicht mehr gerufen werden"); },
  };
  const view = Object.assign(new MarkdownView({} as never), { file: tfile("n.md"), editor });
  (view as unknown as { mode: string }).mode = opts.previewMode ? "preview" : "source";
  const processCalls: string[] = [];
  const viewLeaf = opts.shapesView
    ? {
        view: {
          file: { path: "Anhänge/Tisch.shapes" },
          save: vi.fn(async () => { store["Anhänge/Tisch.shapes"] = opts.shapesView!.data; }),
          getViewData: () => opts.shapesView!.data,
        },
      }
    : null;
  const app = {
    workspace: { getLeavesOfType: (type: string) => (type === "tdcb-shapes-file" && viewLeaf ? [viewLeaf] : []) },
    vault: {
      getAbstractFileByPath: (p: string) => (p in store ? tfile(p) : null),
      read: async (f: TFile) => store[f.path],
      process: vi.fn(async (f: TFile, fn: (t: string) => string) => {
        processCalls.push(f.path);
        store[f.path] = fn(store[f.path]); // wirft fn, bleibt der Store unveraendert
      }),
      create: vi.fn(async (path: string, data: string) => {
        if (opts.onCreateFails) throw new Error("disk full");
        if (path in store) throw new Error("File already exists.");
        store[path] = data;
        return tfile(path);
      }),
      adapter: { exists: async (p: string) => Object.keys(store).some((k) => k.toLowerCase() === p.toLowerCase()) },
    },
    metadataCache: { fileToLinktext: (f: TFile) => f.name },
    fileManager: {
      // Absichtlich NICHT kollisionsfrei, wenn `attachments` die Namen schon belegt: der zweite Gurt muss tragen.
      getAvailablePathForAttachment: async (name: string) => `Anhänge/${name}`,
    },
  };
  const ports = {
    editorFor: (p: string) => (opts.editorOpen && p === "n.md" ? editor : null),
    vault: {
      read: async (p: string) => store[p],
      process: async (p: string, fn: (t: string) => string) => {
        processCalls.push(p);
        store[p] = fn(store[p]);
      },
    },
  };
  const env: AcceptEnv = buildAcceptEnv({
    app: app as never,
    ports,
    lastEditor: () => (opts.noEditorView ? null : (view as never)),
  });
  whereOf.set(env, opts.settings?.acceptAs);
  return { env, store, selections, app, processCalls, replaced: () => replaceCalls.length, viewLeaf };
}

const NOTE = ["intro", "```shapes", TABLE, "```", "outro"].join("\n");
const BLOCK: PanelTarget = { kind: "block", path: "n.md", lineStart: 1, lineEnd: 4, label: "Tisch", body: TABLE };
const FILE: PanelTarget = { kind: "file", path: "Anhänge/Tisch.shapes", label: "Tisch" };

describe("readTargetText", () => {
  it("returns the fence body of a shapes block", async () => {
    const { env } = setup({ "n.md": NOTE });
    expect(await readTargetText(env, BLOCK)).toBe(TABLE);
  });
  it("is null for out-of-range lines (the model is gone)", async () => {
    const { env } = setup({ "n.md": NOTE });
    expect(await readTargetText(env, { ...BLOCK, lineStart: 40, lineEnd: 42 })).toBeNull();
  });
  it("strips CRLF line ends", async () => {
    const { env } = setup({ "n.md": NOTE.replace(/\n/g, "\r\n") });
    const text = await readTargetText(env, BLOCK);
    expect(text).toBe(TABLE);
    expect(text).not.toContain("\r");
  });
  it("is null when the fence there is not a shapes fence or closes elsewhere", async () => {
    const { env } = setup({ "n.md": ["intro", "```python", "x = 1", "```", "outro"].join("\n") });
    expect(await readTargetText(env, BLOCK)).toBeNull();
    const two = setup({ "n.md": NOTE });
    expect(await readTargetText(two.env, { ...BLOCK, lineEnd: 3 })).toBeNull();
  });
  it("reads the open editor buffer, not the stale file", async () => {
    const { env, store } = setup({ "n.md": NOTE }, { editorOpen: true });
    const stale = NOTE;
    store["n.md"] = NOTE.replace("1.2", "9.9");
    expect(stale).not.toBe(store["n.md"]);
    expect(await readTargetText(env, { ...BLOCK, body: TABLE.replace("1.2", "9.9") })).toContain("9.9");
  });
  it("reads a shapes file and returns null for a missing file or another target kind", async () => {
    const { env } = setup({ "Anhänge/Tisch.shapes": TABLE + "\n" });
    expect(await readTargetText(env, FILE)).toBe(TABLE + "\n");
    expect(await readTargetText(env, { ...FILE, path: "weg.shapes" })).toBeNull();
    expect(await readTargetText(env, { kind: "new" })).toBeNull();
  });
});

describe("acceptPanel — target shapes-block", () => {
  it("applies to a block whose text still matches the clicked block", async () => {
    const { env, store } = setup({ "n.md": NOTE });
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r).toMatchObject({ ok: true, message: "Applied to Tisch." });
    expect(store["n.md"]).toBe(NOTE.replace("at 0 0.725 0", "at 0 0.925 0"));
  });
  it("tolerates CRLF notes and a trailing newline in the clicked body", async () => {
    const { env, store } = setup({ "n.md": NOTE.replace(/\n/g, "\r\n") });
    const r = await acceptPanel(env, stateOf({ ...BLOCK, body: TABLE.replace(/\n/g, "\r\n") + "\r\n" }, refine(UP)));
    expect(r.ok).toBe(true);
    expect(store["n.md"]).toContain("at 0 0.925 0");
    expect(store["n.md"]).toContain("\r\n");
  });
  it("refuses when the block body was hand-edited since the click, and writes nothing", async () => {
    const hand = NOTE.replace("-0.55 0.35 -0.3", "-0.5 0.35 -0.3");
    const { env, store } = setup({ "n.md": hand });
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r).toEqual({ ok: false, message: "The block changed — nothing was applied." });
    expect(store["n.md"]).toBe(hand);
    expect(await readTargetText(env, BLOCK)).toBeNull();
  });
  describe("stale target after a block above was deleted (A deleted, B target now hits C)", () => {
    const A = ["```shapes", "box A size 1 at 0 0 0", "```"];
    const B = ["```shapes", "box B size 2 at 0 0 0", "```"];
    const C = ["```shapes", "box C size 3 at 0 0 0", "```"];
    const before = ["x", ...A, ...B, ...C].join("\n");
    const afterDelete = ["x", ...B, ...C].join("\n");
    // B stand in `before` bei Zeilen 4-6; nach dem Loeschen von A trifft 4-6 jetzt den Block C.
    const staleB: PanelTarget = { kind: "block", path: "n.md", lineStart: 4, lineEnd: 6, label: "B", body: "box B size 2 at 0 0 0" };
    it("sanity: the stale position really hits C", () => {
      expect(before.split("\n")[5]).toBe("box B size 2 at 0 0 0");
      expect(afterDelete.split("\n")[4]).toBe("```shapes");
      expect(afterDelete.split("\n")[5]).toBe("box C size 3 at 0 0 0");
    });
    it("refine chain: refused, C untouched", async () => {
      const { env, store } = setup({ "n.md": afterDelete });
      const r = await acceptPanel(env, stateOf(staleB, refine([{ op: "change", name: "C", size: [9, 9, 9] }], "box B size 2 at 0 0 0")));
      expect(r).toEqual({ ok: false, message: "The block changed — nothing was applied." });
      expect(store["n.md"]).toBe(afterDelete);
      expect(await readTargetText(env, staleB)).toBeNull();
    });
    it("add-only chain: refused, C untouched", async () => {
      const { env, store } = setup({ "n.md": afterDelete });
      const add = [{ op: "add" as const, part: { op: "add", name: "D", shape: "box", size: [1, 1, 1] } }];
      const r = await acceptPanel(env, stateOf(staleB, refine(add, "box B size 2 at 0 0 0")));
      expect(r.ok).toBe(false);
      expect(store["n.md"]).toBe(afterDelete);
    });
  });
  it("returns a retarget with the written body and the recomputed closing line; a second apply on it works", async () => {
    const { env, store } = setup({ "n.md": NOTE });
    const first = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(first.ok).toBe(true);
    const lines = store["n.md"].split("\n");
    expect(retargetOf(first)).toMatchObject({ kind: "block", path: "n.md", lineStart: 1, label: "Tisch" });
    const rt = retargetOf(first) as Extract<PanelTarget, { kind: "block" }>;
    expect(lines[rt.lineEnd]).toBe("```");
    expect(rt.body).toBe(lines.slice(rt.lineStart + 1, rt.lineEnd).join("\n"));
    // Zweites Aendern auf dem frischen Ziel, auch mit einem Block, der durch Add laenger wird.
    const add = [{ op: "add" as const, part: { op: "add", name: "Fuss", shape: "box", size: [1, 1, 1] } }];
    const second = await acceptPanel(env, stateOf(rt, refine(add)));
    expect(second.ok).toBe(true);
    expect(store["n.md"]).toContain("Fuss");
    const rt2 = retargetOf(second) as Extract<PanelTarget, { kind: "block" }>;
    expect(store["n.md"].split("\n")[rt2.lineEnd]).toBe("```");
    expect(store["n.md"].endsWith("```\noutro")).toBe(true);
    // Mit dem ALTEN Ziel waere der zweite Apply verweigert worden.
    expect((await acceptPanel(env, stateOf(BLOCK, refine(add)))).ok).toBe(false);
  });
  it("failures carry no retarget", async () => {
    const { env } = setup({ "n.md": NOTE });
    expect(retargetOf(await acceptPanel(env, stateOf({ ...BLOCK, body: "other" }, refine(UP))))).toBeUndefined();
  });
  it("also works through the open editor", async () => {
    const { env, store } = setup({ "n.md": NOTE }, { editorOpen: true });
    expect((await acceptPanel(env, stateOf(BLOCK, refine(UP)))).ok).toBe(true);
    expect(store["n.md"]).toContain("at 0 0.925 0");
  });
  it("refuses when the block is gone and writes nothing", async () => {
    const gone = ["intro", "outro"].join("\n");
    const { env, store } = setup({ "n.md": gone });
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r).toEqual({ ok: false, message: "The block moved — nothing was applied." });
    expect(store["n.md"]).toBe(gone);
  });
  it("refuses when a line above moved the block and an identical twin makes the new place ambiguous", async () => {
    const twins = ["new line", ...NOTE.split("\n"), ...NOTE.split("\n")].join("\n");
    const { env, store } = setup({ "n.md": twins });
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r).toEqual({ ok: false, message: "The block moved — nothing was applied." });
    expect(store["n.md"]).toBe(twins);
  });
  it("reports a changed note (BlockChangedError) and writes nothing", async () => {
    const { env, store } = setup({ "n.md": NOTE });
    // Die Notiz aendert sich zwischen Lesen und Schreiben: process liest einen anderen Text als read.
    const reads = env.ports.vault.read;
    env.ports.vault.read = async (p: string) => {
      const text = await reads(p);
      store["n.md"] = text.replace("1.2", "7.7"); // jemand tippt nach dem Lesen
      return text;
    };
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r).toEqual({ ok: false, message: "The note changed — nothing was applied." });
    expect(store["n.md"]).toBe(NOTE.replace("1.2", "7.7"));
  });
  it("refuses a create root on an existing block", async () => {
    const { env, store } = setup({ "n.md": NOTE });
    const r = await acceptPanel(env, stateOf(BLOCK, create("box Neu size 1 1 1 at 0 0 0")));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("A new model can't replace an existing one — use New");
    expect(store["n.md"]).toBe(NOTE);
  });
  it("refuses an unusable chain without writing", async () => {
    const { env, store } = setup({ "n.md": NOTE });
    const r = await acceptPanel(env, stateOf(BLOCK, refine([{ op: "change", name: "Gibtsnicht", at: [0, 0, 0] }])));
    expect(r.ok).toBe(false);
    expect(store["n.md"]).toBe(NOTE);
  });
  it("writes nothing when the chain changes nothing", async () => {
    const { env, store } = setup({ "n.md": NOTE });
    const r = await acceptPanel(env, stateOf(BLOCK, refine([{ op: "change", name: "Platte", at: [0, 0.725, 0] }])));
    expect(r.ok).toBe(true);
    expect(store["n.md"]).toBe(NOTE);
  });
});

describe("acceptPanel — nothing changes", () => {
  it("a chain that changes nothing writes nothing (block, open editor and vault path)", async () => {
    const noop = refine([{ op: "change", name: "Platte", at: [0, 0.725, 0] }]);
    const viaVault = setup({ "n.md": NOTE });
    expect((await acceptPanel(viaVault.env, stateOf(BLOCK, noop))).ok).toBe(true);
    expect(viaVault.processCalls).toEqual([]);
    expect(viaVault.store["n.md"]).toBe(NOTE);
    const viaEditor = setup({ "n.md": NOTE }, { editorOpen: true });
    expect((await acceptPanel(viaEditor.env, stateOf(BLOCK, noop))).ok).toBe(true);
    expect(viaEditor.replaced()).toBe(0);
    const file = setup({ "Anhänge/Tisch.shapes": TABLE + "\n" });
    const before = file.store["Anhänge/Tisch.shapes"];
    expect((await acceptPanel(file.env, stateOf(FILE, noop))).ok).toBe(true);
    expect(file.store["Anhänge/Tisch.shapes"]).toBe(before);
  });
});

describe("acceptPanel — fence closing guard", () => {
  // Kein Aenderungsweg erzeugt heute eine Zaunzeile im Rumpf; der Wächter ist ein Gurt fuer kuenftige Schreibwege,
  // deshalb wird `acceptText` hier gezielt ueberschrieben.
  const note = (marker: string) => ["intro", `${marker}shapes`, TABLE, marker, "outro"].join("\n");
  const withText = (text: string) =>
    vi.mocked(acceptText).mockReturnValueOnce({ ok: true, text, unchanged: false });
  it("refuses a body line that would close the ACTUAL opening fence, writes nothing", async () => {
    const { env, store } = setup({ "n.md": note("````") });
    withText(`${TABLE}\n\`\`\`\`\nbox X size 1 at 0 0 0`);
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("would close the code block");
    expect(store["n.md"]).toBe(note("````"));
  });
  it("a shorter fence line is harmless inside a longer fence", async () => {
    const { env, store } = setup({ "n.md": note("````") });
    withText(`${TABLE}\n\`\`\`\nbox X size 1 at 0 0 0`);
    expect((await acceptPanel(env, stateOf(BLOCK, refine(UP)))).ok).toBe(true);
    expect(store["n.md"]).toContain("box X size 1");
  });
  it("a tilde line does not close a backtick fence, but a backtick line closes a 3-backtick fence", async () => {
    const a = setup({ "n.md": note("```") });
    withText(`${TABLE}\n~~~`);
    expect((await acceptPanel(a.env, stateOf(BLOCK, refine(UP)))).ok).toBe(true);
    const b = setup({ "n.md": note("```") });
    withText(`${TABLE}\n\`\`\``);
    expect((await acceptPanel(b.env, stateOf(BLOCK, refine(UP)))).ok).toBe(false);
  });
});

describe("acceptPanel — target shapes-file", () => {
  it("applies the chain atomically to the current file text", async () => {
    const { env, store, processCalls } = setup({ "Anhänge/Tisch.shapes": TABLE.replace("-0.55", "-0.5") + "\n" });
    const r = await acceptPanel(env, stateOf(FILE, refine(UP)));
    expect(r.ok).toBe(true);
    expect(processCalls).toContain("Anhänge/Tisch.shapes");
    expect(store["Anhänge/Tisch.shapes"]).toContain("at 0 0.925 0");
    expect(store["Anhänge/Tisch.shapes"]).toContain("-0.5 0.35");
  });
  it("throws inside the callback and writes nothing when acceptText fails", async () => {
    const orig = TABLE + "\n";
    const { env, store } = setup({ "Anhänge/Tisch.shapes": orig });
    const r = await acceptPanel(env, stateOf(FILE, refine([{ op: "remove", name: "Gibtsnicht" }])));
    expect(r.ok).toBe(false);
    expect(store["Anhänge/Tisch.shapes"]).toBe(orig);
  });
  it("refuses a create root on an existing file", async () => {
    const orig = TABLE + "\n";
    const { env, store } = setup({ "Anhänge/Tisch.shapes": orig });
    const r = await acceptPanel(env, stateOf(FILE, create("box Neu size 1 1 1 at 0 0 0")));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("use New");
    expect(store["Anhänge/Tisch.shapes"]).toBe(orig);
  });
  it("saves an open ShapesFileView first and applies the chain to its buffer text", async () => {
    const buffer = TABLE.replace("-0.55", "-0.5") + "\n"; // ungespeicherte Handaenderung im Puffer
    const { env, store, viewLeaf } = setup({ "Anhänge/Tisch.shapes": TABLE + "\n" }, { shapesView: { data: buffer } });
    const r = await acceptPanel(env, stateOf(FILE, refine(UP)));
    expect(r.ok).toBe(true);
    expect(viewLeaf!.view.save).toHaveBeenCalledOnce();
    expect(store["Anhänge/Tisch.shapes"]).toContain("-0.5 0.35");
    expect(store["Anhänge/Tisch.shapes"]).toContain("at 0 0.925 0");
  });
  it("readTargetText of a file reads the open view buffer, not the disk", async () => {
    const { env } = setup({ "Anhänge/Tisch.shapes": TABLE + "\n" }, { shapesView: { data: "box Neu size 1 at 0 0 0\n" } });
    expect(await readTargetText(env, FILE)).toBe("box Neu size 1 at 0 0 0\n");
  });
  it("reports a deleted file without throwing", async () => {
    const { env } = setup({});
    const r = await acceptPanel(env, stateOf(FILE, refine(UP)));
    expect(r.ok).toBe(false);
    expect(r.message.length).toBeGreaterThan(0);
  });
});

describe("acceptPanel — block behind a list marker (kit 0.98.0)", () => {
  it("refuses with the plugin's own text before anything is computed or written", async () => {
    const note = ["intro", "- ```shapes", `  ${TABLE.split("\n")[0]}`, "  ```", "outro"].join("\n");
    const { env, store, processCalls } = setup({ "n.md": note });
    const r = await acceptPanel(env, stateOf({ kind: "block", path: "n.md", lineStart: 1, lineEnd: 3, label: "Tisch", body: TABLE.split("\n")[0]! }, refine(UP)));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("sits in a list item");
    expect(store["n.md"]).toBe(note);
    expect(processCalls).toEqual([]);
  });
});

describe("acceptPanel — target new", () => {
  const NEW: PanelTarget = { kind: "new" };
  const MODEL = "title: Tisch\nbox Platte size 1 1 1 at 0 0 0";
  it("as block: inserts a shapes block at the cursor", async () => {
    const { env, selections } = setup({ "n.md": "intro" }, { settings: { acceptAs: "block" } });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(true);
    expect(selections).toEqual([`\n\`\`\`shapes\n${MODEL}\n\`\`\`\n`]);
  });
  it("as block: the retarget names the block by the title of the shape, or by the plugin's word for an untitled one", async () => {
    const titled = setup({ "n.md": "intro" }, { settings: { acceptAs: "block" }, editorOpen: true });
    const r1 = await acceptPanel(titled.env, stateOf(NEW, create(MODEL)));
    expect(retargetOf(r1)).toMatchObject({ kind: "block", label: "Tisch", path: "n.md" });
    const plain = setup({ "n.md": "intro" }, { settings: { acceptAs: "block" }, editorOpen: true });
    const r2 = await acceptPanel(plain.env, stateOf(NEW, create("box Platte size 1 1 1 at 0 0 0")));
    expect(retargetOf(r2)).toMatchObject({ kind: "block", label: "shapes code block" });
  });
  it("as file: the window works on the created file afterwards (retarget names the file)", async () => {
    const { env } = setup({ "n.md": "intro" }, { settings: { acceptAs: "file" } });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(true);
    expect(retargetOf(r)).toEqual({ kind: "file", path: "Anhänge/Tisch.shapes", label: "Tisch.shapes" });
  });
  it("the description carries no beforeWrite: the frame sets the snapshot, a plugin cannot leave it out or replace it", () => {
    expect(acceptSpecFor(stateOf(NEW, create(MODEL)))).not.toHaveProperty("beforeWrite");
  });
  it("as block with a selection: the selection stays, the block goes after it", async () => {
    const { env, store, selections } = setup({ "n.md": "intro text\nnext" }, { settings: { acceptAs: "block" }, selection: { to: { line: 0, ch: 5 } }, editorOpen: true });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    // Seit K9 liefert ein neu eingefügter Block ein `retarget`: das Fenster arbeitet auf ihm weiter, statt neu zu beginnen (Beschriftung = Titel der Form).
    expect(r).toEqual({
      ok: true,
      message: "Applied to the open note as a code block after the selection.",
      retarget: { kind: "block", path: "n.md", lineStart: 1, lineEnd: 4, label: "Tisch", body: MODEL },
    });
    expect(selections).toEqual([]);
    expect(store["n.md"]).toBe(`intro\n\`\`\`shapes\n${MODEL}\n\`\`\`\n text\nnext`);
  });
  it("as block with the cursor INSIDE a fence: inserted after that fence, not into it", async () => {
    const note = ["a", "```js", "x()", "```", "b"].join("\n");
    const { env, store, selections } = setup({ "n.md": note }, { settings: { acceptAs: "block" }, cursorLine: 2 });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.message).toBe("Applied to the open note as a code block after the code block at the cursor.");
    expect(selections).toEqual([]);
    expect(store["n.md"]).toBe(["a", "```js", "x()", "```", "", "```shapes", MODEL, "```", "", "b"].join("\n"));
  });
  it("as block with a selection ending INSIDE a fence: inserted after that fence, the selection stays", async () => {
    const note = ["a", "```js", "x()", "y()", "```", "b"].join("\n");
    const { env, store } = setup({ "n.md": note }, { settings: { acceptAs: "block" }, selection: { to: { line: 2, ch: 3 } } });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.message).toBe("Applied to the open note as a code block after the code block at the selection.");
    expect(store["n.md"]).toBe(["a", "```js", "x()", "y()", "```", "", "```shapes", MODEL, "```", "", "b"].join("\n"));
  });
  it("as block with the cursor in a fence that is never closed: refused with a message, nothing written", async () => {
    const note = ["a", "```js", "x()", "y()"].join("\n");
    const { env, store, selections } = setup({ "n.md": note }, { settings: { acceptAs: "block" }, cursorLine: 2 });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/never closed.*nothing was applied/i);
    expect(selections).toEqual([]);
    expect(store["n.md"]).toBe(note);
  });
  it("as block with the cursor in a fence inside a quote or callout: refused with the plugin's own text (Kit 0.86.0), nothing written", async () => {
    const note = ["a", "> ```js", "> x()", "> ```", "b"].join("\n");
    const { env, store, selections } = setup({ "n.md": note }, { settings: { acceptAs: "block" }, cursorLine: 2 });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(false);
    expect(r.message).toBe("The cursor is in a code block inside a quote, callout or list — nothing was applied. Move it outside and try again.");
    expect(selections).toEqual([]);
    expect(store["n.md"]).toBe(note);
  });
  it("as block with the selection ending in a fence that is never closed: refused too", async () => {
    const note = ["a", "```js", "x()"].join("\n");
    const { env, store } = setup({ "n.md": note }, { settings: { acceptAs: "block" }, selection: { to: { line: 2, ch: 1 } } });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(false);
    expect(store["n.md"]).toBe(note);
  });
  it("inserting after a fence in a CRLF note keeps the line endings uniform", async () => {
    const note = ["a", "```js", "x()", "```", "b"].join("\r\n");
    const { env, store } = setup({ "n.md": note }, { settings: { acceptAs: "block" }, cursorLine: 2 });
    expect((await acceptPanel(env, stateOf(NEW, create(MODEL)))).ok).toBe(true);
    expect(store["n.md"].replace(/\r\n/g, "")).not.toContain("\n");
  });
  it("the file way inserts its reference with the same rules", async () => {
    const note = ["a", "```js", "x()", "```", "b"].join("\n");
    const { env, store } = setup({ "n.md": note }, { settings: { acceptAs: "file" }, cursorLine: 1 });
    expect((await acceptPanel(env, stateOf(NEW, create(MODEL)))).ok).toBe(true);
    expect(store["n.md"]).toBe(["a", "```js", "x()", "```", "", "```3d", "file: Tisch.shapes", "```", "", "b"].join("\n"));
  });
  it("file way with a note in reading view says so", async () => {
    const { env } = setup({ "n.md": "intro" }, { settings: { acceptAs: "file" }, previewMode: true });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(true);
    expect(r.message).toContain("reading view");
  });
  it("as block without an open note: noNoteOpen, nothing written", async () => {
    const { env, selections, store } = setup({}, { settings: { acceptAs: "block" }, noEditorView: true });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r).toEqual({ ok: false, message: PANEL_TEXTS.noNoteOpen });
    expect(selections).toEqual([]);
    expect(Object.keys(store)).toEqual([]);
  });
  it("as block with a note in reading mode: noNoteOpen", async () => {
    const { env, selections } = setup({ "n.md": "intro" }, { settings: { acceptAs: "block" }, previewMode: true });
    expect(await acceptPanel(env, stateOf(NEW, create(MODEL)))).toEqual({ ok: false, message: PANEL_TEXTS.noteInReadingView });
    expect(selections).toEqual([]);
  });
  it("as file: creates the file and inserts a reference", async () => {
    const { env, store, selections } = setup({ "n.md": "intro" }, { settings: { acceptAs: "file" } });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(true);
    expect(store["Anhänge/Tisch.shapes"]).toBe(MODEL + "\n");
    expect(selections).toEqual(["\n```3d\nfile: Tisch.shapes\n```\n"]);
  });
  it("as file: NEVER overwrites an existing file", async () => {
    const { env, store, app } = setup({ "n.md": "intro", "Anhänge/Tisch.shapes": "KOSTBAR" }, { settings: { acceptAs: "file" } });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(false);
    expect(store["Anhänge/Tisch.shapes"]).toBe("KOSTBAR");
    expect(app.vault.create).not.toHaveBeenCalled();
  });
  it("as file: a case-variant name the path helper overlooks is also not overwritten", async () => {
    const { env, store } = setup({ "n.md": "intro", "anhänge/tisch.shapes": "KOSTBAR" }, { settings: { acceptAs: "file" } });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(false);
    expect(store["anhänge/tisch.shapes"]).toBe("KOSTBAR");
    expect(Object.keys(store)).toHaveLength(2);
  });
  it("as file: a failing reference insert still reports the file as created", async () => {
    const { env, store } = setup({ "n.md": "intro" }, { settings: { acceptAs: "file" }, replaceRangeThrows: true });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Anhänge/Tisch.shapes");
    expect(r.message).toMatch(/reference could not be inserted/);
    expect(store["Anhänge/Tisch.shapes"]).toBe(MODEL + "\n");
  });
  it("as file without an open note: file created, message says no reference", async () => {
    const { env, store } = setup({}, { settings: { acceptAs: "file" }, noEditorView: true });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(true);
    expect(store["Anhänge/Tisch.shapes"]).toBe(MODEL + "\n");
  });
  it("as file: a failing create is a failure", async () => {
    const { env } = setup({ "n.md": "intro" }, { settings: { acceptAs: "file" }, onCreateFails: true });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("disk full");
  });
  it("a refine-only chain on a new target is refused", async () => {
    const { env, selections } = setup({ "n.md": "intro" });
    const r = await acceptPanel(env, stateOf(NEW, refine(UP)));
    expect(r.ok).toBe(false);
    expect(selections).toEqual([]);
  });
});

describe("acceptPanel — other and robustness", () => {
  it("other targets are unsupported", async () => {
    const { env } = setup({});
    expect(await acceptPanel(env, stateOf({ kind: "other", label: "Szene" }, refine(UP)))).toEqual({ ok: false, message: PANEL_TEXTS.unsupported("Szene") });
  });
  it("never rejects, even when ports throw", async () => {
    const { env } = setup({ "n.md": NOTE });
    env.ports.vault.read = async () => { throw new Error("boom"); };
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("boom");
  });
});

describe("W33 — die drei Fehler der früheren eigenen panel-accept.ts (Kit-Baustein)", () => {
  it("1 stale view: a note switch during the file creation must not receive the reference", async () => {
    const MODEL = "title: Tisch\nbox Platte size 1 1 1 at 0 0 0";
    const { env, store, selections, app } = setup({ "n.md": "intro", "m.md": "other" }, { settings: { acceptAs: "file" } });
    const first = env.lastEditor();
    const other = Object.assign(new MarkdownView({} as never), { file: Object.assign(new TFile(), { path: "m.md", name: "m.md" }), editor: { getValue: () => "other", somethingSelected: () => false, getCursor: () => ({ line: 0, ch: 0 }), replaceRange: vi.fn(), replaceSelection: vi.fn() } });
    (other as unknown as { mode: string }).mode = "source";
    let current = first;
    env.lastEditor = () => current as never;
    const create = app.vault.create;
    app.vault.create = vi.fn(async (p: string, d: string) => { const f = await create(p, d); current = other as never; return f; });
    const r = await acceptPanel(env, stateOf({ kind: "new" }, create_(MODEL)));
    expect(r.ok).toBe(true);
    expect(store["Anhänge/Tisch.shapes"]).toBe(MODEL + "\n");
    expect(selections).toEqual([]); // die Referenz gehört in n.md, die inzwischen nicht mehr die aktive Notiz ist
    expect((other.editor.replaceSelection as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
  it("2 an error after the file exists stays ok:true (never 'nothing was applied')", async () => {
    const MODEL = "title: Tisch\nbox Platte size 1 1 1 at 0 0 0";
    const { env, app } = setup({ "n.md": "intro" }, { settings: { acceptAs: "file" } });
    app.metadataCache.fileToLinktext = () => { throw new Error("cache gone"); };
    const r = await acceptPanel(env, stateOf({ kind: "new" }, create_(MODEL)));
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Anhänge/Tisch.shapes");
  });
  it("4 front matter is off limits: a block for the cursor at 0:0 lands after the closing ---", async () => {
    const MODEL = "title: Tisch\nbox Platte size 1 1 1 at 0 0 0";
    const note = ["---", "tags: a", "---", "intro"].join("\n");
    const { env, store, selections } = setup({ "n.md": note }, { settings: { acceptAs: "block" }, cursorLine: 0 });
    const r = await acceptPanel(env, stateOf({ kind: "new" }, create_(MODEL)));
    expect(r.ok).toBe(true);
    expect(selections).toEqual([]); // nicht an der Cursorstelle (replaceSelection), sondern gezielt hinter der Frontmatter (replaceRange)
    expect(store["n.md"].startsWith("---\ntags: a\n---\n")).toBe(true);
    expect(store["n.md"]).toContain("```shapes\n" + MODEL);
  });
  it("3 a line typed above the block during a run: the block is found again, rounds survive via retarget", async () => {
    const { env, store } = setup({ "n.md": ["neu", NOTE].join("\n") });
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r.ok).toBe(true);
    expect(store["n.md"]).toContain("0.925");
    expect(retargetOf(r)).toMatchObject({ lineStart: 2 });
  });
});
const create_ = create;
