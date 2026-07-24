// Embed-`src` zerlegen: `datei.gltf|400` → Pfad + optionale Höhe. Pure.
//
// Obsidian legt bei `![[datei|X]]` den Teil nach `|` als alt/width ab. Wir nutzen
// eine reine Zahl als Viewport-Höhe; alles andere wird ignoriert.

export interface EmbedSrc {
  path: string;
  height?: number;
}

export function parseEmbedSrc(src: string): EmbedSrc {
  const pipe = src.indexOf("|");
  if (pipe === -1) return { path: src.trim() };

  const path = src.slice(0, pipe).trim();
  const rest = src.slice(pipe + 1).trim();
  const height = Number(rest);

  return Number.isFinite(height) && height > 0 ? { path, height } : { path };
}
