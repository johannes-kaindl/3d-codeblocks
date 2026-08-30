/**
 * Jedes glTF-Beispiel im Guide muss durch den ECHTEN Loader des Prueflings gehen.
 *
 * Doku verrottet leise: ein Beispiel, das seit einem Jahr nicht mehr laedt, sieht auf der
 * Seite genauso aus wie eines, das laedt. Dieser Test ist der Unterschied zwischen einem
 * Tutorial und einem Versprechen.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Object3D } from "three";
import { loadModel } from "../src/viewer/loaders";

const GUIDE_DIR = "docs/guide";

/**
 * ```gltf-Bloecke aus einer Markdown-Datei, mit Zeilennummer fuer die Fehlermeldung.
 *
 * Bloecke INNERHALB eines ````-Fences bleiben aussen vor: die zeigen, wie man einen Block
 * schreibt, und duerfen deshalb absichtlich unvollstaendig sein. Ein Beispiel, das
 * gerendert werden will, steht nie in einem solchen Fence.
 */
function gltfBlocks(markdown: string): { code: string; line: number }[] {
  const found: { code: string; line: number }[] = [];
  const lines = markdown.split("\n");
  let inShowcase = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("````")) {
      inShowcase = !inShowcase;
      continue;
    }
    if (inShowcase) continue;
    if (lines[i].trim() !== "```gltf") continue;
    const start = i + 1;
    const end = lines.indexOf("```", start);
    expect(end, `unclosed gltf block at line ${start}`).toBeGreaterThan(-1);
    found.push({ code: lines.slice(start, end).join("\n"), line: start });
    i = end;
  }
  return found;
}

const files = readdirSync(GUIDE_DIR).filter((f) => f.endsWith(".md"));

describe("guide examples", () => {
  it("the guide exists and carries examples", () => {
    expect(files.length).toBeGreaterThan(0);
    const total = files
      .map((f) => gltfBlocks(readFileSync(join(GUIDE_DIR, f), "utf8")).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  for (const file of files) {
    const blocks = gltfBlocks(readFileSync(join(GUIDE_DIR, file), "utf8"));

    for (const { code, line } of blocks) {
      it(`${file}:${line} is valid glTF the plugin can render`, async () => {
        expect(() => JSON.parse(code) as unknown, "not valid JSON").not.toThrow();

        const bytes = new TextEncoder().encode(code).buffer as ArrayBuffer;
        const scene = (await loadModel(bytes, "gltf", "#888888")) as Object3D;

        // Ein Beispiel, das nichts in die Szene stellt, lehrt nichts.
        expect(scene.children.length).toBeGreaterThan(0);
      });
    }
  }
});
