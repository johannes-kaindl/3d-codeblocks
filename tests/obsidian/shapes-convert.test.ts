import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import {
  canConvertBlockToFile,
  canConvertFileToBlock,
  convertBlockToFile,
  convertFileToBlock,
} from "../../src/obsidian/shapes-convert";

interface Opts {
  cursorLine?: number;
  activeFile?: string;
  editorPath?: string;
  /** Editor-Puffer weicht vom Vault-Text ab (z. B. ohne BOM) und ist kein Schreibweg (`editorFor` liefert null). */
  vaultOnlyBuffer?: string;
  /** Wird nach dem Anlegen einer Datei aufgerufen (Notiz aendert sich zwischen Suche und Schreiben). */
  onCreate?: (store: Record<string, string>) => void;
  /** Wird bei jedem Lesen der .shapes-Datei aufgerufen (Aufrufnummer ab 1). */
  onShapesRead?: (store: Record<string, string>, call: number) => void;
  trashThrows?: boolean;
  /** Offene ShapesFileView der Datei Anhänge/Tisch.shapes: `data` ist ihr Puffer. */
  shapesView?: { data: string };
  /** Offene Editor-Puffer weiterer Notizen (Pfad -> ungespeicherter Text). */
  extraEditors?: Record<string, string>;
  /** Pfade, die der Adapter als vorhanden meldet (ohne dass die Datei im Store steht). */
  adapterExists?: string[];
}

function setup(files: Record<string, string>, opts: Opts = {}) {
  const store = { ...files };
  const cursor = { line: opts.cursorLine ?? 0 };
  const tfile = (path: string) =>
    Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.[^.]+$/, ""), extension: path.split(".").pop()!, name: path.split("/").pop()! });
  const trashed: string[] = [];
  const notices: string[] = [];
  const events: string[] = [];
  const shapesReads: Record<string, number> = {};
  const editorPath = opts.editorPath ?? "n.md";
  const buffer = () => opts.vaultOnlyBuffer ?? store[editorPath];
  const editor = {
    getValue: buffer,
    getCursor: () => ({ line: cursor.line, ch: 0 }),
    replaceRange: (text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) => {
      events.push("replace");
      const lines = store[editorPath].split("\n");
      const head = [...lines.slice(0, from.line), lines[from.line].slice(0, from.ch)].join("\n");
      const tail = [lines[to.line].slice(to.ch), ...lines.slice(to.line + 1)].join("\n");
      store[editorPath] = head + text + tail;
    },
  };
  const viewPath = "Anhänge/Tisch.shapes";
  const leaf = opts.shapesView
    ? {
        view: {
          file: { path: viewPath },
          save: vi.fn(async () => { events.push("save"); store[viewPath] = opts.shapesView!.data; }),
          getViewData: () => opts.shapesView!.data,
        },
        detach: vi.fn(() => { events.push("detach"); }),
      }
    : null;
  const app = {
    workspace: {
      getLeavesOfType: () => (leaf ? [leaf] : []),
      getActiveViewOfType: () => (opts.activeFile ? null : { file: tfile(editorPath), editor, getMode: () => "source" }),
      getActiveFile: () => (opts.activeFile ? tfile(opts.activeFile) : tfile(editorPath)),
    },
    vault: {
      getFiles: () => Object.keys(store).map(tfile),
      read: async (f: TFile) => {
        if (f.extension === "shapes") {
          shapesReads[f.path] = (shapesReads[f.path] ?? 0) + 1;
          opts.onShapesRead?.(store, shapesReads[f.path]);
        }
        return store[f.path];
      },
      create: vi.fn(async (path: string, data: string) => {
        if (path in store) throw new Error("File already exists.");
        store[path] = data;
        events.push("create");
        opts.onCreate?.(store);
        return tfile(path);
      }),
      getAbstractFileByPath: (path: string) => (path in store ? tfile(path) : null),
      adapter: {
        exists: async (path: string) => (opts.adapterExists ?? []).includes(path) || Object.keys(store).some((p) => p.toLowerCase() === path.toLowerCase()),
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (link: string) => {
        const hit = Object.keys(store).find((p) => p === link || p.split("/").pop() === link);
        return hit ? tfile(hit) : null;
      },
      fileToLinktext: (f: TFile) => f.path,
    },
    fileManager: {
      getAvailablePathForAttachment: async (name: string) => (`Anhänge/${name}` in store ? `Anhänge/${name.replace(".shapes", " 1.shapes")}` : `Anhänge/${name}`),
      trashFile: vi.fn(async (f: TFile) => {
        events.push(`trash:${f.path}`);
        if (opts.trashThrows) throw new Error("trash unavailable");
        trashed.push(f.path);
        delete store[f.path];
      }),
    },
  };
  const ports = {
    editorFor: (path: string) => (opts.extraEditors && path in opts.extraEditors ? { getValue: () => opts.extraEditors![path], replaceRange: () => {} } : null) ?? (path === editorPath && !opts.activeFile && opts.vaultOnlyBuffer === undefined ? editor : null),
    vault: {
      read: async (path: string) => store[path],
      process: async (path: string, fn: (t: string) => string) => {
        events.push("replace");
        store[path] = fn(store[path]);
      },
    },
  };
  return { app: app as never, env: { app: app as never, ports: ports as never, notice: (m: string) => notices.push(m) }, store, trashed, notices, events, cursor, trashFile: app.fileManager.trashFile, leaf };
}

