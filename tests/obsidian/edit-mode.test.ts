import { describe, expect, it, vi } from "vitest";
import {
  EDIT_STALE_ON_DISK,
  EDIT_UNAVAILABLE_LOADING,
  EditCoordinator,
  type EditIo,
} from "../../src/obsidian/edit-mode";
import { contractGltfText, makeContractGltf } from "../helpers/contract-gltf";
import type { NodeTrs } from "../../src/core/gltf-patch";

/** Dieselbe Szene, aber vom Generator mit VERTAUSCHTER Node-Reihenfolge neu geschrieben:
 *  an Index 0 steht jetzt `privat-bad` statt `privat-herd`. Genau der Fall, in dem ein
 *  Patch nach Index das falsche Zimmer verschieben wuerde — die Namen bleiben ja
 *  unangetastet, der nachgelagerte Diff faellt also auf nichts auf. */
function reorderedContractGltfText(): string {
  const doc = makeContractGltf() as Record<string, unknown>;
  doc.nodes = [
    { name: "privat-bad", mesh: 2, translation: [-3, 0, 1], scale: [1, 1, 1] },
    { name: "privat-herd", mesh: 0, translation: [1, 0, 2] },
    { name: "env__gelaende", mesh: 3, translation: [0, -0.1, 0] },
  ];
  doc.scenes = [{ nodes: [0, 1, 2] }];
  return JSON.stringify(doc);
}

/** Kontrakt-JSON als GLB verpacken (wie tests/core/gltf-patch.test.ts): 12-Byte-Header +
 * JSON-Chunk + BIN-Chunk. */
function makeGlb(jsonText: string): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonPadded = (jsonBytes.length + 3) & ~3;
  const bin = new Uint8Array([1, 2, 3, 4]);
  const total = 12 + 8 + jsonPadded + 8 + bin.length;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, 0x46546c67, true); // magic "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  bytes.fill(0x20, 20, 20 + jsonPadded);
  bytes.set(jsonBytes, 20);
  view.setUint32(20 + jsonPadded, bin.length, true);
  view.setUint32(24 + jsonPadded, 0x004e4942, true); // "BIN\0"
  bytes.set(bin, 28 + jsonPadded);
  return buffer;
}

function makeIo(files: Record<string, string>): EditIo & { files: Record<string, string> } {
  return {
    files,
    exists: (path) => path in files,
    readText: (path) => Promise.resolve(files[path]),
    readBinary: () => Promise.reject(new Error("binary unused in these tests")),
    writeText: (path, text) => {
      files[path] = text;
      return Promise.resolve();
    },
    writeBinary: () => Promise.reject(new Error("binary unused in these tests")),
  };
}

function makeRig() {
  return { setMode: vi.fn(), select: vi.fn(), applyTrs: vi.fn(), dispose: vi.fn() };
}

function makeCoordinator(files: Record<string, string>, over: Record<string, unknown> = {}) {
  const io = makeIo(files);
  const rig = makeRig();
  const host = { createEditRig: vi.fn(() => rig), pin: vi.fn() };
  const notices: string[] = [];
  const confirm = vi.fn().mockResolvedValue(true);
  const coordinator = new EditCoordinator({
    io,
    filePath: () => "3d/eg.gltf",
    host: () => host,
    lockedPrefixes: () => ["env__"],
    notice: (m) => notices.push(m),
    confirmDiscard: confirm,
    onChange: vi.fn(),
    ...over,
  });
  return { coordinator, io, rig, host, notices, confirm };
}

const moved: NodeTrs = { translation: [4, 0, 2], scale: [1, 1, 1] };

