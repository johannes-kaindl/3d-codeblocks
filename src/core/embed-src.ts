// Höhe aus dem alt-Text eines Embeds lesen. Pure.
//
// Obsidian legt bei `![[datei.gltf|300]]` den Teil nach `|` als alt-Text ab. Eine
// reine Zahl darin nutzen wir als Viewport-Höhe; alles andere ignorieren wir. Das
// Datei-Matching selbst übernimmt `embedRegistry.registerExtension` (nach Endung),
// nicht mehr eigener Code.

export function heightFromAlt(alt: string | null | undefined): number | undefined {
  if (!alt) return undefined;
  // Der alt kann "300" sein oder — je nach Obsidian-Version — "datei.gltf|300".
  const tail = alt.includes("|") ? alt.slice(alt.lastIndexOf("|") + 1) : alt;
  const height = Number(tail.trim());
  return Number.isFinite(height) && height > 0 ? height : undefined;
}
