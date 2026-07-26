import { describe, expect, it, vi } from "vitest";
import { EditCoordinator, type EditIo } from "../../src/obsidian/edit-mode";
import { contractGltfText } from "../helpers/contract-gltf";
import type { NodeTrs } from "../../src/core/gltf-patch";

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
