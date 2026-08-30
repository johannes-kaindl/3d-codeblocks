import { describe, expect, it } from "vitest";
import { DirectionalLight, Group, Object3D, PointLight } from "three";
import { FILL_LIGHT_NAME, buildScene, hasOwnLights, setFillLights } from "../../src/viewer/scene";

const colors = { background: "#1e1e1e", material: "#888888", grid: "#444444" };
const fillCount = (scene: Object3D) =>
  scene.children.filter((c) => c.name === FILL_LIGHT_NAME).length;
// Zweiter, namensunabhaengiger Zaehler: `fillCount` allein waere gruen, wenn die
// Namensvergabe verlorenginge — die Lichter waeren dann da, hiessen nur anders.
const lightCount = (scene: Object3D) =>
  scene.children.filter((c) => (c as { isLight?: boolean }).isLight === true).length;

describe("buildScene", () => {
  it("haengt die Fuelllichter an, wenn sie verlangt sind", () => {
    expect(fillCount(buildScene(colors, true))).toBe(2);
  });

  it("laesst sie weg, wenn nicht", () => {
    const scene = buildScene(colors, false);
    expect(fillCount(scene)).toBe(0);
    expect(lightCount(scene)).toBe(0);
  });
});

describe("setFillLights", () => {
  it("haengt sie nachtraeglich an und wieder ab", () => {
    const scene = buildScene(colors, false);
    setFillLights(scene, true);
    expect(fillCount(scene)).toBe(2);
    setFillLights(scene, false);
    expect(fillCount(scene)).toBe(0);
  });

  // Ohne diese Zusicherung sammelt ein wiederholtes Umschalten Lichter an, bis die
  // Szene ueberstrahlt — der Fehler faellt erst nach mehreren Settings-Wechseln auf.
  it("verdoppelt bei zweimaligem Einschalten nichts", () => {
    const scene = buildScene(colors, true);
    setFillLights(scene, true);
    expect(fillCount(scene)).toBe(2);
  });
});

describe("hasOwnLights", () => {
  it("erkennt kein Licht in einem nackten Baum", () => {
    expect(hasOwnLights(new Group())).toBe(false);
  });

  it("erkennt ein Licht direkt am Objekt", () => {
    const root = new Group();
    root.add(new PointLight(0xffffff, 1));
    expect(hasOwnLights(root)).toBe(true);
  });

  // KHR_lights_punctual haengt die Lichter an die Nodes, in denen sie im Autoren-
  // werkzeug standen — das ist selten die Wurzel.
  it("findet ein verschachteltes Licht", () => {
    const root = new Group();
    const child = new Group();
    const grandchild = new Group();
    grandchild.add(new DirectionalLight(0xffffff, 1));
    child.add(grandchild);
    root.add(child);
    expect(hasOwnLights(root)).toBe(true);
  });
});
