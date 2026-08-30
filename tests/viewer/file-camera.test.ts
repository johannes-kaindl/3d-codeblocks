import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { fileCameraFit } from "../../src/viewer/file-camera";
import type { FileCamera } from "../../src/viewer/loaders";

const MIN = { x: -1, y: -1, z: -1 };
const MAX = { x: 1, y: 1, z: 1 };

/** Kamera-Knoten wie ihn der Loader liefert: ein Object3D mit Position und Drehung. */
function nodeAt(x: number, y: number, z: number, turnY = 0): FileCamera {
  const object = new Object3D();
  object.position.set(x, y, z);
  object.rotation.y = turnY;
  return { nodeName: "Test", cameraName: null, orthographic: false, object, yfov: 0.66 };
}

describe("fileCameraFit", () => {
  it("uebernimmt die Position der Kamera unveraendert", () => {
    const fit = fileCameraFit(nodeAt(0, 0, 5), MIN, MAX);
    expect(fit.position.x).toBeCloseTo(0, 6);
    expect(fit.position.y).toBeCloseTo(0, 6);
    expect(fit.position.z).toBeCloseTo(5, 6);
  });

  it("zielt auf das Modell, wenn die Kamera es anschaut", () => {
    const fit = fileCameraFit(nodeAt(0, 0, 5), MIN, MAX);
    expect(fit.target.x).toBeCloseTo(0, 6);
    expect(fit.target.y).toBeCloseTo(0, 6);
    expect(fit.target.z).toBeCloseTo(0, 6);
  });

  it("bleibt auf der Blickachse, wenn die Kamera am Modell vorbeischaut", () => {
    // DER Test fuer die Entscheidung E1: die Kamera steht seitlich versetzt und blickt
    // geradeaus, NICHT auf das Modellzentrum. Zoege man das Ziel ins Zentrum, kippte das
    // Bild weg von dem, was der Autor gerahmt hat.
    const fit = fileCameraFit(nodeAt(3, 0, 5), MIN, MAX);
    expect(fit.target.x).toBeCloseTo(3, 6);
    expect(fit.target.z).toBeCloseTo(0, 6);
  });

  it("folgt der Drehung des Knotens", () => {
    // 90 Grad um Y: der Blick zeigt von +X aus nach -X, also auf den Ursprung.
    const fit = fileCameraFit(nodeAt(5, 0, 0, Math.PI / 2), MIN, MAX);
    expect(fit.target.x).toBeCloseTo(0, 5);
    expect(fit.target.z).toBeCloseTo(0, 5);
  });

  it("haelt einen positiven Abstand, wenn die Kamera vom Modell wegschaut", () => {
    // Kamera vor dem Modell, Blick nach aussen: die Projektion aufs Zentrum ist negativ.
    // Ein Ziel hinter der Kamera waere ein Orbit-Zentrum im Ruecken — der Nutzer wuerde
    // beim ersten Ziehen um einen Punkt kreisen, den er nicht sieht.
    const fit = fileCameraFit(nodeAt(0, 0, -5), MIN, MAX);
    expect(fit.distance).toBeGreaterThan(0);
    expect(fit.target.z).toBeLessThan(-5);
  });

  it("setzt near und far um den ermittelten Abstand", () => {
    const fit = fileCameraFit(nodeAt(0, 0, 5), MIN, MAX);
    expect(fit.near).toBeGreaterThan(0);
    expect(fit.near).toBeLessThan(fit.distance);
    expect(fit.far).toBeGreaterThan(fit.distance);
  });
});
