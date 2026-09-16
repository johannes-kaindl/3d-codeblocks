/**
 * Das Demo-Material der README-Aufnahmen muss durch den ECHTEN Loader des Prueflings
 * gehen. Ohne diesen Test faellt eine Aenderung am Generator erst auf, wenn jemand die
 * Aufnahme fahren will — also genau dann, wenn Obsidian schon mit Debug-Port laeuft und
 * der Fehler am teuersten ist.
 */
import { describe, expect, it } from "vitest";
import type { Object3D } from "three";
import { loadModel } from "../src/viewer/loaders";
import {
  cameraFloorGltf,
  colouredOctahedronStl,
  groundFloorGltf,
  metallicOrbGltf,
  octahedronStl,
  splitGroundFloor,
} from "../docs/images/fixture/make-models.mjs";
import { fitCamera } from "../src/core/camera-fit";
import { fileCameraNames, findFileCamera, type FileCameraInfo } from "../src/core/gltf-cameras";
import { fileCameraFit } from "../src/viewer/file-camera";

/** Ohne Leerzeichen — three.js' GLTFLoader wuerde sie sonst zu Unterstrichen machen,
 *  und der Screenshot zeigte einen anderen Namen als die Fixture-Datei traegt. */
const NODE_NAMES = [
  "Floor", "Wall_north", "Wall_south", "Wall_west", "Wall_east",
  "Partition_hall", "Partition_bath", "Stairs", "Table", "Bed", "Stove",
];

async function load(text: string, kind: "gltf" | "stl"): Promise<Object3D> {
  const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
  return (await loadModel(bytes, kind, "#888888")).object as Object3D;
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

  it("metallic-orb.gltf laedt und traegt ein metallisches Material", async () => {
    const scene = await load(JSON.stringify(metallicOrbGltf()), "gltf");
    let material: { metalness?: number } | undefined;
    scene.traverse((child) => {
      const m = (child as { material?: { metalness?: number } }).material;
      if (m) material = m;
    });
    expect(material?.metalness).toBe(1);
  });
});

