import { describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { TFile, makeFakeApp, makeFakeEl } from "../__mocks__/obsidian";
import { ModelBlock } from "../../src/obsidian/block-child";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";
import { ActiveViewport } from "../../src/core/active-viewport";
import { NAMED_VIEWS } from "../../src/core/view-spec";

function makeFactory() {
  const created: any[] = [];
  const factory = {
    isWebGLAvailable: () => true,
    create: (opts: any) => {
      const vp = {
        opts,
        disposed: 0,
        setModel: vi.fn(),
        setView: vi.fn(),
        getView: vi.fn(() => null),
        setColors: vi.fn(),
        resize: vi.fn(),
        resetCamera: vi.fn(),
        capturePoster: () => "data:image/png;base64,AAA",
        dispose() {
          vp.disposed += 1;
        },
      };
      created.push(vp);
      return vp;
    },
  };
  return { factory, created };
}

function makeBudget() {
  return { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() };
}

function glbFile(path = "a.glb", mtime = 1): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = { mtime, ctime: 0, size: 4 };
  return f;
}

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const { factory, created } = makeFactory();
  const app = makeFakeApp();
  const budget = makeBudget();
  // Standardinhalt ist ein gueltiger, unkomprimierter GLB — sonst bricht jeder Test
  // schon an der Container-Pruefung ab, statt den Lebenszyklus zu erreichen.
  app.vault.readBinary = vi.fn().mockResolvedValue(makeGlb({ asset: { version: "2.0" } }));
  return {
    created,
    budget,
    app,
    deps: {
      app,
      settings: () => DEFAULT_SETTINGS,
      factory,
      budget,
      loadModel: vi.fn().mockResolvedValue({}),
      readColors: () => ({ background: "#000", material: "#888", grid: "#444" }),
      // Fake-Defaults fuer Tests, denen die Schreib-Faehigkeit egal ist —
      // spezifische ViewportController-Tests ueberschreiben sie via `loadedBlock`.
      active: new ActiveViewport(),
      writePorts: {
        editorFor: () => null,
        vault: {
          read: async () => "",
          process: async () => {},
        },
      },
      sectionInfo: () => ({ lineStart: 0, lineEnd: 2 }),
      panelVisible: () => false,
      ...overrides,
    } as any,
  };
}

describe("ModelBlock", () => {
  it("shows a config error and never builds a viewport", () => {
    const { deps, created } = makeDeps();
    const el = makeFakeEl();

    const block = new ModelBlock(el, "height: 300", "note.md", deps);
    block.onload();

    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("No `file:` given.");
  });

  it("reports a missing file with the path it looked for", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(null);
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: missing.glb", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("File not found: missing.glb");
  });

  it("rejects an unsupported extension before touching the vault", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile("model.obj"));
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: model.obj", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("Unsupported format: model.obj");
    expect(app.vault.readBinary).not.toHaveBeenCalled();
  });

  it("disposes the viewport when Obsidian unloads the block", async () => {
    const { deps, app, created } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());

    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();
    block.onunload();

    expect(created).toHaveLength(1);
    expect(created[0].disposed).toBe(1);
  });

  it("unregisters from the context budget on unload", async () => {
    const { deps, app, budget } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());

    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();
    block.onunload();

    expect(budget.unregister).toHaveBeenCalled();
  });

  it("reloads when its own file is modified", async () => {
    const { deps, app } = makeDeps();
    const file = glbFile();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(file);

    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();
    const before = app.vault.readBinary.mock.calls.length;
    file.stat.mtime = 999;
    await block.onFileModified(file);

    expect(app.vault.readBinary.mock.calls.length).toBe(before + 1);
  });

  it("ignores a modification of a different file", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());

    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();
    const before = app.vault.readBinary.mock.calls.length;
    await block.onFileModified(glbFile("other.glb"));

    expect(app.vault.readBinary.mock.calls.length).toBe(before);
  });

  it("reports missing WebGL instead of building a viewport", async () => {
    const { deps, app, created } = makeDeps();
    deps.factory.isWebGLAvailable = () => false;
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("WebGL is unavailable");
  });

  it("refuses a compressed glTF with the real reason", async () => {
    const { deps, app, created } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    app.vault.readBinary = vi.fn().mockResolvedValue(makeDracoGlb());
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("Compressed glTF is not supported");
  });

  it("collapses the empty stage on a terminal error", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(null);
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: missing.gltf", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("tdcb-hidden");
  });

  it("keeps the stage visible when the model is ready", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile("a.gltf"));
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: a.gltf", "note.md", deps);
    block.onload();
    await block.loadNow();

    const stage = el.children[0].children.find((c: any) =>
      String(c.className).includes("tdcb-stage"),
    );
    expect(String(stage.className)).not.toContain("tdcb-hidden");
  });

  it("shows the warnings from the config below the viewport", async () => {
    const { deps, app } = makeDeps();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    const el = makeFakeEl();

    const block = new ModelBlock(el, "file: a.glb\nheigth: 400", "note.md", deps);
    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("Unknown key: `heigth`");
  });
});

