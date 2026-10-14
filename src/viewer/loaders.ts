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
import { Box3, BufferGeometry, FileLoader, Group, LoadingManager, Mesh, MeshStandardMaterial, Object3D, Points, PointsMaterial, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { GCodeLoader } from "three/examples/jsm/loaders/GCodeLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { XYZLoader } from "three/examples/jsm/loaders/XYZLoader.js";
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
  // `shapes` ist Text, kein Ladeformat: der ViewerHost wandelt ihn vorher in glTF um
  // (core/shapes/convert). Kommt er doch hier an, ist das ein Verdrahtungsfehler — ohne
  // diesen Wächter fiele er still in den STL-Zweig und zeigte Datenmüll.
  if (format === "shapes") {
    return Promise.reject(new Error("shapes text must be converted to glTF before loading"));
  }
  if (format === "gltf") return loadGltf(buffer, resolveUrl);
  return loadPlain(buffer, format, materialColor, resolveUrl).then((object) => {
    // Eine Datei ohne Geometrie waere ein leerer Bildschirm ohne Grund: lieber die Meldung des Hosts („Could not load the model“).
    if (new Box3().setFromObject(object).isEmpty()) throw new Error("the file holds no geometry");
    return { object, cameras: [] as FileCamera[] };
  });
}

/** Alle Formate ohne Kameras und ohne Nebendateien-Zwang: STL, 3MF, OBJ(+MTL), PLY, GCode, XYZ, PCD. */
async function loadPlain(
  buffer: ArrayBuffer,
  format: Exclude<ModelFormat, "gltf" | "shapes">,
  materialColor: string,
  resolveUrl?: (uri: string) => string,
): Promise<Object3D> {
  switch (format) {
    case "stl":
      return loadStl(buffer, materialColor);
    case "3mf": {
      // 3MF ist Z-oben (Spezifikation), die Szene Y-oben: wie bei den three-Beispielen um -90 Grad um X drehen.
      const model = new ThreeMFLoader().parse(buffer);
      model.rotation.x = -Math.PI / 2;
      const root = new Group();
      root.add(model);
      return root;
    }
    case "obj":
      return loadObj(buffer, materialColor, resolveUrl);
    case "ply":
      return loadPly(buffer, materialColor);
    case "gcode":
      // Der Loader dreht selbst von Z-oben nach Y-oben; Pfad- und Extrusionslinien tragen ihre eigenen Farben.
      return new GCodeLoader().parse(decodeText(buffer));
    case "xyz":
      // Die mitgelieferten Typen kennen nur die alte Form `parse(text, onLoad)`; die Funktion gibt die Geometrie zurueck (three 0.169).
      return pointsFrom((new XYZLoader() as unknown as { parse(text: string): BufferGeometry }).parse(decodeText(buffer)), materialColor);
    case "pcd":
      return pointsFrom(new PCDLoader().parse(buffer).geometry, materialColor);
  }
}

const decodeText = (buffer: ArrayBuffer): string => new TextDecoder().decode(buffer);

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
  return meshFrom(new STLLoader().parse(buffer), materialColor);
}

/** Geometrie ohne Material (STL, PLY mit Flaechen) → Mesh im Theme-Material oder mit den Farben der Datei. */
function meshFrom(geometry: BufferGeometry, materialColor: string): Object3D {
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

/** Punktgroesse relativ zur Ausdehnung der Wolke: eine feste Groesse waere bei Metern und bei Millimetern jeweils unsichtbar oder ein Klumpen. */
const POINT_SIZE_FRACTION = 0.004;

/** Geometrie ohne Flaechen (XYZ, PCD, PLY ohne Faces) → Punktwolke; Farben der Datei gewinnen, sonst Theme-Farbe. */
function pointsFrom(geometry: BufferGeometry, materialColor: string): Object3D {
  const hasOwnColors = geometry.getAttribute("color") !== undefined;
  geometry.computeBoundingBox();
  const extent = geometry.boundingBox ? geometry.boundingBox.getSize(new Vector3()).length() : 0;
  const points = new Points(
    geometry,
    new PointsMaterial({
      size: extent > 0 ? extent * POINT_SIZE_FRACTION : 0.01,
      sizeAttenuation: true,
      color: hasOwnColors ? 0xffffff : materialColor,
      vertexColors: hasOwnColors,
    }),
  );
  points.userData.tdcbThemedMaterial = !hasOwnColors;
  return points;
}

function loadPly(buffer: ArrayBuffer, materialColor: string): Object3D {
  const geometry = new PLYLoader().parse(buffer);
  return geometry.getIndex() === null ? pointsFrom(geometry, materialColor) : meshFrom(geometry, materialColor);
}

/** 1x1 transparentes GIF: Ersatz fuer jede Referenz, die ein OBJ/MTL ins Netz schicken wuerde. */
const BLOCKED_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/** `resolveUrl` fuer OBJ/MTL: was kein Vault-Treffer ist und ein Schema traegt (http, https, file, blob, `//host`), wird nie geladen — three bekaeme
 *  sonst die unveraenderte URL zurueck und fragte das Netz (`map_Kd https://…` in einer fremden MTL). `data:` bleibt (eingebettet, kein Netz).
 *  Dieselbe Strenge wie bei glTF mit ausgeschalteter Einstellung „Allow external resources“; OBJ kennt die Einstellung nicht und laedt nie extern. */
function noNetwork(resolveUrl: (uri: string) => string): (uri: string) => string {
  return (uri) => {
    const resolved = resolveUrl(uri);
    const t = uri.trim();
    return resolved === uri && /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(t) && !/^data:/i.test(t) ? BLOCKED_PIXEL : resolved;
  };
}

/** OBJ, mit seiner MTL, wenn sie neben der Datei liegt (`mtllib`). Ohne MTL (oder wenn sie fehlt) bekommt das Modell das Theme-Material wie STL.
 *  Texturnamen der MTL bleiben unaufgeloest roh stehen und laufen ueber `resolveUrl` (Sicherheitsurteil in `core/gltf-uri.ts`, dieselbe Regel wie
 *  bei glTF); darum `parse(text, "")` statt `load(url)`: `load` haengte die Basis-URL der MTL davor, und `classifyUri` sahe eine Fern-URL. */
async function loadObj(buffer: ArrayBuffer, materialColor: string, resolveUrl?: (uri: string) => string): Promise<Object3D> {
  const text = decodeText(buffer);
  const plain = new OBJLoader().parse(text);
  const library = (plain as unknown as { materialLibraries?: string[] }).materialLibraries?.[0];
  if (library && resolveUrl) {
    const url = resolveUrl(library);
    // `resolveUrl` gibt eine unveraenderte URI zurueck, wenn die Datei fehlt oder abgelehnt wurde: dann bleibt es beim Theme-Material.
    if (url !== library) {
      try {
        const manager = new LoadingManager();
        manager.setURLModifier(noNetwork(resolveUrl));
        const mtlText = (await new FileLoader(manager).loadAsync(url)) as string;
        const creator = new MTLLoader(manager).parse(mtlText, "");
        creator.preload();
        return new OBJLoader().setMaterials(creator).parse(text);
      } catch {
        // kaputte MTL: das Modell bleibt sichtbar, im Theme-Material
      }
    }
  }
  plain.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry as BufferGeometry;
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    child.material = new MeshStandardMaterial({ color: materialColor, roughness: 0.85, metalness: 0 });
    child.userData.tdcbThemedMaterial = true;
  });
  return plain;
}
