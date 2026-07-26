// Wohin speichert der Editor? Pure. Das "nie in-place"-Verbot des Kontrakts schuetzt
// Originale (der Generator ueberschreibt sie); eine .edit.-Datei ist bereits User-Edit
// und wird deshalb in-place fortgeschrieben.

export interface EditTarget {
  path: string;
  inPlace: boolean;
}

export type EditFormat = "gltf-json" | "glb";

export function editFormatFor(path: string): EditFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".gltf")) return "gltf-json";
  if (lower.endsWith(".glb")) return "glb";
  return null;
}

export function editTargetPath(path: string): EditTarget | null {
  const match = path.match(/^(.*)\.(gltf|glb)$/i);
  if (!match) return null;
  const [, stem, ext] = match;
  if (stem.toLowerCase().endsWith(".edit")) return { path, inPlace: true };
  return { path: `${stem}.edit.${ext}`, inPlace: false };
}
