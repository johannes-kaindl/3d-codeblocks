/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian, statt die Bilder von Hand zu klicken.
 *
 * Warum getrackt: ein Werkzeug, das nur einmal im Scratchpad existiert, ist keine Praxis.
 * Dieselbe Begruendung wie bei `scripts/gui-smoke.ts`, mit dem sich dieser Treiber die
 * CDP-Bruecke teilt (`scripts/lib/cdp.ts`) — deshalb liegt sie dort und nicht hier.
 *
 * ## Ablauf
 *
 * ```bash
 * export STAGING_VAULTS_DIR="$HOME/StagingVaults"   # einmalig
 * npm run build && npm run shots -- --setup         # Vault aus dem Fixture bauen
 *
 * osascript -e 'quit app "Obsidian"'                # Handarbeit: Debug-Port
 * open -a Obsidian --args --remote-debugging-port=9222
 * #   ... den Aufnahme-Vault oeffnen und einmalig als vertrauenswuerdig markieren
 *
 * npm run shots                                     # alles aufnehmen
 * npm run shots -- --only hero.png                  # ein Bild nachziehen
 * npm run shots -- --list                           # Vertrag anzeigen
 * ```
 *
 * ## Fallstricke, die Zeit kosten, wenn man sie nicht kennt
 *
 * 1. **Chromium drosselt nicht-fokussierte Fenster.** Ohne `Page.bringToFront` bleibt der
 *    Viewport leer und man debuggt ein Phantom. `capture()` macht es deshalb selbst.
 * 2. **Die Einstellungen sind ein EIGENES Fenster** mit URL `about:blank` — ein
 *    Target-Filter auf `app://obsidian.md` findet sie nicht.
 * 3. **Bloecke starten als Standbild** (Einstellung „How 3D blocks behave when a note
 *    opens"). Ein Bild vom Standbild zeigt nicht das Plugin, sondern ein Poster.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import {
  Cdp,
  closeExtraLeaves,
  openNote,
  pollUntil,
  setPluginSetting,
} from "./lib/cdp.js";
import {
  boxAround,
  boxOf,
  capture,
  framesToGif,
  withMetrics,
  writeShot,
  type Rect,
} from "./lib/shot.js";
import { buildVault, stagingVaultDir } from "./lib/vault.js";

const PLUGIN_ID = "three-d-codeblocks";
const REPO_NAME = "3d-codeblocks";
const OUT_DIR = "docs/images";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const PADDING = 20;

// --- Rezept ------------------------------------------------------------------

interface Shot {
  name: string;
  /** Klasse nach dem Bild-Standard — steuert, ob ein Vorschaubild entsteht. */
  klasse: "hero" | "feature" | "detail";
  /** Stellt den Zustand her und liefert den Bildausschnitt (null = nicht aufnehmbar). */
  run(cdp: Cdp): Promise<Rect | null>;
}

/** Notiz oeffnen, Block wecken, warten bis wirklich ein Bild steht.
 *  Die zwei Wartepunkte sind beide load-bearing: der erste auf das DOM, der zweite auf
 *  den ersten gezeichneten Frame. Ohne den zweiten fotografiert man ein leeres Canvas. */
async function blockBereit(cdp: Cdp, notiz: string, index = 0): Promise<boolean> {
  await closeExtraLeaves(cdp);
  await openNote(cdp, notiz, "", "preview");
  const da = await pollUntil<boolean>(cdp, `
    return document.querySelectorAll(".tdcb-block").length > ${index};
  `, 15_000, 300);
  if (!da) return false;
  // Standbild wecken, falls die Einstellung Bloecke passiv starten laesst
  await cdp.evaluate(`
    const block = document.querySelectorAll(".tdcb-block")[${index}];
    const play = block?.querySelector(".tdcb-play");
    if (play) play.click();
    return true;
  `);
  const gezeichnet = await pollUntil<boolean>(cdp, `
    const block = document.querySelectorAll(".tdcb-block")[${index}];
    const canvas = block?.querySelector("canvas");
    return !!(canvas && canvas.width > 0 && canvas.height > 0);
  `, 20_000, 300);
  return Boolean(gezeichnet);
}

/** Maus ueber ein Element bewegen — die Werkzeugleiste erscheint nur bei Hover, und ein
 *  synthetisches `mouseover` reicht dafuer nicht: Obsidian und das Plugin hoeren auf
 *  echte Zeiger-Ereignisse. */
async function hover(cdp: Cdp, box: Rect): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  });
  await new Promise((r) => setTimeout(r, 600));
}

