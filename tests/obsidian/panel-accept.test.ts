import { describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile } from "obsidian";
import { acceptText } from "../../src/core/shapes/panel-state";
import { acceptPanel, AcceptAsModal, readTargetText, type AcceptEnv } from "../../src/obsidian/panel-accept";
import type { PanelState, PanelTarget, ShapesRound } from "../../src/core/shapes/panel-state";
import { pushRound, type Rounds } from "../../src/vendor/kit/rounds";
import { EMPTY_ROUNDS } from "../../src/vendor/kit/rounds";
import { DEFAULT_SETTINGS, type PluginSettings } from "../../src/core/settings-types";
import type { RawChange } from "../../src/core/shapes/protocol";
import { PANEL_TEXTS } from "../../src/i18n/strings";

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
const UP = [{ op: "change" as const, name: "Platte", at: [0, 0.925, 0] }];
const stateOf = (target: PanelTarget, ...rs: ShapesRound[]): PanelState => ({ target, rounds: rounds(...rs) });

interface Opts {
  editorOpen?: boolean; // n.md im Quellmodus offen (Schreibweg + lastEditor)
  settings?: Partial<PluginSettings>;
  choose?: AcceptEnv["choose"];
  attachments?: string[];
  onCreateFails?: boolean;
  replaceSelectionThrows?: boolean;
  noEditorView?: boolean;
  /** Offene ShapesFileView von Anhänge/Tisch.shapes: `data` ist ihr ungespeicherter Puffer. */
  shapesView?: { data: string };
  previewMode?: boolean;
}

function setup(files: Record<string, string>, opts: Opts = {}) {
  const store = { ...files };
  const selections: string[] = [];
  const tfile = (path: string) =>
    Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.[^.]+$/, ""), extension: path.split(".").pop()!, name: path.split("/").pop()! });
  const replaceCalls: string[] = [];
  const editor = {
    getValue: () => store["n.md"],
    replaceRange: (text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) => {
      replaceCalls.push(text);
      const lines = store["n.md"].split("\n");
      const head = [...lines.slice(0, from.line), lines[from.line].slice(0, from.ch)].join("\n");
      const tail = [lines[to.line].slice(to.ch), ...lines.slice(to.line + 1)].join("\n");
      store["n.md"] = head + text + tail;
    },
    replaceSelection: (text: string) => {
      if (opts.replaceSelectionThrows) throw new Error("editor gone");
      selections.push(text);
      store["n.md"] += text; // Cursor am Ende: genuegt fuer den Test
    },
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
  const env: AcceptEnv = {
    app: app as never,
    ports,
    settings: () => ({ ...DEFAULT_SETTINGS, ...opts.settings }),
    lastEditor: () => (opts.noEditorView ? null : (view as never)),
    choose: opts.choose,
  };
  return { env, store, selections, app, processCalls, replaced: () => replaceCalls.length, viewLeaf };
}

const NOTE = ["intro", "```shapes", TABLE, "```", "outro"].join("\n");
const BLOCK: PanelTarget = { kind: "shapes-block", path: "n.md", lineStart: 1, lineEnd: 4, label: "Tisch", body: TABLE };
const FILE: PanelTarget = { kind: "shapes-file", path: "Anhänge/Tisch.shapes", label: "Tisch" };

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
    expect(r).toEqual({ ok: true, message: "Applied to Tisch." });
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
    const staleB: PanelTarget = { kind: "shapes-block", path: "n.md", lineStart: 4, lineEnd: 6, label: "B", body: "box B size 2 at 0 0 0" };
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
  it("also works through the open editor", async () => {
    const { env, store } = setup({ "n.md": NOTE }, { editorOpen: true });
    expect((await acceptPanel(env, stateOf(BLOCK, refine(UP)))).ok).toBe(true);
    expect(store["n.md"]).toContain("at 0 0.925 0");
  });
  it("refuses when the block moved and writes nothing", async () => {
    const moved = ["new line", ...NOTE.split("\n")].join("\n");
    const { env, store } = setup({ "n.md": moved });
    const r = await acceptPanel(env, stateOf(BLOCK, refine(UP)));
    expect(r).toEqual({ ok: false, message: "The block moved — nothing was applied." });
    expect(store["n.md"]).toBe(moved);
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

describe("acceptPanel — target new", () => {
  const NEW: PanelTarget = { kind: "new" };
  const MODEL = "title: Tisch\nbox Platte size 1 1 1 at 0 0 0";
  it("as block: inserts a shapes block at the cursor", async () => {
    const { env, selections } = setup({ "n.md": "intro" }, { settings: { acceptAs: "block" } });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(true);
    expect(selections).toEqual([`\n\`\`\`shapes\n${MODEL}\n\`\`\`\n`]);
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
    const { env, store } = setup({ "n.md": "intro" }, { settings: { acceptAs: "file" }, replaceSelectionThrows: true });
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
  it("ask with choose → null writes nothing", async () => {
    const choose = vi.fn(async () => null);
    const { env, store, selections } = setup({ "n.md": "intro" }, { settings: { acceptAs: "ask" }, choose });
    const r = await acceptPanel(env, stateOf(NEW, create(MODEL)));
    expect(r.ok).toBe(false);
    expect(choose).toHaveBeenCalledOnce();
    expect(selections).toEqual([]);
    expect(Object.keys(store)).toEqual(["n.md"]);
  });
  it("ask with choose → file / block follows the choice", async () => {
    const a = setup({ "n.md": "intro" }, { settings: { acceptAs: "ask" }, choose: async () => "file" });
    expect((await acceptPanel(a.env, stateOf(NEW, create(MODEL)))).ok).toBe(true);
    expect(a.store["Anhänge/Tisch.shapes"]).toBeDefined();
    const b = setup({ "n.md": "intro" }, { settings: { acceptAs: "ask" }, choose: async () => "block" });
    expect((await acceptPanel(b.env, stateOf(NEW, create(MODEL)))).ok).toBe(true);
    expect(b.selections).toHaveLength(1);
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

describe("AcceptAsModal", () => {
  const open = () => {
    const results: ("block" | "file" | null)[] = [];
    const modal = new AcceptAsModal({} as never, (c) => results.push(c));
    modal.open();
    const buttons = () => ((modal.contentEl as unknown as { children: { children: unknown }[] }).children[0].children as unknown as { tagName: string; textContent: string; click: () => void; focus: () => void }[]).filter((c) => c.tagName === "BUTTON");
    return { modal, results, buttons };
  };
  it("has a title and two real buttons with text; the first gets focus", () => {
    const { modal, buttons } = open();
    expect(modal.titleEl.textContent).toBe(PANEL_TEXTS.acceptAsTitle);
    expect(buttons().map((b) => b.textContent)).toEqual([PANEL_TEXTS.acceptAsBlock, PANEL_TEXTS.acceptAsFile]);
    expect(buttons()[0].focus).toHaveBeenCalled();
  });
  it("resolves the clicked choice exactly once (trailing onClose does not resolve again)", () => {
    const { results, buttons } = open();
    const [first, second] = buttons();
    second.click();
    first.click();
    expect(results).toEqual(["file"]);
  });
  it("resolves null when closed without a choice, once", () => {
    const { modal, results } = open();
    modal.close();
    modal.close();
    expect(results).toEqual([null]);
  });
});