const NOTE = "# Möbel\n```shapes\ntitle: Tisch\nbox A size 1\n```\nEnde";
const REF_NOTE = "# Möbel\n```3d\nfile: Anhänge/Tisch.shapes\n```\nEnde";
const SHAPES = "box A size 1";

describe("convertBlockToFile", () => {
  it("moves the block text into a file and leaves a reference", async () => {
    const { env, store, notices } = setup({ "n.md": NOTE }, { cursorLine: 3 });
    expect(await convertBlockToFile(env)).toBe(true);
    // Normalisierung: genau ein abschliessender Zeilenumbruch, LF.
    expect(store["Anhänge/Tisch.shapes"]).toBe("title: Tisch\nbox A size 1\n");
    expect(store["n.md"]).toBe(REF_NOTE);
    expect(notices[0]).toContain("Anhänge/Tisch.shapes");
  });

  it("never overwrites an existing file: a number is appended", async () => {
    const { env, store } = setup({ "n.md": NOTE, "Anhänge/Tisch.shapes": "alt" }, { cursorLine: 3 });
    expect(await convertBlockToFile(env)).toBe(true);
    expect(store["Anhänge/Tisch.shapes"]).toBe("alt");
    expect(store["Anhänge/Tisch 1.shapes"]).toBe("title: Tisch\nbox A size 1\n");
    expect(store["n.md"]).toContain("file: Anhänge/Tisch 1.shapes");
  });

  it("refuses (and says so) when the path handed out is already taken", async () => {
    const { env, store, notices, app } = setup({ "n.md": NOTE, "Anhänge/Tisch.shapes": "alt" }, { cursorLine: 3 });
    (app as never as { fileManager: { getAvailablePathForAttachment: () => Promise<string> } }).fileManager.getAvailablePathForAttachment = async () => "Anhänge/Tisch.shapes";
    expect(await convertBlockToFile(env)).toBe(false);
    expect(store["Anhänge/Tisch.shapes"]).toBe("alt");
    expect(store["n.md"]).toBe(NOTE);
    expect(notices[0]).toMatch(/already exists/);
  });

  it("(m2) refuses when the adapter reports the path under another case", async () => {
    const { env, store, notices } = setup({ "n.md": NOTE }, { cursorLine: 3, adapterExists: ["Anhänge/Tisch.shapes"] });
    expect(await convertBlockToFile(env)).toBe(false);
    expect(store["n.md"]).toBe(NOTE);
    expect(Object.keys(store)).toEqual(["n.md"]);
    expect(notices[0]).toMatch(/already exists/);
  });

  it("does nothing outside a shapes block, with a message", async () => {
    const { env, store, notices } = setup({ "n.md": NOTE }, { cursorLine: 0 });
    expect(await convertBlockToFile(env)).toBe(false);
    expect(store["n.md"]).toBe(NOTE);
    expect(notices[0]).toMatch(/shapes block/);
  });

  it("removes the created file again when the note changed meanwhile (Focus 2)", async () => {
    const { env, store, trashed, notices } = setup(
      { "n.md": NOTE },
      { cursorLine: 3, onCreate: (s) => { s["n.md"] = s["n.md"].replace("box A size 1", "box A size 2"); } },
    );
    expect(await convertBlockToFile(env)).toBe(false);
    expect(trashed).toEqual(["Anhänge/Tisch.shapes"]);
    expect(store["Anhänge/Tisch.shapes"]).toBeUndefined();
    expect(store["n.md"]).toContain("box A size 2");
    expect(store["n.md"]).toContain("```shapes");
    expect(notices[0]).toMatch(/nothing was changed/);
  });

  it("names the leftover path when the created file cannot be removed", async () => {
    const { env, store, notices } = setup(
      { "n.md": NOTE },
      { cursorLine: 3, trashThrows: true, onCreate: (s) => { s["n.md"] = s["n.md"].replace("Tisch", "Stuhl"); } },
    );
    expect(await convertBlockToFile(env)).toBe(false);
    expect(store["Anhänge/Tisch.shapes"]).toBeDefined();
    expect(notices[0]).toContain("Anhänge/Tisch.shapes");
    expect(notices[0]).toMatch(/could not be removed/);
  });

  it("reports a failing file creation and writes nothing", async () => {
    const { env, store, notices, app } = setup({ "n.md": NOTE }, { cursorLine: 3 });
    (app as never as { vault: { create: () => Promise<never> } }).vault.create = async () => { throw new Error("disk full"); };
    expect(await convertBlockToFile(env)).toBe(false);
    expect(store["n.md"]).toBe(NOTE);
    expect(notices[0]).toMatch(/disk full/);
  });

  it("refuses an indented block and an unclosed block", async () => {
    const indented = setup({ "n.md": "- punkt\n  ```shapes\n  box A size 1\n  ```" }, { cursorLine: 2 });
    expect(await convertBlockToFile(indented.env)).toBe(false);
    expect(indented.notices[0]).toMatch(/indented/);
    expect(Object.keys(indented.store)).toEqual(["n.md"]);
    const open = setup({ "n.md": "```shapes\nbox A size 1" }, { cursorLine: 1 });
    expect(await convertBlockToFile(open.env)).toBe(false);
    expect(open.notices[0]).toMatch(/closing fence/);
    expect(Object.keys(open.store)).toEqual(["n.md"]);
  });

  it("works for a BOM on line 0, with the BOM in the editor buffer", async () => {
    const note = "\uFEFF```shapes\ntitle: Tisch\nbox A size 1\n```\nEnde";
    const { env, store } = setup({ "n.md": note }, { cursorLine: 1 });
    expect(await convertBlockToFile(env)).toBe(true);
    expect(store["n.md"]).toBe("\uFEFF```3d\nfile: Anhänge/Tisch.shapes\n```\nEnde");
    expect(store["Anhänge/Tisch.shapes"]).toBe("title: Tisch\nbox A size 1\n");
  });

  it("works for a BOM on line 0 when the editor buffer has none but the vault text does", async () => {
    const note = "\uFEFF```shapes\ntitle: Tisch\nbox A size 1\n```\nEnde";
    const { env, store } = setup({ "n.md": note }, { cursorLine: 1, vaultOnlyBuffer: note.slice(1) });
    expect(await convertBlockToFile(env)).toBe(true);
    expect(store["n.md"]).toBe("\uFEFF```3d\nfile: Anhänge/Tisch.shapes\n```\nEnde");
  });

  it("availability is side-effect free and only true inside a shapes block", () => {
    const inside = setup({ "n.md": NOTE }, { cursorLine: 3 });
    expect(canConvertBlockToFile(inside.app)).toBe(true);
    expect(canConvertBlockToFile(setup({ "n.md": NOTE }, { cursorLine: 0 }).app)).toBe(false);
    expect(canConvertBlockToFile(setup({ "n.md": NOTE }, { activeFile: "Anhänge/x.shapes" }).app)).toBe(false);
    expect(inside.store["n.md"]).toBe(NOTE);
    expect(inside.events).toEqual([]);
  });
});

