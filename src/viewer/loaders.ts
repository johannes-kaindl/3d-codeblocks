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
import type { FileCameraInfo } from "../core/gltf-cameras";

/** Eine in der Datei definierte Kamera, verknuepft mit ihrem Objekt in der Szene. */
export interface FileCamera extends FileCameraInfo {
  /** Der Kamera-Knoten in der geladenen Szene — traegt Position und Blickrichtung. */
  object: Object3D;
  /** Bildwinkel in Radiant, wie ihn die Datei nennt; `0` bei orthographischen Kameras. */
  yfov: number;
}

export interface LoadedModel {
  object: Object3D;
  /** Leer bei STL und bei glTF-Dateien ohne Kameras. */
  cameras: FileCamera[];
}

/** Ausschnitt des glTF-JSON, den die Kamera-Extraktion braucht. */
interface GltfJson {
  nodes?: { name?: string; camera?: number }[];
  cameras?: { name?: string; type?: string; perspective?: { yfov?: number } }[];
}

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
): Promise<LoadedModel> {
  return format === "gltf"
    ? loadGltf(buffer, resolveUrl)
    : Promise.resolve({ object: loadStl(buffer, materialColor), cameras: [] });
}

function loadGltf(buffer: ArrayBuffer, resolveUrl?: (uri: string) => string): Promise<LoadedModel> {
  const manager = new LoadingManager();
  if (resolveUrl) manager.setURLModifier(resolveUrl);

  return new Promise((resolve, reject) => {
    new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).parse(
      buffer,
      "",
      (gltf) => {
        // Zuordnung Szene ↔ JSON-Node fuer den Editor: three sanitisiert `name` beim Laden,
        // der JSON-Index aus `parser.associations` ist die verlaessliche Identitaet.
        const parser = (
          gltf as unknown as {
            parser?: { associations?: Map<object, { nodes?: number }>; json?: GltfJson };
          }
        ).parser;
        const associations = parser?.associations;
        const byNodeIndex = new Map<number, Object3D>();
        if (associations) {
          for (const [object, assoc] of associations) {
            if (assoc?.nodes !== undefined) {
              (object as Object3D).userData.tdcbNodeIndex = assoc.nodes;
              byNodeIndex.set(assoc.nodes, object as Object3D);
            }
          }
        }
        resolve({ object: gltf.scene, cameras: collectCameras(parser?.json, byNodeIndex) });
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

/** Kamera-Knoten aus dem ROHEN JSON einsammeln, in Node-Reihenfolge.
    Bewusst nicht ueber `gltf.cameras` oder den Szenengraph: three sanitisiert die Namen
    beim Laden und haengt bei Dubletten einen Zaehler an — siehe `core/gltf-cameras.ts`.
    Hier faellt nur das Urteil ueber die Struktur; welcher Name gewinnt, entscheidet
    dort die pure Auswahl. */
function collectCameras(json: GltfJson | undefined, byNodeIndex: Map<number, Object3D>): FileCamera[] {
  const cameras: FileCamera[] = [];
  const nodes = json?.nodes ?? [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node?.camera === undefined) continue;

    const def = json?.cameras?.[node.camera];
    const object = byNodeIndex.get(index);
    // Ohne Objekt gibt es nichts anzufahren (Knoten haengt in keiner geladenen Szene),
    // ohne Definition nichts zu beurteilen.
    if (def === undefined || object === undefined) continue;

    cameras.push({
      nodeName: node.name ?? null,
      cameraName: def.name ?? null,
      orthographic: def.type === "orthographic",
      object,
      yfov: def.perspective?.yfov ?? 0,
    });
  }

  return cameras;
}
