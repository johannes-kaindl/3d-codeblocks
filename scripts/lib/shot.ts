/**
 * Aufnahme-Primitive fuer die README-Bilder — die pluginneutrale Haelfte von
 * `scripts/shots.ts`.
 *
 * Alles hier gilt fuer jedes Obsidian-Plugin: Bildausschnitt bestimmen, aufnehmen,
 * skalieren, Vorschaubild erzeugen, schreiben. Was WELCHES Bild zeigt und wie der
 * Zustand dafuer entsteht, bleibt im Rezept.
 *
 * ## Zwei Entscheidungen, die Erklaerung brauchen
 *
 * **Skaliert wird im Renderer, nicht mit einer Bildbibliothek.** Das Bild liegt nach dem
 * Screenshot ohnehin als Base64 vor; es durch ein Canvas zu schicken kostet nichts,
 * bringt aber weder eine Dependency noch eine Plattform-Annahme ins Repo. `sips` waere
 * macOS-only, `sharp` eine native Abhaengigkeit fuer ein Skript, das ein Mensch dreimal
 * im Jahr laufen laesst.
 *
 * **Fuer zu hohe Inhalte wird das Fenster simuliert, nicht gestueckelt.** Zusammensetzen
 * erzeugt Nahtfehler an genau den Stellen, an denen der Leser hinsieht.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Cdp } from "./cdp.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding-Box des ersten Treffers, in CSS-Pixeln, optional mit Rand. */
export async function boxOf(cdp: Cdp, selector: string, padding = 0): Promise<Rect | null> {
  const raw = await cdp.evaluate<string | null>(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
  `);
  if (!raw) return null;
  const r = JSON.parse(raw) as Rect;
  return {
    x: Math.max(0, r.x - padding),
    y: Math.max(0, r.y - padding),
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  };
}

/** Box, die mehrere Elemente umschliesst — fuer Bilder, deren Aussage aus zwei Teilen
 *  besteht (Quelltext UND Rendering). Fehlt eines, ist das Ergebnis null: ein halbes
 *  Bild waere schlimmer als keines, weil es aussaehe, als sei es so gemeint. */
export async function boxAround(
  cdp: Cdp,
  selectors: string[],
  padding = 0,
): Promise<Rect | null> {
  const boxes: Rect[] = [];
  for (const sel of selectors) {
    const b = await boxOf(cdp, sel);
    if (!b) return null;
    boxes.push(b);
  }
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return {
    x: Math.max(0, x - padding),
    y: Math.max(0, y - padding),
    width: right - x + padding * 2,
    height: bottom - y + padding * 2,
  };
}

/** Screenshot des Fensters oder eines Ausschnitts. */
export async function capture(cdp: Cdp, clip?: Rect): Promise<Buffer> {
  await cdp.send("Page.bringToFront");
  const params: Record<string, unknown> = { format: "png", captureBeyondViewport: true };
  if (clip) params.clip = { ...clip, scale: 1 };
  const res = await cdp.send("Page.captureScreenshot", params);
  const data = (res.result as { data?: string } | undefined)?.data;
  if (!data) throw new Error("Page.captureScreenshot lieferte kein Bild");
  return Buffer.from(data, "base64");
}

/** Fenstermasse simulieren, `fn` ausfuehren, Simulation sicher wieder aufheben. */
export async function withMetrics<T>(
  cdp: Cdp,
  width: number,
  height: number,
  fn: () => Promise<T>,
): Promise<T> {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    return await fn();
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  }
}

/** PNG auf eine Zielbreite bringen — im Renderer per Canvas, ohne Bildbibliothek.
 *  Ist das Bild bereits schmaler, bleibt es unveraendert: hochskalieren macht ein
 *  scharfes Bild unscharf und ein kleines nicht groesser. */
export async function scaleTo(cdp: Cdp, png: Buffer, width: number): Promise<Buffer> {
  const b64 = png.toString("base64");
  const out = await cdp.evaluate<string>(`
    const img = new Image();
    img.src = "data:image/png;base64," + ${JSON.stringify(b64)};
    await img.decode();
    if (img.naturalWidth <= ${width}) return "";
    const h = Math.round(img.naturalHeight * ${width} / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = ${width};
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, ${width}, h);
    return canvas.toDataURL("image/png").split(",")[1];
  `);
  return out ? Buffer.from(out, "base64") : png;
}

export interface ShotOptions {
  outDir: string;
  captureWidth: number;
  thumbWidth: number;
  /** Vorschaubild erzeugen? Nur `detail`-Bilder brauchen eines. */
  thumb?: boolean;
}

/** Bild (und bei Bedarf sein Vorschaubild) schreiben; meldet die Groesse zurueck. */
export async function writeShot(
  cdp: Cdp,
  name: string,
  png: Buffer,
  opts: ShotOptions,
): Promise<string> {
  const full = await scaleTo(cdp, png, opts.captureWidth);
  const path = join(opts.outDir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, full);
  let hinweis = `${name} — ${Math.round(full.length / 1024)} KB`;
  if (opts.thumb) {
    const small = await scaleTo(cdp, full, opts.thumbWidth);
    const thumbPath = join(opts.outDir, "thumbs", name);
    mkdirSync(dirname(thumbPath), { recursive: true });
    writeFileSync(thumbPath, small);
    hinweis += ` (+ Vorschau ${Math.round(small.length / 1024)} KB)`;
  }
  return hinweis;
}

/** Einzelbilder zu einem GIF montieren. Braucht ffmpeg — fehlt es, ist das kein
 *  Abbruchgrund: neun von zehn Bildern sind PNG, und ein eigener LZW-Encoder waere
 *  hundertfuenfzig Zeilen fuer ein Bild. */
export function framesToGif(
  frameDir: string,
  outPath: string,
  { fps = 12, width = 800 }: { fps?: number; width?: number } = {},
): string {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
      "-framerate", String(fps), "-i", join(frameDir, "frame-%03d.png"),
      "-vf", `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
      outPath]);
    return `${outPath} erzeugt`;
  } catch {
    return `ffmpeg fehlt oder scheiterte — Einzelbilder liegen in ${frameDir}`;
  }
}