describe("convertFileToBlock", () => {
  const withFile = (extra: Record<string, string> = {}) => ({ "n.md": REF_NOTE, "Anhänge/Tisch.shapes": SHAPES, ...extra });

  it("moves a file used by exactly one reference back into a block and trashes it", async () => {
    const { env, store, trashed, notices } = setup(withFile(), { cursorLine: 2 });
    expect(await convertFileToBlock(env)).toBe(true);
    expect(store["n.md"]).toBe("# Möbel\n```shapes\nbox A size 1\n```\nEnde");
    expect(trashed).toEqual(["Anhänge/Tisch.shapes"]);
    expect(notices[0]).toMatch(/trash/);
    expect(notices[0]).toMatch(/restore/);
  });

  it("refuses when two notes use the file and names both (Focus 1)", async () => {
    const files = { "n.md": "```3d\nfile: Anhänge/Tisch.shapes\n```", "m.md": "![[Tisch.shapes]]", "Anhänge/Tisch.shapes": SHAPES };
    const { env, store, trashed, notices } = setup(files, { cursorLine: 1 });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(store).toEqual(files);
    expect(trashed).toEqual([]);
    expect(notices[0]).toContain("m.md");
    expect(notices[0]).toContain("n.md");
  });

  it("names ALL notes when three use the file", async () => {
    const files = { "n.md": "![[Tisch.shapes]]", "a.md": "![[Tisch.shapes]]", "b.md": "![[Tisch.shapes]]", "Anhänge/Tisch.shapes": SHAPES };
    const { env, notices, store } = setup(files, { cursorLine: 0 });
    expect(await convertFileToBlock(env)).toBe(false);
    for (const n of ["n.md", "a.md", "b.md"]) expect(notices[0]).toContain(n);
    expect(store).toEqual(files);
  });

  it("refuses an embed in the middle of a sentence, with the hint, and keeps the file (Focus 3)", async () => {
    const files = { "n.md": "Siehe ![[Tisch.shapes]] oben.", "Anhänge/Tisch.shapes": SHAPES };
    const { env, store, trashed, notices } = setup(files, { cursorLine: 0 });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(store).toEqual(files);
    expect(trashed).toEqual([]);
    expect(notices[0]).toMatch(/middle of a sentence/);
    expect(notices[0]).toMatch(/cannot split a sentence/);
  });

  it.each([
    ["list item", "- ![[Tisch.shapes]]", /list item/],
    ["quote", "> ![[Tisch.shapes]]", /quote or callout/],
    ["indent", "    ![[Tisch.shapes]]", /indented/],
    ["table", "| a | ![[Tisch.shapes]] |", /table/],
    ["continuation", "Ein Absatz\n![[Tisch.shapes]]", /continues a paragraph/],
  ])("refuses an embed in a %s and names the reason", async (_name, note, pattern) => {
    const files = { "n.md": note, "Anhänge/Tisch.shapes": SHAPES };
    const { env, store, trashed, notices } = setup(files, { cursorLine: note.split("\n").length - 1 });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(store).toEqual(files);
    expect(trashed).toEqual([]);
    expect(notices[0]).toMatch(pattern);
  });

  it("refuses a plain [[link]] and a nested 3d block", async () => {
    const link = setup({ "n.md": "siehe [[Tisch.shapes]]", "Anhänge/Tisch.shapes": SHAPES }, { activeFile: "Anhänge/Tisch.shapes" });
    expect(await convertFileToBlock(link.env)).toBe(false);
    expect(link.notices[0]).toMatch(/only linked/);
    expect(link.trashed).toEqual([]);
    const nested = setup({ "n.md": "> ```3d\n> file: Anhänge/Tisch.shapes\n> ```", "Anhänge/Tisch.shapes": SHAPES }, { activeFile: "Anhänge/Tisch.shapes" });
    expect(await convertFileToBlock(nested.env)).toBe(false);
    expect(nested.notices[0]).toMatch(/quote, callout or list/);
    expect(nested.trashed).toEqual([]);
  });

  it("refuses when a note mentions the file name elsewhere (other mention)", async () => {
    const files = withFile({ "m.md": "Intro\nSee Tisch.shapes for details" });
    const { env, store, trashed, notices } = setup(files, { cursorLine: 2 });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(store).toEqual(files);
    expect(trashed).toEqual([]);
    expect(notices[0]).toMatch(/other mention/);
    expect(notices[0]).toContain("m.md");
    expect(notices[0]).toContain("line 2");
    expect(notices[0]).toMatch(/file name alone/);
  });

  it.each([
    ["Board.canvas", '{"nodes":[{"id":"1","type":"file","file":"Anhänge/Tisch.shapes"}]}'],
    ["Liste.base", "filters:\n  and:\n    - file.name == \"Tisch.shapes\""],
  ])("refuses when %s mentions the file (canvas/base are scanned)", async (name, text) => {
    const files = withFile({ [name]: text });
    const { env, store, trashed, notices } = setup(files, { cursorLine: 2 });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(store).toEqual(files);
    expect(trashed).toEqual([]);
    expect(notices[0]).toContain(name);
  });

  it("replaces the note BEFORE trashing the file", async () => {
    const { env, events, trashFile, store } = setup(withFile(), { cursorLine: 2 });
    let noteAtTrash = "";
    trashFile.mockImplementationOnce(async () => {
      events.push("trash");
      noteAtTrash = store["n.md"];
    });
    await convertFileToBlock(env);
    expect(events.indexOf("replace")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("replace")).toBeLessThan(events.indexOf("trash"));
    expect(noteAtTrash).toContain("```shapes");
    expect(noteAtTrash).not.toContain("```3d");
  });

  describe("open .shapes views", () => {
    it("(i) flushes unsaved edits first, so the note receives the NEW text", async () => {
      const view = { data: "box A size 7" };
      const { env, store, events, leaf } = setup(withFile(), { cursorLine: 2, shapesView: view });
      expect(await convertFileToBlock(env)).toBe(true);
      expect(leaf!.view.save).toHaveBeenCalled();
      expect(events.indexOf("save")).toBeLessThan(events.indexOf("replace"));
      expect(store["n.md"]).toBe("# Möbel\n```shapes\nbox A size 7\n```\nEnde");
    });

    it("(ii) keeps the file when the view buffer changes between read and trash", async () => {
      const view = { data: SHAPES };
      const { env, store, trashed, notices, leaf } = setup(withFile(), {
        cursorLine: 2,
        shapesView: view,
        onShapesRead: (_s, call) => { if (call === 3) view.data = "box A size 9"; },
      });
      expect(await convertFileToBlock(env)).toBe(true);
      expect(trashed).toEqual([]);
      expect(leaf!.detach).not.toHaveBeenCalled();
      expect(store["Anhänge/Tisch.shapes"]).toBeDefined();
      expect(store["n.md"]).toContain("```shapes");
      expect(notices[0]).toContain("Anhänge/Tisch.shapes");
      expect(notices[0]).toMatch(/left in place/);
    });

    it("(iii) without an open view the behaviour is unchanged", async () => {
      const { env, store, trashed, leaf } = setup(withFile(), { cursorLine: 2 });
      expect(leaf).toBeNull();
      expect(await convertFileToBlock(env)).toBe(true);
      expect(trashed).toEqual(["Anhänge/Tisch.shapes"]);
      expect(store["n.md"]).toContain("```shapes");
    });

    it("detaches the view after the compare and before trashing; the file is gone at the end", async () => {
      const view = { data: SHAPES };
      const { env, store, events } = setup(withFile(), { cursorLine: 2, shapesView: view });
      expect(await convertFileToBlock(env)).toBe(true);
      const at = (e: string) => events.indexOf(e);
      expect(at("replace")).toBeLessThan(at("detach"));
      expect(at("detach")).toBeLessThan(at("trash:Anhänge/Tisch.shapes"));
      expect(store["Anhänge/Tisch.shapes"]).toBeUndefined();
    });
  });

  it("(m1) prefers the open editor text over disk: an unsaved embed elsewhere blocks the conversion", async () => {
    const files = withFile({ "m.md": "nichts hier" });
    const { env, store, trashed, notices } = setup(files, { cursorLine: 2, extraEditors: { "m.md": "![[Tisch.shapes]]" } });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(trashed).toEqual([]);
    expect(store).toEqual(files);
    expect(notices[0]).toContain("m.md");
  });

  it("(m3) announces the scan for large vaults only", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 301; i++) many[`x${i}.md`] = "leer";
    const big = setup(withFile(many), { cursorLine: 2 });
    await convertFileToBlock(big.env);
    expect(big.notices[0]).toMatch(/Checking 302 notes/);
    const small = setup(withFile(), { cursorLine: 2 });
    await convertFileToBlock(small.env);
    expect(small.notices[0]).not.toMatch(/Checking/);
  });

  it("trashes nothing when the note changed between search and write (Focus 2)", async () => {
    const { env, store, trashed, notices } = setup(withFile(), {
      cursorLine: 2,
      onShapesRead: (s, call) => { if (call === 2) s["n.md"] = s["n.md"].replace("Ende", "Ende!").replace("# Möbel", "# Möbel\nneue Zeile"); },
    });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(trashed).toEqual([]);
    expect(store["Anhänge/Tisch.shapes"]).toBe(SHAPES);
    expect(store["n.md"]).toContain("file: Anhänge/Tisch.shapes");
    expect(store["n.md"]).not.toContain("```shapes");
    expect(notices[0]).toMatch(/nothing was changed/);
  });

  it("keeps the file when it changed between the first read and the write", async () => {
    const { env, store, trashed, notices } = setup(withFile(), {
      cursorLine: 2,
      onShapesRead: (s, call) => { if (call === 2) s["Anhänge/Tisch.shapes"] = "box A size 9"; },
    });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(trashed).toEqual([]);
    expect(store["n.md"]).toBe(REF_NOTE);
    expect(notices[0]).toMatch(/changed while converting/);
  });

  it("keeps the file when it changed after the note was replaced", async () => {
    const { env, store, trashed, notices } = setup(withFile(), {
      cursorLine: 2,
      onShapesRead: (s, call) => { if (call === 3) s["Anhänge/Tisch.shapes"] = "box A size 9"; },
    });
    expect(await convertFileToBlock(env)).toBe(true);
    expect(trashed).toEqual([]);
    expect(store["Anhänge/Tisch.shapes"]).toBe("box A size 9");
    expect(notices[0]).toMatch(/left in place/);
  });

  it("leaves the file and tells the user when trashing fails; never re-creates anything", async () => {
    const { env, store, notices, app } = setup(withFile(), { cursorLine: 2, trashThrows: true });
    const create = (app as never as { vault: { create: ReturnType<typeof vi.fn> } }).vault.create;
    expect(await convertFileToBlock(env)).toBe(true);
    expect(store["n.md"]).toContain("```shapes\nbox A size 1\n```");
    expect(store["Anhänge/Tisch.shapes"]).toBe(SHAPES);
    expect(notices[0]).toMatch(/could not be moved to the trash/);
    expect(notices[0]).toContain("Anhänge/Tisch.shapes");
    expect(create).not.toHaveBeenCalled();
  });

  it("normalises: CRLF to LF, BOM and trailing newlines dropped", async () => {
    const { env, store } = setup(withFile({ "Anhänge/Tisch.shapes": "\uFEFFtitle: Tisch\r\nbox A size 1\r\n\r\n" }), { cursorLine: 2 });
    expect(await convertFileToBlock(env)).toBe(true);
    expect(store["n.md"]).toBe("# Möbel\n```shapes\ntitle: Tisch\nbox A size 1\n```\nEnde");
  });

  it("round trip block -> file -> block yields the same DSL lines", async () => {
    const { env, store, cursor } = setup({ "n.md": NOTE }, { cursorLine: 3 });
    expect(await convertBlockToFile(env)).toBe(true);
    cursor.line = 2;
    expect(await convertFileToBlock(env)).toBe(true);
    expect(store["n.md"]).toBe(NOTE);
  });

  it("works from the open .shapes file when exactly one note uses it", async () => {
    const { env, store } = setup({ "n.md": "![[Tisch.shapes]]", "Anhänge/Tisch.shapes": SHAPES }, { activeFile: "Anhänge/Tisch.shapes" });
    expect(await convertFileToBlock(env)).toBe(true);
    expect(store["n.md"]).toBe("```shapes\nbox A size 1\n```");
  });

  it("reports an unused file instead of doing nothing", async () => {
    const { env, notices, trashed } = setup({ "n.md": "nichts", "Anhänge/Tisch.shapes": SHAPES }, { activeFile: "Anhänge/Tisch.shapes" });
    expect(await convertFileToBlock(env)).toBe(false);
    expect(notices[0]).toMatch(/not used in any note/);
    expect(trashed).toEqual([]);
  });

  it("availability: 3d block or embed line pointing at .shapes, or the open .shapes file", () => {
    expect(canConvertFileToBlock(setup(withFile(), { cursorLine: 2 }).app)).toBe(true);
    expect(canConvertFileToBlock(setup({ "n.md": "![[Tisch.shapes]]", "Anhänge/Tisch.shapes": SHAPES }, { cursorLine: 0 }).app)).toBe(true);
    expect(canConvertFileToBlock(setup(withFile(), { activeFile: "Anhänge/Tisch.shapes" }).app)).toBe(true);
    expect(canConvertFileToBlock(setup(withFile(), { cursorLine: 0 }).app)).toBe(false);
    expect(canConvertFileToBlock(setup({ "n.md": "![[x.glb]]", "x.glb": "" }, { cursorLine: 0 }).app)).toBe(false);
    const s = setup(withFile(), { cursorLine: 2 });
    canConvertFileToBlock(s.app);
    expect(s.events).toEqual([]);
  });
});