describe("EditCoordinator", () => {
  it("enter: pinnt den Host, baut das Rig, ohne Edit-Datei kein Overlay", async () => {
    const { coordinator, host, notices } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    expect(coordinator.active).toBe(true);
    expect(host.pin).toHaveBeenCalledWith(true);
    expect(host.createEditRig).toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it("enter mit vorhandener Edit-Datei: Overlay per Name, dirty, Notice mit Zahl", async () => {
    const editJson = JSON.parse(contractGltfText());
    editJson.nodes[0].translation = [7, 0, 2];
    const { coordinator, rig, notices } = makeCoordinator({
      "3d/eg.gltf": contractGltfText(),
      "3d/eg.edit.gltf": JSON.stringify(editJson),
    });
    await coordinator.enter();
    expect(coordinator.uiModel().dirty).toBe(true);
    expect(rig.applyTrs).toHaveBeenCalledWith(0, { translation: [7, 0, 2], scale: [1, 1, 1] });
    expect(notices.join(" ")).toContain("1");
    // Der env__-Node steht unveraendert mit im Edit-File (der Patch schreibt immer das
    // ganze Dokument) — das darf NICHT als "no longer match" gemeldet werden (Fix #3).
    expect(notices).toEqual(["Loaded existing edits for 1 node(s)"]);
  });

  it("enter: gesperrter, aber unveraenderter Node im Edit-File zaehlt nicht als verloren (Fix #3)", async () => {
    const editJson = JSON.parse(contractGltfText());
    editJson.nodes[0].translation = [7, 0, 2]; // echter Edit
    // nodes[3] = env__gelaende bleibt unveraendert — trotzdem im Edit-File vorhanden.
    const { coordinator, notices } = makeCoordinator({
      "3d/eg.gltf": contractGltfText(),
      "3d/eg.edit.gltf": JSON.stringify(editJson),
    });
    await coordinator.enter();
    expect(notices.some((n) => n.includes("no longer match"))).toBe(false);
  });

  it("enter: gesperrter Node mit abweichendem TRS im Edit-File wird namentlich als verloren gemeldet (Fix #3/#6)", async () => {
    const editJson = JSON.parse(contractGltfText());
    editJson.nodes[3].translation = [9, 9, 9]; // env__gelaende, per Praefix gesperrt, ECHT abweichend
    const { coordinator, notices } = makeCoordinator({
      "3d/eg.gltf": contractGltfText(),
      "3d/eg.edit.gltf": JSON.stringify(editJson),
    });
    await coordinator.enter();
    expect(notices.join(" ")).toContain("no longer match");
    expect(notices.join(" ")).toContain("env__gelaende");
  });

  it("enter mit defektem GLB-Edit-File: Notice statt stillem leerem Overlay (Fix #2)", async () => {
    const files: Record<string, ArrayBuffer> = {
      "3d/eg.glb": makeGlb(contractGltfText()),
      "3d/eg.edit.glb": new ArrayBuffer(4), // zu kurz fuer einen gueltigen GLB-Header
    };
    const io: EditIo = {
      exists: (path) => path in files,
      readText: () => Promise.reject(new Error("text unused in this test")),
      readBinary: (path) => Promise.resolve(files[path]),
      writeText: () => Promise.reject(new Error("unused")),
      writeBinary: () => Promise.reject(new Error("unused")),
    };
    const rig = makeRig();
    const host = { createEditRig: vi.fn(() => rig), pin: vi.fn() };
    const notices: string[] = [];
    const coordinator = new EditCoordinator({
      io,
      filePath: () => "3d/eg.glb",
      host: () => host,
      lockedPrefixes: () => ["env__"],
      notice: (m) => notices.push(m),
      confirmDiscard: vi.fn().mockResolvedValue(true),
      onChange: vi.fn(),
    });
    await coordinator.enter();
    expect(coordinator.active).toBe(true);
    expect(notices.some((n) => n.includes("Could not read"))).toBe(true);
  });

  it("enter: createEditRig liefert null -> kein stiller aktiver Zustand ohne Gizmo (Fix #4)", async () => {
    const io = makeIo({ "3d/eg.gltf": contractGltfText() });
    const host = { createEditRig: vi.fn(() => null), pin: vi.fn() };
    const notices: string[] = [];
    const coordinator = new EditCoordinator({
      io,
      filePath: () => "3d/eg.gltf",
      host: () => host,
      lockedPrefixes: () => ["env__"],
      notice: (m) => notices.push(m),
      confirmDiscard: vi.fn().mockResolvedValue(true),
      onChange: vi.fn(),
    });
    await coordinator.enter();
    expect(coordinator.active).toBe(false);
    expect(host.pin).not.toHaveBeenCalledWith(true);
    expect(notices).toContain(EDIT_UNAVAILABLE_LOADING);
  });

  it("enter: doppeltes Aufrufen waehrend des ersten Reads baut das Rig nur einmal (Fix #1)", async () => {
    const files: Record<string, string> = { "3d/eg.gltf": contractGltfText() };
    const resolvers: (() => void)[] = [];
    const io: EditIo = {
      exists: (path) => path in files,
      readText: (path) => new Promise((resolve) => resolvers.push(() => resolve(files[path]))),
      readBinary: () => Promise.reject(new Error("binary unused in this test")),
      writeText: () => Promise.reject(new Error("unused")),
      writeBinary: () => Promise.reject(new Error("unused")),
    };
    const rigs = [makeRig(), makeRig()];
    const host = { createEditRig: vi.fn(() => rigs.shift() ?? null), pin: vi.fn() };
    const coordinator = new EditCoordinator({
      io,
      filePath: () => "3d/eg.gltf",
      host: () => host,
      lockedPrefixes: () => [],
      notice: () => {},
      confirmDiscard: vi.fn().mockResolvedValue(true),
      onChange: vi.fn(),
    });

    // Doppelklick: zweiter enter() waehrend der erste noch auf den Vault-Read wartet.
    const first = coordinator.enter();
    const second = coordinator.enter();
    resolvers.forEach((resolve) => resolve());
    await Promise.all([first, second]);

    expect(host.createEditRig).toHaveBeenCalledTimes(1);
    expect(coordinator.active).toBe(true);
  });

  it("enter mit unlesbarer Edit-Datei: Notice, Start ohne Overlay", async () => {
    const { coordinator, notices } = makeCoordinator({
      "3d/eg.gltf": contractGltfText(),
      "3d/eg.edit.gltf": "kein json {",
    });
    await coordinator.enter();
    expect(coordinator.active).toBe(true);
    expect(coordinator.uiModel().dirty).toBe(false);
    expect(notices.some((n) => n.includes("Could not read"))).toBe(true);
  });

  it("save: patcht frisch gelesenes Original in die Nachbar-Datei; dirty faellt", async () => {
    const { coordinator, io } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    coordinator.uiModel(); // Selektion simulieren:
    // onSelect(0) kommt normalerweise vom Rig — hier direkt ueber das UI-Modell:
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.save();
    const written = JSON.parse(io.files["3d/eg.edit.gltf"]);
    expect(written.nodes[0].translation).toEqual([4, 0, 2]);
    expect(coordinator.uiModel().dirty).toBe(false);
  });

  it("save: mehrere Edits landen alle im selben Patch (Ledger T2)", async () => {
    const { coordinator, io } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    coordinatorSelect(coordinator, 2);
    coordinator.uiModel().applyTrs({ translation: [-5, 0, 8], scale: [2, 2, 2] });
    await coordinator.save();

    const written = JSON.parse(io.files["3d/eg.edit.gltf"]);
    expect(written.nodes[0].translation).toEqual([4, 0, 2]);
    expect(written.nodes[2].translation).toEqual([-5, 0, 8]);
    expect(written.nodes[2].scale).toEqual([2, 2, 2]);
    // Unbeteiligte Nodes bleiben, wie sie waren.
    expect(written.nodes[3].translation).toEqual([0, -0.1, 0]);
    expect(coordinator.uiModel().dirty).toBe(false);
  });

  // Das Original wird beim Speichern FRISCH gelesen (richtig) — die Indizes in
  // `session.changes()` stammen aber vom Betreten. Wurde die Datei dazwischen mit
  // umsortierten Nodes regeneriert, schriebe der Patch TRS auf die falschen JSON-Nodes:
  // still falsche Daten, weil die Namen unangetastet bleiben und der nachgelagerte Diff
  // deshalb einfach den falschen Raum verschiebt.
  it("save: umsortiertes Original auf der Platte -> kein Schreiben, Notice, Session bleibt", async () => {
    const files: Record<string, string> = { "3d/eg.gltf": contractGltfText() };
    const { coordinator, io, notices } = makeCoordinator(files);
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);

    // Regenerierung waehrend des Edits: gleiche Namen, andere Reihenfolge.
    io.files["3d/eg.gltf"] = reorderedContractGltfText();
    await coordinator.save();

    expect(io.files["3d/eg.edit.gltf"]).toBeUndefined();
    expect(notices).toContain(EDIT_STALE_ON_DISK);
    // Kein Datenverlust: Modus und ungespeicherter Edit bleiben erhalten.
    expect(coordinator.active).toBe(true);
    expect(coordinator.uiModel().dirty).toBe(true);
  });

  it("save: verschwundener Node auf der Platte -> ebenfalls kein Schreiben", async () => {
    const files: Record<string, string> = { "3d/eg.gltf": contractGltfText() };
    const { coordinator, io, notices } = makeCoordinator(files);
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);

    const shrunk = makeContractGltf() as Record<string, unknown>;
    shrunk.scenes = [{ nodes: [2, 3] }]; // Node 0 ist nicht mehr Teil der Szene
    io.files["3d/eg.gltf"] = JSON.stringify(shrunk);
    await coordinator.save();

    expect(io.files["3d/eg.edit.gltf"]).toBeUndefined();
    expect(notices).toContain(EDIT_STALE_ON_DISK);
    expect(coordinator.active).toBe(true);
  });

  it("save: unveraendertes Original schreibt normal weiter (kein Fehlalarm)", async () => {
    const { coordinator, io, notices } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.save();

    expect(io.files["3d/eg.edit.gltf"]).toBeDefined();
    expect(notices).not.toContain(EDIT_STALE_ON_DISK);
  });

  it("save auf einer .edit.-Quelle schreibt in-place", async () => {
    const { coordinator, io } = makeCoordinator(
      { "3d/eg.edit.gltf": contractGltfText() },
      { filePath: () => "3d/eg.edit.gltf" },
    );
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.save();
    expect(JSON.parse(io.files["3d/eg.edit.gltf"]).nodes[0].translation).toEqual([4, 0, 2]);
    expect(Object.keys(io.files)).toEqual(["3d/eg.edit.gltf"]);
  });

  it("save: Edit waehrend des Schreibens bleibt dirty statt faelschlich als gespeichert zu gelten (Fix #5)", async () => {
    const files: Record<string, string> = { "3d/eg.gltf": contractGltfText() };
    let coordinator!: EditCoordinator;
    const io: EditIo = {
      exists: (path) => path in files,
      readText: (path) => Promise.resolve(files[path]),
      readBinary: () => Promise.reject(new Error("binary unused in this test")),
      writeText: async (path, text) => {
        // Simuliert einen Gizmo-Drag, der waehrend des Vault-Schreibens landet.
        coordinatorSelect(coordinator, 0);
        coordinator.uiModel().applyTrs({ translation: [9, 9, 9], scale: [1, 1, 1] });
        files[path] = text;
      },
      writeBinary: () => Promise.reject(new Error("unused")),
    };
    const rig = makeRig();
    const host = { createEditRig: vi.fn(() => rig), pin: vi.fn() };
    coordinator = new EditCoordinator({
      io,
      filePath: () => "3d/eg.gltf",
      host: () => host,
      lockedPrefixes: () => ["env__"],
      notice: () => {},
      confirmDiscard: vi.fn().mockResolvedValue(true),
      onChange: vi.fn(),
    });
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.save();
    expect(coordinator.uiModel().dirty).toBe(true);
  });

  it("discard bei dirty fragt nach; Ablehnung bleibt im Modus", async () => {
    const { coordinator, confirm } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    confirm.mockResolvedValue(false);
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.discard();
    expect(coordinator.active).toBe(true);
  });

  it("discard setzt TRS am Rig zurueck, entpinnt, verlaesst den Modus", async () => {
    const { coordinator, rig, host } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.discard();
    expect(coordinator.active).toBe(false);
    expect(rig.applyTrs).toHaveBeenLastCalledWith(0, { translation: [1, 0, 2], scale: [1, 1, 1] });
    expect(rig.dispose).toHaveBeenCalled();
    expect(host.pin).toHaveBeenLastCalledWith(false);
  });

  // Carry-over-Fund aus der Task-9-Nachpruefung (Ledger): `discard()` hatte KEINEN
  // Epoch-Schutz um den `confirmDiscard()`-Await. Task 10 macht `reapplyAfterReload()`
  // aus dem echten Ladeweg erreichbar (loadNow()) -- ein Reload waehrend der offene
  // Confirm-Dialog haengt, taeuscht dann genau diese Race vor: der Reload tauscht
  // Rig/Session aus, und der stale discard() wuerde danach die FRISCH geladene Session
  // unter sich wegreissen, statt sich als ueberholt zu erkennen (gleicher Fix wie
  // enter()/reapplyAfterReload(), Fix #1, Task-9-Review).
  it("discard: ein Reload waehrend des offenen Confirm-Dialogs reisst die neu geladene Session nicht weg", async () => {
    let resolveConfirm!: (value: boolean) => void;
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const { coordinator, host } = makeCoordinator(
      { "3d/eg.gltf": contractGltfText() },
      { confirmDiscard: confirm },
    );
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);

    const discardPromise = coordinator.discard(); // haengt im offenen Confirm-Dialog

    // Reload waehrend der Nutzer noch entscheidet (z.B. Datei-Watcher-Reload):
    await coordinator.reapplyAfterReload();
    expect(coordinator.uiModel().dirty).toBe(true); // der Edit hat den Reload ueberlebt

    resolveConfirm(true); // Nutzer bestaetigt jetzt endlich das Verwerfen
    await discardPromise;

    // Der ueberholte discard() darf die frisch geladene Session NICHT wegreissen.
    expect(coordinator.active).toBe(true);
    expect(coordinator.uiModel().dirty).toBe(true);
    expect(host.pin).toHaveBeenLastCalledWith(true);
  });

  it("reapplyAfterReload: Session ueberlebt die Regeneration per Name", async () => {
    const { coordinator, host } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.reapplyAfterReload(); // neuer Viewport nach Datei-Watcher-Reload
    expect(coordinator.active).toBe(true);
    expect(coordinator.uiModel().dirty).toBe(true);
    expect(host.createEditRig).toHaveBeenCalledTimes(2);
  });

  it("availability: STL-Pfad meldet den Format-Grund", () => {
    const { coordinator } = makeCoordinator({}, { filePath: () => "teil.stl" });
    expect(coordinator.availability().ok).toBe(false);
    expect(coordinator.availability().reason).toContain("glTF");
  });
});

/** Auswahl herstellen wie es das Rig taete: ueber den onSelect-Callback. */
function coordinatorSelect(coordinator: EditCoordinator, index: number): void {
  (coordinator as unknown as { handleSelect(index: number | null): void }).handleSelect(index);
}
