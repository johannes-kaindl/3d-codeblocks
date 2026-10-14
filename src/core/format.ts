// Dateiendung → Format. Pure.

export type ModelFormat = "gltf" | "stl" | "shapes" | "3mf" | "obj" | "ply" | "gcode" | "xyz" | "pcd";

export const SUPPORTED_EXTENSIONS = [".glb", ".gltf", ".stl", ".3mf", ".obj", ".ply", ".gcode", ".xyz", ".pcd", ".shapes"] as const;

/** Endungen ohne Punkt, wie Obsidians `registerExtensions` sie will (ohne `.shapes`: das hat eine eigene Dateiansicht). */
export const MODEL_FILE_EXTENSIONS = ["gltf", "glb", "stl", "3mf", "obj", "ply", "gcode", "xyz", "pcd"] as const;

const BY_EXTENSION: Record<string, ModelFormat> = {
  ".glb": "gltf",
  ".gltf": "gltf",
  ".stl": "stl",
  ".3mf": "3mf",
  ".obj": "obj",
  ".ply": "ply",
  ".gcode": "gcode",
  ".xyz": "xyz",
  ".pcd": "pcd",
  ".shapes": "shapes",
};

export function detectFormat(path: string): ModelFormat | null {
  // Erst den Dateinamen isolieren — sonst gilt der Punkt in `v1.0/model` als Endung.
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;

  return BY_EXTENSION[name.slice(dot).toLowerCase()] ?? null;
}