/** Notiz in zwei Blaettern nebeneinander: links Quelltext, rechts Rendering. Fuer die
 *  Bilder, deren Aussage „so schreibt man es, so sieht es aus" lautet. */
async function splitQuelleUndBild(cdp: Cdp, notiz: string): Promise<boolean> {
  await closeExtraLeaves(cdp);
  await openNote(cdp, notiz, "", "source");
  const ok = await cdp.evaluate<boolean>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notiz)});
    const leaf = app.workspace.getLeaf("split", "vertical");
    await leaf.openFile(file, { state: { mode: "preview" } });
    await new Promise((r) => setTimeout(r, 800));
    return true;
  `);
  if (!ok) return false;
  return Boolean(await pollUntil<boolean>(cdp, `
    const canvas = document.querySelector(".tdcb-block canvas");
    return !!(canvas && canvas.width > 0);
  `, 20_000, 300));
}

const SHOTS: Shot[] = [
  {
    name: "hero.png",
    klasse: "hero",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "code-and-render.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await splitQuelleUndBild(cdp, "Ground-floor.md"))) return null;
      return boxOf(cdp, ".workspace-split.mod-root", 0);
    },
  },
  {
    name: "hover-toolbar.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      const block = await boxOf(cdp, ".tdcb-block");
      if (!block) return null;
      await hover(cdp, block);
      const sichtbar = await cdp.evaluate<boolean>(`
        const t = document.querySelector(".tdcb-toolbar");
        return !!(t && !t.classList.contains("tdcb-hidden"));
      `);
      if (!sichtbar) return null;
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "sidebar-controls.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      const block = await boxOf(cdp, ".tdcb-block");
      if (block) await hover(cdp, block);
      await cdp.evaluate(
        `await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)}); return true;`,
      );
      const gefuellt = await pollUntil<boolean>(cdp, `
        const panel = document.querySelector(".tdcb-panel");
        return !!(panel && !panel.querySelector(".tdcb-empty"));
      `, 10_000, 300);
      if (!gefuellt) return null;
      return boxAround(cdp, [".tdcb-block", ".tdcb-panel"], PADDING);
    },
  },
  {
    name: "saved-view.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await splitQuelleUndBild(cdp, "Saved-view.md"))) return null;
      return boxOf(cdp, ".workspace-split.mod-root", 0);
    },
  },
  {
    name: "unknown-key.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Unknown-key.md"))) return null;
      const meldung = await cdp.evaluate<boolean>(`
        const slot = document.querySelector(".tdcb-message-slot");
        return !!(slot && slot.textContent.trim());
      `);
      if (!meldung) return null;
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "edit-mode.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      const block = await boxOf(cdp, ".tdcb-block");
      if (block) await hover(cdp, block);
      await cdp.evaluate(
        `await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open-controls`)}); return true;`,
      );
      const gestartet = await cdp.evaluate<boolean>(`
        const knopf = [...document.querySelectorAll(".tdcb-toolbar-button, button")]
          .find((b) => (b.getAttribute("aria-label") ?? b.title ?? b.textContent ?? "")
            .includes("Edit model"));
        if (!knopf) return false;
        knopf.click();
        await new Promise((r) => setTimeout(r, 900));
        return document.querySelector(".tdcb-editing") !== null
          || document.querySelector(".tdcb-panel-edit") !== null;
      `);
      if (!gestartet) return null;
      return boxAround(cdp, [".tdcb-block", ".tdcb-panel"], PADDING);
    },
  },
  {
    name: "unapplied-edits.png",
    klasse: "detail",
    async run(cdp) {
      const da = await pollUntil<boolean>(cdp, `
        return document.querySelector(".tdcb-badge") !== null;
      `, 5_000, 300);
      if (!da) return null;
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "settings.png",
    klasse: "detail",
    async run(cdp) {
      await cdp.evaluate(`
        app.setting.open();
        app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
        await new Promise((r) => setTimeout(r, 700));
        return true;
      `);
      return boxOf(cdp, ".vertical-tab-content", 0);
    },
  },
];

// --- Bewegtbild ---------------------------------------------------------------

/** Eine Umkreisung als Einzelbilder, danach von ffmpeg montiert. Nur dieses eine Bild
 *  ist bewegt: der Standard erlaubt GIF dort, wo Bewegung die Aussage IST. */
