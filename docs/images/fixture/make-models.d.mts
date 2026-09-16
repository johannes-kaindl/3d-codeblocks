/** Typen fuer den Fixture-Generator. Er bleibt bewusst .mjs, damit `node` ihn ohne
 *  Build-Schritt ausfuehren kann — der Vault-Aufbau soll nicht von esbuild abhaengen. */

/** glTF-2.0-Dokument des Demo-Erdgeschosses, mit eingebettetem Puffer (data-URI). */
export declare function groundFloorGltf(): Record<string, unknown>;

/** ASCII-STL eines Oktaeders — das Format kennt keine Materialien. */
export declare function octahedronStl(): string;

/** Dasselbe Oktaeder als BINAERES STL im "Magics"-Farbformat — jede Facette traegt
 *  ihre eigene Farbe. Der Prueffall fuer "STL files that carry their own colours". */
export declare function colouredOctahedronStl(): ArrayBuffer;

/** Ein einzelner metallischer Wuerfel (`metallicFactor: 1`) — der Prueffall fuer
 *  "Metallic models are no longer black" (Lighting-Einstellung). */
export declare function metallicOrbGltf(): Record<string, unknown>;

/** glTF mit einem verschobenen Knoten — erzeugt das „Unapplied edits"-Abzeichen. */
export declare function groundFloorEditGltf(): Record<string, unknown>;

/** Schreibt die Modelle nach `<target>/models/` und liefert die Pfade. */
export declare function writeModels(target: string): string[];

/** Dasselbe Erdgeschoss mit ausgelagerter Geometrie: `.gltf` + `.bin` daneben — die Form
 *  jedes Blender-Exports. Ohne aufloesenden Resolver muss das Laden scheitern. */
export declare function splitGroundFloor(): {
  gltf: { buffers: { uri: string; byteLength: number }[] } & Record<string, unknown>;
  bin: Uint8Array;
};

/** Knoten und Kameras des Kamera-Fixtures — genauer typisiert als die uebrigen
 *  Generatoren, weil der GUI-Smoke-Abschnitt `cameras` und sein Waechter-Test
 *  (`tests/fixture-models.test.ts`) genau diese beiden Listen auslesen. */
export interface CameraFixtureDoc {
  nodes: { name?: string; camera?: number; translation?: number[]; rotation?: number[] }[];
  cameras: { type: string; name?: string }[];
  [key: string]: unknown;
}

/** Das Demo-Erdgeschoss mit fuenf Kamera-Knoten: `Front`, `Schnitt A` (mit Leerzeichen),
 *  `Doppel` zweimal und `Plan` (orthographisch) — das Pruefmaterial fuer
 *  `view: camera:<name>`. */
export declare function cameraFloorGltf(): CameraFixtureDoc;
