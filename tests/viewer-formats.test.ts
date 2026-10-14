/**
 * Roadmap S7: die weiteren Formate laufen durch den ECHTEN Loader des Prueflings, mit den Fixture-Dateien des GUI-Smokes.
 * 3MF fehlt hier bewusst als Ladetest: `ThreeMFLoader` braucht `DOMParser`, und die Testumgebung ist `node` — der Weg ist im GUI-Smoke
 * (Abschnitt basis, B20) belegt; hier wird nur die Zip-Struktur der Fixture-Datei geprueft.
 */
import { describe, expect, it, vi } from "vitest";
import { LineSegments, Mesh, Points, type Object3D } from "three";
import { unzipSync } from "three/examples/jsm/libs/fflate.module.js";
import { loadModel } from "../src/viewer/loaders";
import { coloredCubeObj, cube3mf, octahedronPly, sphereXyz, spherePcd, towerGcode } from "../docs/images/fixture/make-models.mjs";

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const kinds = (root: Object3D): Object3D[] => {
  const all: Object3D[] = [];
  root.traverse((c) => all.push(c));
  return all;
};

describe("OBJ (+MTL)", () => {
  it("ohne MTL: Theme-Material, damit das Modell dem Theme folgt", async () => {
    const { object } = await loadModel(bytes(coloredCubeObj().obj), "obj", "#888888");
    const meshes = kinds(object).filter((c): c is Mesh => c instanceof Mesh);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((m) => m.userData.tdcbThemedMaterial === true)).toBe(true);
  });

  it("mit MTL (ueber resolveUrl): die Materialien der Datei gewinnen, nichts folgt dem Theme", async () => {
    const cube = coloredCubeObj();
    const dataUrl = `data:text/plain;base64,${Buffer.from(cube.mtl).toString("base64")}`;
    const asked: string[] = [];
    const resolveUrl = (uri: string): string => {
      asked.push(uri);
      return uri === cube.mtlName ? dataUrl : uri;
    };
    const { object } = await loadModel(bytes(cube.obj), "obj", "#888888", resolveUrl);
    expect(asked).toContain(cube.mtlName);
    const meshes = kinds(object).filter((c): c is Mesh => c instanceof Mesh);
    expect(meshes.every((m) => m.userData.tdcbThemedMaterial !== true)).toBe(true);
    const mats = (Array.isArray(meshes[0]!.material) ? meshes[0]!.material : [meshes[0]!.material]) as unknown as { color: { r: number; g: number; b: number } }[];
    // Mindestens ein Material ist das Rot der MTL (Kd 0.85 0.1 0.1, nach Farbraum-Umrechnung noch klar rot).
    expect(mats.some((m) => m.color.r > 0.5 && m.color.g < 0.3 && m.color.b < 0.3)).toBe(true);
  });

  it("MTL nicht auffindbar (resolveUrl gibt die URI zurueck): das Modell bleibt sichtbar, im Theme-Material", async () => {
    const { object } = await loadModel(bytes(coloredCubeObj().obj), "obj", "#888888", (uri) => uri);
    const meshes = kinds(object).filter((c): c is Mesh => c instanceof Mesh);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((m) => m.userData.tdcbThemedMaterial === true)).toBe(true);
  });

  it("eine MTL, die eine Textur aus dem Netz verlangt, schickt nichts ins Netz", async () => {
    const mtl = "newmtl rot\nKd 0.8 0.1 0.1\nmap_Kd https://evil.example/x.png\nnewmtl gruen\nmap_Kd //evil.example/y.png\nnewmtl blau\nmap_Kd file:///etc/passwd\n";
    const asked: string[] = [];
    const handedToThree: string[] = [];
    // three setzt die URL am Ende auf `image.src` (ImageLoader): ein Dokument-Stub schreibt mit, was dort ankommt — also das, was nach dem
    // URL-Modifier wirklich geladen wuerde.
    vi.stubGlobal("document", {
      createElementNS: () => ({
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        set src(value: string) { handedToThree.push(value); },
      }),
    });
    try {
      const cube = coloredCubeObj();
      const dataUrl = `data:text/plain;base64,${Buffer.from(mtl).toString("base64")}`;
      const resolveUrl = (uri: string): string => {
        asked.push(uri);
        return uri === cube.mtlName ? dataUrl : uri;
      };
      await loadModel(bytes(cube.obj), "obj", "#888888", resolveUrl);
    } finally {
      vi.unstubAllGlobals();
    }
    // three ist nach der MTL-Texturaufloesung gefragt worden (der Test erreicht die Stelle) ...
    expect(asked.filter((u) => /evil|etc\/passwd/.test(u)).length).toBeGreaterThan(0);
    // ... und hat zu keiner Zeit eine Netz- oder Datei-URL bekommen.
    expect(handedToThree.filter((u) => /^(https?:|file:|\/\/)/i.test(u))).toEqual([]);
  });

  it("kaputte MTL bricht das Laden nicht ab", async () => {
    const cube = coloredCubeObj();
    const resolveUrl = (uri: string): string => (uri === cube.mtlName ? "data:text/plain;base64,###" : uri);
    const { object } = await loadModel(bytes(cube.obj), "obj", "#888888", resolveUrl);
    expect(kinds(object).some((c) => c instanceof Mesh)).toBe(true);
  });
});

