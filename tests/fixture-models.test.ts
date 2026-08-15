/**
 * Das Demo-Material der README-Aufnahmen muss durch den ECHTEN Loader des Prueflings
 * gehen. Ohne diesen Test faellt eine Aenderung am Generator erst auf, wenn jemand die
 * Aufnahme fahren will — also genau dann, wenn Obsidian schon mit Debug-Port laeuft und
 * der Fehler am teuersten ist.
 */
import { describe, expect, it } from "vitest";
import type { Object3D } from "three";
import { loadModel } from "../src/viewer/loaders";
import { groundFloorGltf, octahedronStl } from "../docs/images/fixture/make-models.mjs";

/** Ohne Leerzeichen — three.js' GLTFLoader wuerde sie sonst zu Unterstrichen machen,
 *  und der Screenshot zeigte einen anderen Namen als die Fixture-Datei traegt. */
const NODE_NAMES = [
  "Floor", "Wall_north", "Wall_south", "Wall_west", "Wall_east",
  "Partition_hall", "Partition_bath", "Stairs", "Table", "Bed", "Stove",
];

async function load(text: string, kind: "gltf" | "stl"): Promise<Object3D> {
  const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
  return (await loadModel(bytes, kind, "#888888")) as Object3D;
}

describe("Fixture-Modelle fuer die README-Aufnahmen", () => {
  it("ground-floor.gltf laedt durch den Plugin-Loader", async () => {
    const scene = await load(JSON.stringify(groundFloorGltf()), "gltf");
    expect(scene).toBeTruthy();
  });

  it("traegt alle Knoten unter ihrem Namen — der Edit-Modus greift sie einzeln", async () => {
    const scene = await load(JSON.stringify(groundFloorGltf()), "gltf");
    const namen = new Set<string>();
    scene.traverse((child) => {
      if (child.name) namen.add(child.name);
    });
    for (const name of NODE_NAMES) expect(namen).toContain(name);
  });

  it("octahedron.stl laedt und traegt Geometrie", async () => {
    const scene = await load(octahedronStl(), "stl");
    let hatGeometrie = false;
    scene.traverse((child) => {
      const geo = (child as { geometry?: { attributes?: { position?: unknown } } }).geometry;
      if (geo?.attributes?.position) hatGeometrie = true;
    });
    expect(hatGeometrie).toBe(true);
  });
});

describe("STL-Normalen", () => {
  it("traegt echte Flaechennormalen — Nullnormalen lassen das Modell unbeleuchtet", async () => {
    const scene = await load(octahedronStl(), "stl");
    let normalen: Float32Array | null = null;
    scene.traverse((child) => {
      const geo = (child as { geometry?: { attributes?: { normal?: { array: Float32Array } } } }).geometry;
      if (geo?.attributes?.normal) normalen = geo.attributes.normal.array;
    });
    expect(normalen).not.toBeNull();
    const laengen = [];
    for (let i = 0; i < (normalen as unknown as Float32Array).length; i += 3) {
      const a = normalen as unknown as Float32Array;
      laengen.push(Math.hypot(a[i], a[i + 1], a[i + 2]));
    }
    expect(Math.min(...laengen)).toBeGreaterThan(0.9);
  });
});