async function orbitGif(cdp: Cdp, outDir: string): Promise<string> {
  if (!(await blockBereit(cdp, "Ground-floor.md"))) return "orbit.gif — Block wurde nicht bereit";
  const box = await boxOf(cdp, ".tdcb-viewport") ?? await boxOf(cdp, ".tdcb-block");
  if (!box) return "orbit.gif — kein Viewport gefunden";

  const frameDir = join(outDir, ".orbit-frames");
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  const SCHRITTE = 72;
  for (let i = 0; i < SCHRITTE; i++) {
    const azimut = Math.round((i / SCHRITTE) * 360);
    const distanz = 14 + Math.sin((i / SCHRITTE) * Math.PI * 2) * 3;
    const gesetzt = await cdp.evaluate<boolean>(`
      const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
      const view = controller?.getView?.();
      if (!controller?.applyView) return false;
      controller.applyView({ azimuth: ${azimut}, elevation: 24, distance: ${distanz.toFixed(1)} });
      await new Promise((r) => setTimeout(r, 40));
      return true;
    `);
    if (!gesetzt) return "orbit.gif — der aktive Controller nimmt kein applyView entgegen";
    const png = await capture(cdp, box);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(frameDir, `frame-${String(i + 1).padStart(3, "0")}.png`), png);
  }
  const ergebnis = framesToGif(frameDir, join(outDir, "orbit.gif"), { fps: 14, width: 800 });
  rmSync(frameDir, { recursive: true, force: true });
  return ergebnis;
}

// --- Lauf ---------------------------------------------------------------------

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  // cwd, nicht import.meta.url: der Treiber wird vor dem Lauf nach `.shots.mjs`
  // ins Repo-Root gebundelt — ein Pfad relativ zur Modul-URL zeigte dann daneben.
  const repoRoot = cwd();
  const outDir = join(repoRoot, OUT_DIR);

  if (argv.includes("--list")) {
    for (const s of SHOTS) console.log(`  ${s.klasse.padEnd(8)} ${s.name}`);
    console.log(`  feature  orbit.gif`);
    return;
  }

  if (argv.includes("--setup")) {
    const vaultDir = stagingVaultDir(REPO_NAME);
    console.log(`Aufnahme-Vault: ${vaultDir}`);
    for (const zeile of buildVault({
      repoRoot,
      vaultDir,
      fixtureDir: join(repoRoot, "docs/images/fixture"),
      pluginId: PLUGIN_ID,
    })) {
      console.log(`  ${zeile}`);
    }
    console.log(
      "\nJetzt Obsidian mit offenem Debug-Port starten und diesen Vault oeffnen:\n" +
      "  osascript -e 'quit app \"Obsidian\"'\n" +
      "  open -a Obsidian --args --remote-debugging-port=9222\n" +
      "Beim ersten Mal fragt Obsidian, ob es dem Vault-Autor vertraut — bestaetigen,\n" +
      "sonst laeuft das Plugin nicht und jedes Bild zeigt einen rohen Codeblock.",
    );
    return;
  }

  const port = Number(flag("--port") ?? env.SHOTS_PORT ?? 9222);
  const nur = flag("--only");

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const cdp = await Cdp.attach(port);
  console.log(`Verbunden auf Port ${port}.\n`);

  // Bloecke sollen sofort interaktiv sein — ein Bild vom Standbild zeigt ein Poster,
  // nicht das Plugin.
  await setPluginSetting(cdp, PLUGIN_ID, "blockStart", "interactive");

  let ok = 0;
  let fehlend = 0;
  for (const shot of SHOTS) {
    if (nur && shot.name !== nur) continue;
    try {
      const box = await shot.run(cdp);
      if (!box) {
        console.log(`  ✗ ${shot.name} — Zustand kam nicht zustande`);
        fehlend++;
        continue;
      }
      const png = await withMetrics(cdp, 1440, Math.max(900, Math.ceil(box.height) + 120),
        () => capture(cdp, box));
      console.log(`  ✓ ${await writeShot(cdp, shot.name, png, {
        outDir,
        captureWidth: CAPTURE_WIDTH,
        thumbWidth: THUMB_WIDTH,
        thumb: shot.klasse === "detail",
      })}`);
      ok++;
    } catch (err) {
      console.log(`  ✗ ${shot.name} — ${(err as Error).message}`);
      fehlend++;
    }
  }

  if (!nur || nur === "orbit.gif") {
    console.log(`  · ${await orbitGif(cdp, outDir)}`);
  }

  cdp.close();
  console.log(`\n${ok} Bild(er) geschrieben, ${fehlend} offen.`);
  if (fehlend) exit(1);
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
