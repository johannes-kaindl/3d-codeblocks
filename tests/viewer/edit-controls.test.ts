import { describe, expect, it } from "vitest";
import { Group, Object3D } from "three";
import { findByIndex, objectTrs, topLevelIndex } from "../../src/viewer/edit-controls";

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
