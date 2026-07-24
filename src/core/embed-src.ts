// Embed-Dimension aus den Attributen des `.internal-embed`-Spans lesen. Pure.
//
// Verifiziert per Diagnose (2026-07-24): Obsidian legt `![[x|N]]` als `width="N"` ab
// und `![[x|WxH]]` als `width="W" height="H"`. `alt`/`linktext` tragen nur den Pfad.
// Für einen vollbreiten 3D-Viewport ist die Höhe das sinnvolle Maß: eine explizite
// Höhe bevorzugen, sonst die einzelne |N-Zahl (die in `width` landet) als Höhe nehmen.

export function embedHeightFromAttrs(
  widthAttr: string | null,
  heightAttr: string | null,
): number | undefined {
  const height = Number(heightAttr);
  if (Number.isFinite(height) && height > 0) return height;

  const width = Number(widthAttr);
  if (Number.isFinite(width) && width > 0) return width;

  return undefined;
}
