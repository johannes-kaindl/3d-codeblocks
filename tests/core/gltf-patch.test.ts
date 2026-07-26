import { describe, expect, it } from "vitest";
import { analyzeTopLevelNodes, extractTrsByName } from "../../src/core/gltf-patch";
import { makeContractGltf } from "../helpers/contract-gltf";

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