describe("colored-octahedron.stl — Pruefmaterial fuer eigene Facet-Farben", () => {
  it("laedt durch den Plugin-Loader und traegt eigene Farben", async () => {
    const bytes = colouredOctahedronStl();
    const scene = (await loadModel(bytes, "stl", "#888888")).object as Object3D & {
      material?: { vertexColors?: boolean };
    };
    let vertexColors = false;
    scene.traverse((child) => {
      const m = (child as { material?: { vertexColors?: boolean } }).material;
      if (m?.vertexColors) vertexColors = true;
    });
    expect(vertexColors).toBe(true);
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

describe("split model (geometry in a separate .bin)", () => {
  it("keeps the geometry out of the json", () => {
    const { gltf, bin } = splitGroundFloor();

    expect(gltf.buffers[0].uri).toBe("ground-floor.bin");
    expect(gltf.buffers[0].byteLength).toBe(bin.length);
    expect(JSON.stringify(gltf)).not.toContain("base64");
  });

  it("renders once the resolver hands over the .bin", async () => {
    const { gltf, bin } = splitGroundFloor();
    const resolve = (uri: string) =>
      uri === "ground-floor.bin"
        ? "data:application/octet-stream;base64," + Buffer.from(bin).toString("base64")
        : uri;

    const bytes = new TextEncoder().encode(JSON.stringify(gltf)).buffer as ArrayBuffer;
    const scene = (await loadModel(bytes, "gltf", "#888888", resolve)).object as Object3D;

    const names: string[] = [];
    scene.traverse((child) => {
      if (child.name !== "") names.push(child.name);
    });
    expect(names).toEqual(expect.arrayContaining(NODE_NAMES));
  });

  it("fails without a resolver — which is exactly the bug this fixture guards", async () => {
    const { gltf } = splitGroundFloor();
    const bytes = new TextEncoder().encode(JSON.stringify(gltf)).buffer as ArrayBuffer;

    await expect(loadModel(bytes, "gltf", "#888888")).rejects.toBeDefined();
  });
});

/**
 * Das Kamera-Fixture ist das Pruefmaterial des GUI-Smoke-Abschnitts `cameras`
 * (`scripts/gui-smoke.ts`). Ein Smoke-Pruefpunkt, dessen Material stillschweigend
 * kaputtgeht, wird rot und zeigt dabei auf den Prueffling statt auf sich selbst — genau
 * die Gattung Fehldiagnose, die am 2026-08-30 eine Session gekostet hat (eine spec-widrige
 * .glb aus dem Produktivvault liess 17 Punkte fallen). Deshalb haelt dieser Test die
 * Voraussetzungen des Abschnitts fest, wo sie in Sekunden pruefbar sind statt in Minuten
 * am laufenden Obsidian.
 */
describe("camera-floor.gltf — Pruefmaterial fuer `view: camera:<name>`", () => {
  /** Dieselbe Uebersetzung, die `collectCameras` in `viewer/loaders.ts` aus dem rohen
   *  JSON macht — hier nachgebaut, damit die Namensfragen ohne three beantwortbar sind. */
  const infos = (): FileCameraInfo[] => {
    const doc = cameraFloorGltf();
    return doc.nodes
      .filter((node) => node.camera !== undefined)
      .map((node) => {
        const def = doc.cameras[node.camera as number];
        return {
          nodeName: node.name ?? null,
          cameraName: def?.name ?? null,
          orthographic: def?.type === "orthographic",
        };
      });
  };

  it("laedt durch den Plugin-Loader und liefert die Kameras mit", async () => {
    const model = await loadModel(
      new TextEncoder().encode(JSON.stringify(cameraFloorGltf())).buffer as ArrayBuffer,
      "gltf",
      "#888888",
    );
    expect(model.cameras).toHaveLength(5);
  });

  it("traegt die Namen, die der GUI-Smoke anspricht — Leerzeichen inbegriffen", () => {
    // `Schnitt A` ist der Kern des Fixtures: three macht daraus im geladenen Objekt
    // `Schnitt_A`. Verliert der Generator das Leerzeichen, prueft der Smoke-Punkt
    // "Name mit Leerzeichen ist erreichbar" nur noch sich selbst.
    expect(fileCameraNames(infos())).toEqual(["Front", "Schnitt A", "Doppel", "Plan"]);
  });

  it("haelt genau eine orthographische Kamera bereit und vier perspektivische", () => {
    const ortho = infos().filter((c) => c.orthographic);
    expect(ortho).toHaveLength(1);
    expect(ortho[0]?.nodeName).toBe("Plan");
  });

  it("meldet `Doppel` als mehrdeutig, `Front` als eindeutig", () => {
    expect(findFileCamera(infos(), "Doppel")).toEqual({ kind: "found", index: 2, ambiguous: true });
    expect(findFileCamera(infos(), "Front")).toEqual({ kind: "found", index: 0, ambiguous: false });
  });

  it("stellt `Front` spuerbar anders als das Auto-Einpassen — sonst misst der Bildvergleich nichts", async () => {
    // Der Smoke-Punkt K1 entscheidet ueber einen Bild-Hash. Liegen beide Kameras nah
    // beieinander, waeren die Bilder gleich und der Punkt dauerhaft rot — bei intaktem
    // Plugin. Die Schwelle gehoert deshalb hierher, wo sie ohne Obsidian pruefbar ist.
    const model = await loadModel(
      new TextEncoder().encode(JSON.stringify(cameraFloorGltf())).buffer as ArrayBuffer,
      "gltf",
      "#888888",
    );
    const front = model.cameras[0];
    expect(front?.nodeName).toBe("Front");

    const min = { x: -4.1, y: -0.2, z: -3.1 };
    const max = { x: 4.1, y: 2.4, z: 3.1 };
    const auto = fitCamera(min, max, 50, 1.5);
    const datei = fileCameraFit(front as NonNullable<typeof front>, min, max);

    const abstand = Math.hypot(
      auto.position.x - datei.position.x,
      auto.position.y - datei.position.y,
      auto.position.z - datei.position.z,
    );
    expect(abstand).toBeGreaterThan(3);
  });
});
