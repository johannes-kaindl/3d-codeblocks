import { describe, expect, it } from "vitest";
import { analyzeTopLevelNodes, extractTrsByName, patchGltfJson, patchGlbContainer, type TrsEdit } from "../../src/core/gltf-patch";
import { glbJsonText } from "../../src/core/gltf-inspect";
import { makeContractGltf, contractGltfText } from "../helpers/contract-gltf";

describe("analyzeTopLevelNodes", () => {
  it("liefert die Szenen-Nodes in Reihenfolge, mit TRS-Defaults", () => {
    const nodes = analyzeTopLevelNodes(makeContractGltf(), []);
    expect(nodes.map((n) => n.name)).toEqual(["privat-herd", "privat-bad", "env__gelaende"]);
    expect(nodes[0].index).toBe(0);
    expect(nodes[0].base).toEqual({ translation: [1, 0, 2], scale: [1, 1, 1] });
    expect(nodes[1].base.scale).toEqual([1, 1, 1]);
  });

  it("Kind-Nodes (__dome) erscheinen nicht — nur Top-Level ist waehlbar", () => {
    const nodes = analyzeTopLevelNodes(makeContractGltf(), []);
    expect(nodes.some((n) => n.name === "privat-herd__dome")).toBe(false);
  });

  it("sperrt Nodes mit passendem Praefix", () => {
    const nodes = analyzeTopLevelNodes(makeContractGltf(), ["env__"]);
    expect(nodes.find((n) => n.name === "env__gelaende")?.lock).toBe("prefix");
    expect(nodes.find((n) => n.name === "privat-herd")?.lock).toBeNull();
  });

  it("ohne Praefix-Liste ist nichts praefix-gesperrt", () => {
    const nodes = analyzeTopLevelNodes(makeContractGltf(), []);
    expect(nodes.every((n) => n.lock !== "prefix")).toBe(true);
  });

  it("sperrt Nodes mit matrix-Transform", () => {
    const json = makeContractGltf();
    (json.nodes as Record<string, unknown>[])[0].matrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const nodes = analyzeTopLevelNodes(json, []);
    expect(nodes.find((n) => n.name === "privat-herd")?.lock).toBe("matrix");
  });

  it("sperrt doppelte Namen — der Slug-Schluessel waere mehrdeutig", () => {
    const json = makeContractGltf();
    (json.nodes as Record<string, unknown>[])[2].name = "privat-herd";
    const nodes = analyzeTopLevelNodes(json, []);
    expect(nodes.filter((n) => n.lock === "duplicate-name")).toHaveLength(2);
  });

  it("sperrt namenlose Nodes", () => {
    const json = makeContractGltf();
    delete (json.nodes as Record<string, unknown>[])[2].name;
    const nodes = analyzeTopLevelNodes(json, []);
    expect(nodes[1].lock).toBe("unnamed");
    expect(nodes[1].name).toBe("#2"); // Anzeige-Fallback: Index
  });

  it("wirft nicht bei kaputtem JSON-Gerippe, sondern liefert []", () => {
    expect(analyzeTopLevelNodes(null, [])).toEqual([]);
    expect(analyzeTopLevelNodes({ scenes: "nope" }, [])).toEqual([]);
  });
});

describe("extractTrsByName", () => {
  it("liefert TRS pro benanntem Top-Level-Node", () => {
    const map = extractTrsByName(makeContractGltf());
    expect(map.get("privat-herd")).toEqual({ translation: [1, 0, 2], scale: [1, 1, 1] });
    expect(map.get("env__gelaende")).toEqual({ translation: [0, -0.1, 0], scale: [1, 1, 1] });
    expect(map.has("privat-herd__dome")).toBe(false);
  });
});

const MOVE: TrsEdit[] = [{ index: 0, translation: [4, 0, 2], scale: [1, 1, 1] }];

describe("patchGltfJson", () => {
  it("ersetzt nur translation/scale des adressierten Nodes — Rest identisch", () => {
    const before = JSON.parse(contractGltfText());
    const after = JSON.parse(patchGltfJson(contractGltfText(), MOVE));
    expect(after.nodes[0].translation).toEqual([4, 0, 2]);
    expect(after.nodes[0].scale).toEqual([1, 1, 1]);
    // Alles andere Property-fuer-Property unveraendert:
    expect(after.nodes[0].name).toBe(before.nodes[0].name);
    expect(after.nodes[0].children).toEqual(before.nodes[0].children);
    expect(after.nodes.length).toBe(before.nodes.length);
    expect(after.buffers).toEqual(before.buffers);
    expect(after.meshes).toEqual(before.meshes);
    expect(after.accessors).toEqual(before.accessors);
    expect(after.scenes).toEqual(before.scenes);
  });

  it("schreibt nie matrix und loescht keine rotation", () => {
    const json = JSON.parse(contractGltfText());
    json.nodes[0].rotation = [0, 0, 0, 1];
    const after = JSON.parse(patchGltfJson(JSON.stringify(json), MOVE));
    expect(after.nodes[0].matrix).toBeUndefined();
    expect(after.nodes[0].rotation).toEqual([0, 0, 0, 1]);
  });

  it("wirft bei unbekanntem Node-Index", () => {
    expect(() => patchGltfJson(contractGltfText(), [{ index: 99, translation: [0,0,0], scale: [1,1,1] }]))
      .toThrow(/99/);
  });

  it("wirft bei Node mit matrix — der ist per Analyse gesperrt, ein Edit hier ist ein Bug", () => {
    const json = JSON.parse(contractGltfText());
    json.nodes[0].matrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    expect(() => patchGltfJson(JSON.stringify(json), MOVE)).toThrow(/matrix/);
  });
});

describe("patchGlbContainer", () => {
  /** Kontrakt-JSON als GLB verpacken: 12-Byte-Header + JSON-Chunk + BIN-Chunk. */
  function makeGlb(jsonText: string): ArrayBuffer {
    const jsonBytes = new TextEncoder().encode(jsonText);
    const jsonPadded = (jsonBytes.length + 3) & ~3;
    const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // 8 Bytes, schon 4er-aligned
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

  it("patcht den JSON-Chunk und laesst den BIN-Chunk byte-identisch", () => {
    const glb = makeGlb(contractGltfText());
    const patched = patchGlbContainer(glb, MOVE);
    const after = JSON.parse(glbJsonText(patched) ?? "null");
    expect(after.nodes[0].translation).toEqual([4, 0, 2]);
    // BIN-Chunk (letzte 8 Bytes) unveraendert:
    expect([...new Uint8Array(patched).slice(-8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("haelt Header-Laenge und 4-Byte-Padding der GLB-Spec ein", () => {
    const patched = patchGlbContainer(makeGlb(contractGltfText()), MOVE);
    const view = new DataView(patched);
    expect(view.getUint32(8, true)).toBe(patched.byteLength);
    expect(view.getUint32(12, true) % 4).toBe(0);
  });

  it("wirft bei ungueltigem Container", () => {
    expect(() => patchGlbContainer(new ArrayBuffer(4), MOVE)).toThrow();
  });
});
