import { describe, expect, it, vi } from "vitest";
import { Group, Object3D } from "three";
import {
  duplicatedIndices,
  findByIndex,
  objectTrs,
  pickIndex,
  topLevelIndex,
} from "../../src/viewer/edit-controls";

function tree() {
  const root = new Group();
  const room = new Object3D();
  room.userData.tdcbNodeIndex = 0;
  const dome = new Object3D();
  dome.userData.tdcbNodeIndex = 1;
  room.add(dome);
  root.add(room);
  return { root, room, dome };
}

describe("topLevelIndex", () => {
  it("loest einen Treffer im Kind auf den Top-Level-Vorfahren auf", () => {
    const { root, dome } = tree();
    expect(topLevelIndex(root, dome)).toBe(0);
  });

  it("liefert null fuer Objekte ausserhalb des Modells", () => {
    const { root } = tree();
    expect(topLevelIndex(root, new Object3D())).toBeNull();
  });
});

describe("findByIndex / objectTrs", () => {
  it("findet den Top-Level-Node zum Index und liest seine TRS", () => {
    const { root, room } = tree();
    room.position.set(4, 0, 2);
    room.scale.set(2, 1, 1);
    const found = findByIndex(root, 0);
    expect(found).toBe(room);
    expect(objectTrs(room)).toEqual({ translation: [4, 0, 2], scale: [2, 1, 1] });
  });

  it("liefert null fuer unbekannte Indizes", () => {
    const { root } = tree();
    expect(findByIndex(root, 7)).toBeNull();
  });
});

// GLTFLoader (three) teilt bei geteilten Meshes dieselbe `associations`-Wertreferenz
// auf alle Klone -- danach koennen zwei Top-Level-Kinder DENSELBEN tdcbNodeIndex
// tragen. `findByIndex` nimmt dann einfach das erste: ein Klick auf Raum B
// verschoebe Raum A. Solche Indizes gelten deshalb als nicht auswaehlbar.
describe("duplicatedIndices", () => {
  function sharedTree() {
    const root = new Group();
    const a = new Object3D();
    a.userData.tdcbNodeIndex = 0;
    const b = new Object3D();
    b.userData.tdcbNodeIndex = 0; // geteiltes Mesh -> gleicher Index
    const c = new Object3D();
    c.userData.tdcbNodeIndex = 2;
    const nameless = new Object3D(); // ganz ohne Index
    root.add(a, b, c, nameless);
    return { root, a, b, c, nameless };
  }

  it("findet mehrfach vergebene Top-Level-Indizes", () => {
    const { root } = sharedTree();
    expect(duplicatedIndices(root)).toEqual(new Set([0]));
  });

  it("meldet nichts bei eindeutigen Indizes", () => {
    const { root } = tree();
    expect(duplicatedIndices(root).size).toBe(0);
  });
});

describe("pickIndex", () => {
  function sharedTree() {
    const root = new Group();
    const a = new Object3D();
    a.userData.tdcbNodeIndex = 0;
    const b = new Object3D();
    b.userData.tdcbNodeIndex = 0;
    const c = new Object3D();
    c.userData.tdcbNodeIndex = 2;
    root.add(a, b, c);
    return { root, a, b, c };
  }

  const always = () => true;

  it("KEINES der beiden Geschwister mit geteiltem Index ist auswaehlbar", () => {
    const { root, a, b } = sharedTree();
    const duplicated = duplicatedIndices(root);
    expect(pickIndex(root, a, duplicated, always)).toBeNull();
    expect(pickIndex(root, b, duplicated, always)).toBeNull();
  });

  it("eindeutige Geschwister bleiben auswaehlbar", () => {
    const { root, c } = sharedTree();
    expect(pickIndex(root, c, duplicatedIndices(root), always)).toBe(2);
  });

  it("respektiert weiterhin isSelectable (gesperrte Nodes)", () => {
    const { root, c } = sharedTree();
    const isSelectable = vi.fn(() => false);
    expect(pickIndex(root, c, duplicatedIndices(root), isSelectable)).toBeNull();
    expect(isSelectable).toHaveBeenCalledWith(2);
  });

  it("liefert null ohne Treffer und fuer Objekte ausserhalb des Modells", () => {
    const { root } = sharedTree();
    expect(pickIndex(root, null, new Set(), always)).toBeNull();
    expect(pickIndex(root, new Object3D(), new Set(), always)).toBeNull();
  });

  it("fragt isSelectable bei einem doppelten Index gar nicht erst", () => {
    const { root, a } = sharedTree();
    const isSelectable = vi.fn(() => true);
    expect(pickIndex(root, a, duplicatedIndices(root), isSelectable)).toBeNull();
    expect(isSelectable).not.toHaveBeenCalled();
  });
});
