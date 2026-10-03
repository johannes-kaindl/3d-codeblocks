// Dateiendung → Format. Pure.

export type ModelFormat = "gltf" | "stl" | "shapes";

export const SUPPORTED_EXTENSIONS = [".glb", ".gltf", ".stl", ".shapes"] as const;

const BY_EXTENSION: Record<string, ModelFormat> = {
  ".glb": "gltf",
  ".gltf": "gltf",
  ".stl": "stl",
  ".shapes": "shapes",
};

export function detectFormat(path: string): ModelFormat | null {
  // Erst den Dateinamen isolieren — sonst gilt der Punkt in `v1.0/model` als Endung.
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;

  return BY_EXTENSION[name.slice(dot).toLowerCase()] ?? null;
}
