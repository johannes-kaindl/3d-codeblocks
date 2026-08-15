/** Typen fuer den Fixture-Generator. Er bleibt bewusst .mjs, damit `node` ihn ohne
 *  Build-Schritt ausfuehren kann — der Vault-Aufbau soll nicht von esbuild abhaengen. */

/** glTF-2.0-Dokument des Demo-Erdgeschosses, mit eingebettetem Puffer (data-URI). */
export declare function groundFloorGltf(): Record<string, unknown>;

/** ASCII-STL eines Oktaeders — das Format kennt keine Materialien. */
export declare function octahedronStl(): string;

/** glTF mit einem verschobenen Knoten — erzeugt das „Unapplied edits"-Abzeichen. */
export declare function groundFloorEditGltf(): Record<string, unknown>;

/** Schreibt die Modelle nach `<target>/models/` und liefert die Pfade. */
export declare function writeModels(target: string): string[];
