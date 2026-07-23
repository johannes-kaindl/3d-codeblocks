// ArrayBuffer → Object3D. Kennt Obsidian nicht.
//
// KEINE DRACOLoader-/MeshoptDecoder-Registrierung: beide sind worker-basiert und
// Obsidians Renderer verbietet Worker. Komprimierte Dateien werden vorher in
// `block-child.ts` abgefangen (core/gltf-inspect), damit der Nutzer den Grund sieht.
import { Mesh, MeshStandardMaterial, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { ModelFormat } from "../core/format";

export function loadModel(
  buffer: ArrayBuffer,
  format: ModelFormat,
  materialColor: string,
): Promise<Object3D> {
  return format === "gltf" ? loadGltf(buffer) : Promise.resolve(loadStl(buffer, materialColor));
}

function loadGltf(buffer: ArrayBuffer): Promise<Object3D> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      "",
      (gltf) => resolve(gltf.scene),
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function loadStl(buffer: ArrayBuffer, materialColor: string): Object3D {
  const geometry = new STLLoader().parse(buffer);
  // STL kennt keine Materialien — Farbe kommt aus einer Theme-Variablen (Spec §5).
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();

  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({ color: materialColor, roughness: 0.85, metalness: 0 }),
  );
  // Markierung fuer `Viewport.setColors`: nur selbst vergebene Materialien folgen dem
  // Theme — die Materialien aus einer GLB-Datei bleiben unangetastet.
  mesh.userData.tdcbThemedMaterial = true;
  return mesh;
}
