// Mini-glTF nach Generator-Bauart (Spec §7): Raum-Nodes, __dome-Kind, env__-Node,
// data-URI-Buffer. Bewusst als Objekt, damit Tests einzelne Felder abwandeln koennen.
//
// Jeder Node bekommt einen EIGENEN mesh-Index (statt einen gemeinsamen): GLTFLoader
// (three 0.169) klont Objekte fuer Nodes mit geteiltem mesh-Index, propagiert dabei
// aber dieselbe `associations`-Wertreferenz auf alle Klone -- ein spaeteres
// `associations.get(node).nodes = nodeIndex` (Task 6, loaders.ts) ueberschreibt dann
// bei allen Klonen denselben Eintrag, sodass am Ende alle den zuletzt verarbeiteten
// Node-Index tragen. Eigene mesh-Eintraege pro Node umgehen das.
export function makeContractGltf(): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 2, 3] }],
    nodes: [
      { name: "privat-herd", mesh: 0, translation: [1, 0, 2], children: [1] },
      { name: "privat-herd__dome", mesh: 1, translation: [0, 0, 0] },
      { name: "privat-bad", mesh: 2, translation: [-3, 0, 1], scale: [1, 1, 1] },
      { name: "env__gelaende", mesh: 3, translation: [0, -0.1, 0] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 } }] },
      { primitives: [{ attributes: { POSITION: 0 } }] },
      { primitives: [{ attributes: { POSITION: 0 } }] },
      { primitives: [{ attributes: { POSITION: 0 } }] },
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [
      {
        byteLength: 36,
        uri: "data:application/octet-stream;base64," + btoa(String.fromCharCode(...new Uint8Array(36))),
      },
    ],
  };
}

export function contractGltfText(): string {
  return JSON.stringify(makeContractGltf());
}
