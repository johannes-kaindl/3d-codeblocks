// ArrayBuffer → Object3D. Kennt Obsidian nicht.
//
// KEINE DRACOLoader-Registrierung: `DRACOLoader` konstruiert `new Worker(...)` fest
// verdrahtet, und Obsidians Renderer verbietet Worker. Draco-Dateien werden vorher in
// `block-child.ts` abgefangen (core/gltf-inspect), damit der Nutzer den Grund sieht.
//
// MESHOPT dagegen geht: `decodeGltfBufferAsync` prueft `workers.length > 0` und faellt
// sonst auf synchrones WASM im Main-Thread zurueck — `useWorkers()` ist reines Opt-in,
// three ruft es nie von selbst, und wir rufen es hier bewusst NICHT. Das WASM liegt
// base64-inline im Modul, es gibt also auch keinen Netzwerkzugriff.
import { LoadingManager, Mesh, MeshStandardMaterial, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { ModelFormat } from "../core/format";

/**
 * @param resolveUrl Uebersetzt eine URI aus der Datei (`.bin`, Texturen) in etwas Ladbares.
 *   Kommt von aussen herein, damit diese Datei den Vault nicht kennen muss; fehlt sie,
 *   bleibt jede URI unveraendert (dann laden nur `data:`-URIs, wie bisher).
 */
export function loadModel(
  buffer: ArrayBuffer,
  format: ModelFormat,
  materialColor: string,
  resolveUrl?: (uri: string) => string,
): Promise<Object3D> {
  return format === "gltf"
    ? loadGltf(buffer, resolveUrl)
    : Promise.resolve(loadStl(buffer, materialColor));
}

function loadGltf(buffer: ArrayBuffer, resolveUrl?: (uri: string) => string): Promise<Object3D> {
  const manager = new LoadingManager();
  if (resolveUrl) manager.setURLModifier(resolveUrl);

  return new Promise((resolve, reject) => {
    new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).parse(
      buffer,
      "",
      (gltf) => {
        // Zuordnung Szene ↔ JSON-Node fuer den Editor: three sanitisiert `name` beim Laden,
        // der JSON-Index aus `parser.associations` ist die verlaessliche Identitaet.
        const associations = (
          gltf as unknown as {
            parser?: { associations?: Map<object, { nodes?: number }> };
          }
        ).parser?.associations;
        if (associations) {
          for (const [object, assoc] of associations) {
            if (assoc?.nodes !== undefined) {
              (object as Object3D).userData.tdcbNodeIndex = assoc.nodes;
            }
          }
        }
        resolve(gltf.scene);
      },
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function loadStl(buffer: ArrayBuffer, materialColor: string): Object3D {
  const geometry = new STLLoader().parse(buffer);
  // STL kennt keine Materialien — Farbe kommt aus einer Theme-Variablen (Spec §5).
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();

  // Das "Magics"-Farbformat legt Farben pro Dreieck ab; `STLLoader` haengt sie als
  // `color`-Attribut an. Dann gehoert die Farbe der DATEI, nicht dem Theme — und das
  // Material muss weiss bleiben, sonst multipliziert es die Theme-Farbe hinein.
  const hasOwnColors = geometry.getAttribute("color") !== undefined;

  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: hasOwnColors ? 0xffffff : materialColor,
      vertexColors: hasOwnColors,
      roughness: 0.85,
      metalness: 0,
    }),
  );
  // Markierung fuer `Viewport.setColors`: nur selbst vergebene Materialien folgen dem
  // Theme — die Materialien aus einer GLB-Datei bleiben unangetastet, und ein STL, das
  // eigene Farben mitbringt, ebenfalls nicht.
  mesh.userData.tdcbThemedMaterial = !hasOwnColors;
  return mesh;
}
