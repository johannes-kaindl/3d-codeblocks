/**
 * Erzeugt das Demo-Material fuer die README-Aufnahmen (docs/images/README.md).
 *
 * Warum ein Generator statt getrackter Modelldateien: die Modelle sollen im Repo
 * lesbar und aenderbar sein, nicht als undurchsichtige Datenblobs liegen. Der
 * Aufnahme-Vault entsteht daraus (`npm run shots -- --setup`) und ist jederzeit
 * wegwerfbar.
 *
 * Warum ueberhaupt eigenes Material: der GUI-Smoke faehrt bisher gegen ein Modell aus
 * dem echten Vault des Maintainers (`weltmodell/3d/eg.gltf`). Fuer ein Bild, das in
 * einem oeffentlichen README landet, geht das nicht — Screenshots duerfen nichts
 * Privates zeigen, und ein Aufnahme-Vault ohne eigene Inhalte ist nicht reproduzierbar.
 *
 * Aufruf: node docs/images/fixture/make-models.mjs <zielverzeichnis>
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

// --- Geometrie: ein Einheitswuerfel, von allen Knoten geteilt -----------------
// Ein einziges Mesh pro Material, instanziiert ueber benannte Top-Level-Knoten. Genau
// diese Struktur braucht der Edit-Modus (er bewegt Top-Level-Knoten und ordnet sie
// beim Wiedereinlesen ueber ihren NAMEN zu) — ein Modell aus einem einzigen
// verschmolzenen Mesh waere fuer den Edit-Screenshot unbrauchbar.

const P = [
  // +X, -X, +Y, -Y, +Z, -Z — je vier Ecken, damit jede Flaeche eigene Normalen hat
  [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5],
  [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5],
  [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
];
const N = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
].flatMap((n) => [n, n, n, n]);
const IDX = [0, 1, 2, 3, 4, 5].flatMap((f) => {
  const o = f * 4;
  return [o, o + 1, o + 2, o, o + 2, o + 3];
});

/** Farben bewusst fuer das helle Standard-Theme gewaehlt (Aufnahme-Kanon): gedeckte
 *  Bautoene mit zwei Akzenten, die sich auch in Graustufen noch unterscheiden. */
const MATERIALS = [
  { name: "Floor", color: [0.839, 0.796, 0.722, 1] },
  { name: "Wall", color: [0.910, 0.902, 0.882, 1] },
  { name: "Partition", color: [0.788, 0.769, 0.733, 1] },
  { name: "Stairs", color: [0.604, 0.627, 0.651, 1] },
  { name: "Furniture", color: [0.420, 0.549, 0.686, 1] },
  { name: "Accent", color: [0.753, 0.478, 0.369, 1] },
];

/** Ein Erdgeschoss: Boden, vier Aussenwaende, zwei Trennwaende, Treppe, drei Moebel.
 *  Benannte Knoten, weil der Edit-Modus sie einzeln greift.
 *
 *  Namen ohne Leerzeichen: three.js' GLTFLoader ersetzt sie beim Laden durch
 *  Unterstriche. Das ist fuer das Plugin harmlos (es adressiert ueber tdcbNodeIndex,
 *  und die Edit-Zuordnung vergleicht JSON-Namen mit JSON-Namen) — aber ein Screenshot,
 *  in dem die Sidebar "Wall_north" zeigt, waehrend die Datei "Wall north" sagt, waere
 *  eine Falle fuer jeden, der das Bild spaeter nachbaut. */
const NODES = [
  ["Floor", 0, [0, -0.1, 0], [8, 0.2, 6]],
  ["Wall_north", 1, [0, 1.2, -3], [8, 2.4, 0.2]],
  ["Wall_south", 1, [0, 1.2, 3], [8, 2.4, 0.2]],
  ["Wall_west", 1, [-4, 1.2, 0], [0.2, 2.4, 6]],
  ["Wall_east", 1, [4, 1.2, 0], [0.2, 2.4, 6]],
  ["Partition_hall", 2, [-0.8, 1.1, 0], [0.16, 2.2, 4.2]],
  ["Partition_bath", 2, [1.8, 1.1, -1.4], [5, 2.2, 0.16]],
  ["Stairs", 3, [-2.6, 0.55, 1.9], [1.6, 1.1, 2.2]],
  ["Table", 4, [1.9, 0.38, 1.3], [1.8, 0.08, 1.0]],
  ["Bed", 4, [2.6, 0.25, -2.1], [1.4, 0.5, 2.0]],
  ["Stove", 5, [-2.6, 0.45, -2.2], [0.9, 0.9, 0.7]],
];