describe("PLY", () => {
  it("mit Flaechen und Farben: Mesh mit Eckenfarben der Datei", async () => {
    const { object } = await loadModel(bytes(octahedronPly()), "ply", "#888888");
    expect(object).toBeInstanceOf(Mesh);
    expect(object.userData.tdcbThemedMaterial).toBe(false);
    expect((object as Mesh).geometry.getAttribute("color")).toBeDefined();
  });

  it("ohne Flaechen: Punktwolke", async () => {
    const text = ["ply", "format ascii 1.0", "element vertex 3", "property float x", "property float y", "property float z", "end_header", "0 0 0", "1 0 0", "0 1 0"].join("\n");
    const { object } = await loadModel(bytes(text), "ply", "#888888");
    expect(object).toBeInstanceOf(Points);
  });
});

describe("Punktwolken und G-Code", () => {
  it("XYZ mit Farbe: Punkte mit Dateifarben, Groesse relativ zur Ausdehnung", async () => {
    const { object } = await loadModel(bytes(sphereXyz()), "xyz", "#888888");
    expect(object).toBeInstanceOf(Points);
    const material = (object as Points).material as unknown as { vertexColors: boolean; size: number };
    expect(material.vertexColors).toBe(true);
    expect(material.size).toBeGreaterThan(0.005);
    expect(material.size).toBeLessThan(0.05);
    expect(object.userData.tdcbThemedMaterial).toBe(false);
  });

  it("PCD ohne Farbe: Punkte im Theme-Material", async () => {
    const { object } = await loadModel(bytes(spherePcd()), "pcd", "#888888");
    expect(object).toBeInstanceOf(Points);
    expect(object.userData.tdcbThemedMaterial).toBe(true);
    expect(((object as Points).geometry.getAttribute("position")).count).toBe(4000);
  });

  it("G-Code: Linien, Y-oben (der Turm ist hoeher als breit)", async () => {
    const { object } = await loadModel(bytes(towerGcode()), "gcode", "#888888");
    expect(kinds(object).some((c) => c instanceof LineSegments)).toBe(true);
    object.updateMatrixWorld(true);
    const { Box3, Vector3 } = await import("three");
    const size = new Box3().setFromObject(object).getSize(new Vector3());
    expect(size.y).toBeGreaterThan(size.x * 0.4);
  });

  it("eine Datei ohne Geometrie meldet sich, statt ein leeres Bild zu zeigen", async () => {
    await expect(loadModel(bytes(""), "xyz", "#888888")).rejects.toThrow(/no geometry/);
    await expect(loadModel(bytes("# nur ein Kommentar\n"), "obj", "#888888")).rejects.toThrow(/no geometry/);
  });
});

describe("3MF-Fixture", () => {
  it("ist ein ZIP mit den drei Pflichtteilen und einem Modell aus 12 Dreiecken", () => {
    const files = unzipSync(cube3mf());
    expect(Object.keys(files).sort()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    const model = new TextDecoder().decode(files["3D/3dmodel.model"]);
    expect(model.match(/<triangle /g)).toHaveLength(12);
    expect(model.match(/<vertex /g)).toHaveLength(8);
  });
});