/** Ein geladener Block mit aktiver Registry und mitschreibenden Schreib-Ports. */
async function loadedBlock(
  source = "file: model.glb",
  overrides: Record<string, unknown> = {},
) {
  const written: string[] = [];
  // `active` per Aufruf frisch, ausser der Aufrufer teilt eine Registry ueber mehrere
  // Bloecke hinweg (siehe Tests zum identitaets-scoped `clearIf`/`tdcb-active`).
  const active = (overrides.active as ActiveViewport | undefined) ?? new ActiveViewport();
  // Der von Obsidian gelieferte Blockquelltext kann ein trailing "\n" tragen (siehe
  // `applyViewKey`/`block-edit.ts`) -- das reale Notiz-Fragment dagegen hat immer genau
  // EINE Zeile pro Zeile im Rumpf. Fuer den Fake-Notizinhalt und `sectionInfo` zaehlt
  // deshalb der Rumpf OHNE ein etwaiges trailing "\n".
  const bodyLines = source.replace(/\n$/, "").split("\n");
  const noteFor = (body: string) => ["```3d", body, "```"].join("\n");
  const writePorts = {
    editorFor: () => null,
    vault: {
      read: async () => noteFor(bodyLines.join("\n")),
      process: async (_path: string, fn: (text: string) => string) => {
        const next = fn(noteFor(bodyLines.join("\n")));
        written.push(next.split("\n").slice(1, -1).join("\n"));
      },
    },
  };

  const { deps, created, app } = makeDeps({
    active,
    writePorts,
    sectionInfo: () => ({ lineStart: 0, lineEnd: bodyLines.length + 1 }),
    panelVisible: () => false,
    ...overrides,
  });
  app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile("model.glb"));

  const block = new ModelBlock(makeFakeEl(), source, "note.md", deps);
  block.onload();
  await block.loadNow();

  return { block, created, active, written };
}

describe("as a ViewportController", () => {
  it("becomes the active viewport when the user interacts", async () => {
    const { block, created, active } = await loadedBlock();
    created[0].opts.onInteract();
    expect(active.get()).toBe(block);
  });

  it("clears itself from the registry on unload", async () => {
    const { block, created, active } = await loadedBlock();
    created[0].opts.onInteract();
    block.onunload();
    expect(active.get()).toBeNull();
  });

  it("leaves another block active when a different one unloads", async () => {
    // Geteilte Registry -- sonst pruefen `first.active` und `other.active` zwei
    // voneinander unabhaengige Objekte und der Test besteht auch dann, wenn
    // `clearIf(this)` faelschlich durch `set(null)` ersetzt wuerde.
    const active = new ActiveViewport();
    const first = await loadedBlock("file: model.glb", { active });
    first.created[0].opts.onInteract();
    const other = await loadedBlock("file: model.glb", { active });
    other.block.onunload();
    expect(active.get()).toBe(first.block);
  });

  it("marks only the currently active block with tdcb-active", async () => {
    const active = new ActiveViewport();
    const first = await loadedBlock("file: model.glb", { active });
    const second = await loadedBlock("file: model.glb", { active });

    first.created[0].opts.onInteract();
    expect(String(first.block.containerEl.className)).toContain("tdcb-active");
    expect(String(second.block.containerEl.className)).not.toContain("tdcb-active");

    second.created[0].opts.onInteract();
    expect(String(first.block.containerEl.className)).not.toContain("tdcb-active");
    expect(String(second.block.containerEl.className)).toContain("tdcb-active");
  });

  it("can save when the section info is known", async () => {
    const { block } = await loadedBlock();
    expect(block.canSave()).toBe(true);
  });

  it("cannot save when the section info is missing", async () => {
    const { block } = await loadedBlock("file: model.glb", { sectionInfo: () => null });
    expect(block.canSave()).toBe(false);
  });

  it("writes the view key into the block body", async () => {
    const { block, written } = await loadedBlock();
    await block.save(NAMED_VIEWS.top);
    expect(written[0]).toBe("file: model.glb\nview: top");
  });

  it("removes the view key when saving null", async () => {
    const { block, written } = await loadedBlock("file: model.glb\nview: top");
    await block.save(null);
    expect(written[0]).toBe("file: model.glb");
  });

  it("writes nothing when the value would not change", async () => {
    const { block, written } = await loadedBlock("file: model.glb\nview: top");
    await block.save(NAMED_VIEWS.top);
    expect(written).toEqual([]);
  });

  // Obsidian liefert `source` an den Codeblock-Prozessor moeglicherweise mit einem
  // trailing "\n" (das dieses Repo an anderer Stelle -- `applyViewKey` -- bewusst
  // erhaelt). `bodyAt` haengt aber nie einen trailing-Separator an einen rekonstruierten
  // Rumpf an. Ohne das trailing "\n" vorher abzuschneiden, wuerde JEDES Speichern mit
  // "Note changed" scheitern und der geschriebene Rumpf eine Leerzeile vor der
  // schliessenden Fence bekommen.
  it("tolerates a trailing newline in the block source", async () => {
    const { block, written } = await loadedBlock("file: model.glb\n");
    await block.save(NAMED_VIEWS.top);
    expect(written[0]).toBe("file: model.glb\nview: top");
  });

  it("shows a notice instead of silently doing nothing when the view is unchanged", async () => {
    const { block, written } = await loadedBlock("file: model.glb\nview: top");
    const notices: string[] = [];
    // `mockImplementation` gegen die ECHTEN obsidian-Typen (typecheck:test prueft
    // dagegen, PROF-OBS-08) -- `Notice` ist dort eine Klasse mit Instanzfeldern, die
    // dieser Test-Stub nicht braucht. `as any` ist hier bewusst, nicht Nachlaessigkeit.
    const spy = vi.spyOn(obsidian, "Notice").mockImplementation(((message: string) => {
      notices.push(message);
    }) as any);

    await block.save(NAMED_VIEWS.top);

    expect(written).toEqual([]);
    expect(notices).toContain("View already up to date");
    spy.mockRestore();
  });
});