export function groundFloorGltf() {
  const floats = [...P.flat(), ...N.flat()];
  const bytes = Buffer.concat([
    Buffer.from(new Float32Array(floats).buffer),
    Buffer.from(new Uint16Array(IDX).buffer),
  ]);
  const posLen = P.length * 3 * 4;
  const nrmLen = N.length * 3 * 4;

  return {
    asset: {
      version: "2.0",
      generator: "3d-codeblocks docs/images/fixture/make-models.mjs",
      extras: {
        note: "Demo-Material fuer die README-Aufnahmen. Frei erzeugt, nichts Privates.",
      },
    },
    scene: 0,
    scenes: [{ name: "Ground_floor", nodes: NODES.map((_n, i) => i) }],
    nodes: NODES.map(([name, mat, t, s]) => ({
      name,
      mesh: mat,
      translation: t,
      scale: s,
    })),
    meshes: MATERIALS.map((m, i) => ({
      name: m.name,
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: i }],
    })),
    materials: MATERIALS.map((m) => ({
      name: m.name,
      pbrMetallicRoughness: {
        baseColorFactor: m.color,
        metallicFactor: 0.0,
        roughnessFactor: 0.85,
      },
    })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: P.length, type: "VEC3",
        min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: N.length, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: IDX.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posLen, target: 34962 },
      { buffer: 0, byteOffset: posLen, byteLength: nrmLen, target: 34962 },
      { buffer: 0, byteOffset: posLen + nrmLen, byteLength: IDX.length * 2, target: 34963 },
    ],
    buffers: [{
      byteLength: bytes.length,
      uri: "data:application/octet-stream;base64," + bytes.toString("base64"),
    }],
  };
}

/** Ein ASCII-STL: das Format kennt keine Materialien, der Prueffall fuer das
 *  theme-abhaengige Default-Material. Ein Oktaeder — erkennbar dreidimensional,
 *  ohne Achsen-Symmetrie, die eine schiefe Kamera kaschieren wuerde. */
export function octahedronStl() {
  const v = [
    [0, 1.4, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1.4, 0],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1],
    [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4],
  ];
  /** Echte Flaechennormale aus dem Kreuzprodukt. `facet normal 0 0 0` waere syntaktisch
   *  gueltig, laesst das Modell im Viewer aber unbeleuchtet — es laedt und ist trotzdem
   *  nicht zu sehen. Genau das ist am 2026-08-15 im GUI-Smoke aufgefallen, nachdem ein
   *  Unit-Test, der nur die Positionen prueft, es fuer in Ordnung erklaert hatte. */
  const normale = (a, b, c) => {
    const u = [v[b][0] - v[a][0], v[b][1] - v[a][1], v[b][2] - v[a][2]];
    const w = [v[c][0] - v[a][0], v[c][1] - v[a][1], v[c][2] - v[a][2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    return n.map((x) => (x / len).toFixed(6));
  };
  const out = ["solid demo"];
  for (const [a, b, c] of faces) {
    out.push(` facet normal ${normale(a, b, c).join(" ")}`, "  outer loop");
    for (const i of [a, b, c]) out.push(`   vertex ${v[i].join(" ")}`);
    out.push("  endloop", " endfacet");
  }
  out.push("solid demo".replace("solid", "endsolid"), "");
  return out.join("\n");
}

/** Schreibt beide Modelle nach <ziel>/models/ und meldet die Pfade. */
export function writeModels(target) {
  const modelPath = join(target, "models", "ground-floor.gltf");
  const stlPath = join(target, "models", "octahedron.stl");
  mkdirSync(dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, JSON.stringify(groundFloorGltf(), null, 1) + "\n");
  writeFileSync(stlPath, octahedronStl());
  return [modelPath, stlPath];
}

// Nur beim direkten Aufruf ausfuehren — der Fixture-Test importiert dieses Modul, und
// ein Modul, das beim Import `exit(1)` ruft, ist nicht testbar.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const target = argv[2];
  if (!target) {
    console.error("Aufruf: node docs/images/fixture/make-models.mjs <zielverzeichnis>");
    exit(1);
  }
  for (const pfad of writeModels(target)) console.log(`  ${pfad}`);
}