// Regressionstest fuer Finding 1 (Whole-Branch-Review 2026-07-25): `buildToolbar()`
// friert `getView()` beim BAU der Leiste ein. `syncToolbar()` lief bisher nur aus
// `onload()` -- also BEVOR das Modell (asynchron ueber `loadNow()`/IntersectionObserver)
// ueberhaupt geladen ist. In der Default-Konfiguration (Toolbar statt Sidebar, frische
// Installation) blieb der Save-Button dadurch fuer immer deaktiviert.
describe("toolbar state after load (regression)", () => {
  it("enables the Save button once loadNow() has actually finished, not just onload()", async () => {
    const { deps, created, app } = makeDeps({ panelVisible: () => false });
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());

    // Simuliert ein fertig geladenes Modell: die echte Viewport-Klasse liefert nach
    // `setModel`+`setView` eine Kamera zurueck, der Test-Stub liefert `null` per
    // Default (siehe `makeFactory`) -- hier ueberschrieben, um genau den Zustand
    // "Modell ist fertig geladen" nachzustellen.
    const originalCreate = deps.factory.create;
    deps.factory.create = (opts: any) => {
      const viewport = originalCreate(opts);
      viewport.getView = vi.fn(() => NAMED_VIEWS.top);
      return viewport;
    };

    const el = makeFakeEl();
    const block = new ModelBlock(el, "file: a.glb", "note.md", deps);

    block.onload();
    const toolbarAfterOnload = findToolbar(el);
    expect(toolbarAfterOnload).toBeTruthy();
    // Vor dem Laden: Save MUSS deaktiviert sein (kein Modell da) -- das ist kein Bug.
    expect(toolbarAfterOnload.children[0].disabled).toBe(true);

    await block.loadNow();

    const toolbarAfterLoad = findToolbar(el);
    expect(toolbarAfterLoad).toBeTruthy();
    expect(created).toHaveLength(1);
    // Der eigentliche Regressionsfall: nach dem Laden muss Save aktiv sein.
    expect(toolbarAfterLoad.children[0].disabled).toBe(false);
  });

  it("rebuilds the toolbar exactly once after load, without leaving a duplicate behind", async () => {
    const { deps, app } = makeDeps({ panelVisible: () => false });
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());

    const el = makeFakeEl();
    const block = new ModelBlock(el, "file: a.glb", "note.md", deps);
    block.onload();
    await block.loadNow();

    const stage = findStage(el);
    const toolbars = stage.children.filter((c: any) => String(c.className).includes("tdcb-toolbar"));
    expect(toolbars).toHaveLength(1);
  });
});

/** Rekursiv nach `.tdcb-toolbar` suchen -- die Leiste haengt inzwischen an `.tdcb-stage`,
    nicht mehr an `.tdcb-block` (Finding 6, Anker-Fix). */
function findToolbar(el: any): any {
  if (String(el.className).includes("tdcb-toolbar")) return el;
  for (const child of el.children ?? []) {
    const found = findToolbar(child);
    if (found) return found;
  }
  return null;
}

function findStage(el: any): any {
  if (String(el.className).includes("tdcb-stage")) return el;
  for (const child of el.children ?? []) {
    const found = findStage(child);
    if (found) return found;
  }
  return null;
}

function makeDracoGlb(): ArrayBuffer {
  return makeGlb({ extensionsRequired: ["KHR_draco_mesh_compression"] });
}

function makeGlb(json: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.fill(0x20);
  padded.set(bytes);

  const total = 20 + padded.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf).set(padded, 20);
  return buf;
}
