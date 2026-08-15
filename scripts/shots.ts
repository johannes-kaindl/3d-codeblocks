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

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import {
  attachTo,
  Cdp,
  closeExtraLeaves,
  openExisting,
  setAppConfig,
  pollUntil,
  setPluginSetting,
} from "./lib/cdp.js";
import {
  boxAround,
  boxOf,
  capture,
  framesToGif,
  setWindowSize,
  writeShot,
  type Rect,
} from "./lib/shot.js";
import { buildVault, stagingVaultDir } from "./lib/vault.js";

const PLUGIN_ID = "three-d-codeblocks";
const REPO_NAME = "3d-codeblocks";
const OUT_DIR = "docs/images";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const PADDING = 12;
const FENSTER_BREITE = 1440;
const FENSTER_HOEHE = 900;

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
  await cdp.send("Page.bringToFront");
  await closeExtraLeaves(cdp);
  if (!(await openExisting(cdp, notiz, "preview"))) {
    console.log(`      · ${notiz} liess sich nicht oeffnen (Datei im Vault?)`);
    return false;
  }

  // SICHTBARE Bloecke, nicht alle: Obsidian haelt die Inhalte geschlossener Blaetter im
  // DOM. `querySelectorAll(".tdcb-block")[0]` traf dort ein 0x0-Element, und jeder
  // Wartelauf lief in seinen Timeout — die Meldung lautete dann "Zustand kam nicht
  // zustande", obwohl der echte Block daneben fertig gerendert stand.
  const sichtbar = `[...document.querySelectorAll(".tdcb-block")]
      .filter((e) => e.getBoundingClientRect().width > 1)`;

  const da = await pollUntil<boolean>(cdp, `
    return ${sichtbar}.length > ${index};
  `, 15_000, 300);
  if (!da) {
    // Diagnose mitgeben statt nur "kam nicht zustande": diese eine Zeile haette am
    // 2026-08-15 mehrere Stunden Rateschleife erspart.
    const lage = await cdp.evaluate<string>(`
      return JSON.stringify({
        vault: app.vault.getName(),
        datei: app.workspace.getActiveFile()?.path ?? null,
        bloeckeGesamt: document.querySelectorAll(".tdcb-block").length,
        roheCodebloecke: document.querySelectorAll("pre > code").length,
        leseflaeche: (document.querySelector(".markdown-reading-view")?.textContent ?? "").length,
        pluginAn: !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}],
      });
    `);
    console.log(`      · kein sichtbarer Block — ${lage}`);
    return false;
  }

  // Standbild wecken. Der Klick ist nicht optional: er ist der einzige Weg, ueber den
  // sich der Controller registriert (siehe Kommentar in main()).
  //
  // Erst auf die Klickflaeche WARTEN. Obsidian rendert den Block asynchron; ein
  // sofortiges querySelectorAll findet nichts, der Klick geht ins Leere, und der
  // Fehlschlag sieht aus wie "Modell laedt nicht". Dasselbe Verfahren steht in
  // scripts/gui-smoke.ts (activateBlock) — ich habe es beim Bauen uebersehen.
  const geweckt = await pollUntil<boolean>(cdp, `
    const play = [...document.querySelectorAll(".tdcb-play")]
      .filter((e) => e.getBoundingClientRect().width > 1);
    if (play.length <= ${index}) return false;
    play[${index}].click();
    return true;
  `, 12_000, 300);
  if (!geweckt) console.log("      · kein Standbild-Overlay zum Anklicken gefunden");

  const gezeichnet = await pollUntil<boolean>(cdp, `
    const block = ${sichtbar}[${index}];
    const canvas = block?.querySelector("canvas");
    return !!(canvas && canvas.width > 0 && canvas.height > 0);
  `, 20_000, 300);
  if (!gezeichnet) console.log("      · Block da, aber kein gezeichnetes Canvas");
  return Boolean(gezeichnet);
}

/** Wartet, bis der Prueflings-Controller registriert ist — Voraussetzung fuer Kamera,
 *  Sidebar-Panel und Edit-Modus. */
async function controllerBereit(cdp: Cdp): Promise<boolean> {
  return Boolean(await pollUntil<boolean>(cdp, `
    const c = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    return !!(c && c.getView());
  `, 10_000, 300));
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
  // Live Preview aus: sonst rendert Obsidian den Codeblock AUCH im Quelltext-Blatt, und
  // das Bild zeigt zweimal dasselbe Modell statt "so schreibt man es / so sieht es aus".
  await setAppConfig(cdp, "livePreview", false);
  if (!(await openExisting(cdp, notiz, "source"))) return false;
  const ok = await cdp.evaluate<boolean>(`
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notiz)});
    const leaf = app.workspace.getLeaf("split", "vertical");
    await leaf.openFile(file, { state: { mode: "preview" } });
    await new Promise((r) => setTimeout(r, 900));
    return true;
  `);
  if (!ok) return false;
  // Standbild wecken — auch hier der einzige Weg zu einem gerenderten Modell.
  await cdp.evaluate(`
    const play = [...document.querySelectorAll(".tdcb-play")]
      .filter((e) => e.getBoundingClientRect().width > 1)[0];
    if (play) play.click();
    return true;
  `);
  return Boolean(await pollUntil<boolean>(cdp, `
    const canvas = [...document.querySelectorAll(".tdcb-block canvas")]
      .find((e) => e.getBoundingClientRect().width > 1);
    return !!(canvas && canvas.width > 0);
  `, 20_000, 300));
}

/** Den Block aktiv machen und die Kamera einpassen.
 *
 * Beides ist noetig, bevor ein Bild etwas taugt: ohne Aktivierung liefert
 * `active.get()` keinen Controller (dann greift kein `applyView`), und ohne Einpassen
 * steht das Modell als Briefmarke in einem grossen Viewport — technisch korrekt und als
 * Bild wertlos.
 */
async function blickwinkel(cdp: Cdp, azimut: number, elevation: number): Promise<boolean> {
  if (!(await controllerBereit(cdp))) return false;
  return Boolean(await cdp.evaluate<boolean>(`
    const c = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    c.applyView(null);                       // erst einpassen — liefert die Distanz
    await new Promise((r) => setTimeout(r, 300));
    const auto = c.getView();
    if (!auto) return false;
    // Naeher als die Auto-Einpassung: die laesst rundum Luft, damit nichts abgeschnitten
    // wird. Fuer ein Bild ist das zu viel Rand — das Modell wirkt als Briefmarke.
    c.applyView({ azimuth: ${azimut}, elevation: ${elevation}, distance: auto.distance * 0.82 });
    await new Promise((r) => setTimeout(r, 400));
    return true;
  `));
}

const SHOTS: Shot[] = [
  {
    name: "hero.png",
    klasse: "hero",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      await blickwinkel(cdp, 320, 46);
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "code-and-render.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await splitQuelleUndBild(cdp, "Ground-floor.md"))) return null;
      await blickwinkel(cdp, 320, 46);
      return boxOf(cdp, ".workspace-split.mod-root", 0);
    },
  },
  {
    name: "hover-toolbar.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      if (!(await controllerBereit(cdp))) return null;
      await blickwinkel(cdp, 320, 46);
      // Kein Hover noetig: beim aktiven Block steht die Leiste ohnehin. Der Versuch
      // ueber Input.dispatchMouseEvent traf sie nicht — und ein Bild vom Hover-Zustand
      // waere ohnehin nicht reproduzierbar, weil der Zeiger im Screenshot fehlt.
      const box = await boxOf(cdp, ".tdcb-toolbar", 8);
      if (!box) return null;
      const block = await boxOf(cdp, ".tdcb-block");
      if (!block) return box;
      // Leiste plus das obere Drittel des Modells — sonst schwebt sie kontextlos.
      return {
        x: Math.max(0, box.x - 260),
        y: block.y,
        width: box.width + 268,
        height: Math.min(block.height, box.height + 220),
      };
    },
  },
  {
    name: "sidebar-controls.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      if (!(await controllerBereit(cdp))) return null;
      await blickwinkel(cdp, 320, 46);
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
      // NICHT ueber blockBereit: bei unbekanntem Schluessel rendert der Pruefling kein
      // Modell (GUI-Smoke B15 ist genau deshalb rot). Auf ein Canvas zu warten hiesse,
      // auf etwas zu warten, das per Design nicht kommt.
      await closeExtraLeaves(cdp);
      if (!(await openExisting(cdp, "Unknown-key.md", "preview"))) return null;
      await cdp.evaluate(`
        const play = [...document.querySelectorAll(".tdcb-play")]
          .filter((e) => e.getBoundingClientRect().width > 1)[0];
        if (play) play.click();
        return true;
      `);
      const meldung = await pollUntil<boolean>(cdp, `
        const slot = [...document.querySelectorAll(".tdcb-message-slot")]
          .find((e) => e.textContent.trim());
        return !!slot;
      `, 15_000, 400);
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
        const beschriftung = (e) =>
          (e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent || "").trim();
        const knopf = [...document.querySelectorAll("button, .tdcb-toolbar-button, .clickable-icon")]
          .filter((e) => e.getBoundingClientRect().width > 1)
          .find((e) => beschriftung(e).includes("Edit model"));
        if (!knopf) {
          return "kein Knopf: " + [...document.querySelectorAll(".tdcb-toolbar *")]
            .map(beschriftung).filter(Boolean).join("|");
        }
        knopf.click();
        await new Promise((r) => setTimeout(r, 1000));
        return !!(document.querySelector(".tdcb-editing") || document.querySelector(".tdcb-panel-edit"));
      `);
      if (!gestartet) return null;
      return boxAround(cdp, [".tdcb-block", ".tdcb-panel"], PADDING);
    },
  },
  {
    name: "unapplied-edits.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Edited.md"))) return null;
      await blickwinkel(cdp, 320, 46);
      const da = await pollUntil<boolean>(cdp, `
        return [...document.querySelectorAll(".tdcb-badge")]
          .some((e) => e.getBoundingClientRect().width > 1);
      `, 8_000, 300);
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
  if (!(await controllerBereit(cdp))) return "orbit.gif — kein aktiver Controller";

  // Distanz AUS der Auto-Einpassung ableiten, nicht raten. Eine feste Zahl (vorher 14)
  // hat nichts mit der Groesse des Modells zu tun: im ersten GIF sass ein
  // briefmarkengrosses Haus in einer weissen Flaeche.
  const basis = await cdp.evaluate<number>(`
    const c = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
    c.applyView(null);
    await new Promise((r) => setTimeout(r, 400));
    return c.getView()?.distance ?? 0;
  `);
  if (!basis) return "orbit.gif — die Auto-Einpassung lieferte keine Distanz";

  const viewport = await boxOf(cdp, ".tdcb-viewport") ?? await boxOf(cdp, ".tdcb-block");
  if (!viewport) return "orbit.gif — kein Viewport gefunden";
  // Enger Ausschnitt: das Modell sitzt mittig, der Block ist absichtlich hoch. Die volle
  // Blockhoehe mitzunehmen hiesse, zwei Drittel weisse Flaeche zu animieren.
  const hoehe = Math.round(viewport.height * 0.74);
  const box: Rect = {
    x: viewport.x,
    y: viewport.y + Math.round((viewport.height - hoehe) / 2),
    width: viewport.width,
    height: hoehe,
  };

  const frameDir = join(outDir, ".orbit-frames");
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  const SCHRITTE = 72;
  for (let i = 0; i < SCHRITTE; i++) {
    const azimut = Math.round((i / SCHRITTE) * 360);
    // Zoom als sanfte Atmung um den Nahwert. Die Grenzen sind auf den Ausschnitt oben
    // abgestimmt: naeher heran und das Modell wird im engen Rahmen angeschnitten.
    const faktor = 0.88 + Math.sin((i / SCHRITTE) * Math.PI * 2) * 0.07;
    const gesetzt = await cdp.evaluate<boolean>(`
      const controller = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].active.get();
      if (!controller?.applyView) return false;
      controller.applyView({ azimuth: ${azimut}, elevation: 38,
                             distance: ${(basis).toFixed(3)} * ${faktor.toFixed(3)} });
      await new Promise((r) => setTimeout(r, 40));
      return true;
    `);
    if (!gesetzt) return "orbit.gif — der aktive Controller nimmt kein applyView entgegen";
    const png = await capture(cdp, box);
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
      "\n⚠️  Lief Obsidian waehrend dieses Setups, muss es JETZT neu starten. --setup hat\n" +
      "   Notizen, Layout und Plugin-Einstellungen ersetzt; ein laufendes Obsidian haelt\n" +
      "   den alten Stand im Speicher und schreibt ihn zurueck. Der naechste Aufnahme-Lauf\n" +
      "   scheitert dann an jedem Bild mit \"Zustand kam nicht zustande\".\n" +
      "\nObsidian mit offenem Debug-Port starten und diesen Vault oeffnen:\n" +
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

  // attachTo statt Cdp.attach: es waehlt das Fenster mit dem Workspace, statt am Titel zu
  // raten. Obsidian oeffnet je nach Lage weitere Fenster (Einstellungen mit about:blank,
  // ein leeres „Obsidian"), und Cdp.attach bricht dann mit „Mehrere Fenster offen" ab —
  // obwohl genau eines davon das gesuchte ist.
  const cdp = await attachTo("workspace", port, REPO_NAME);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Fenster mit dem Vault "${REPO_NAME}" auf Port ${port}.\n` +
      "Den Aufnahme-Vault oeffnen (er darf neben anderen Vaults offen sein):\n" +
      `  open -a Obsidian "$STAGING_VAULTS_DIR/${REPO_NAME}"`,
    );
  }
  console.log(`Verbunden auf Port ${port}.\n`);
  // Sofort nach vorn holen, nicht erst beim Auslösen. Chromium drosselt das Rendering
  // nicht-fokussierter Fenster: steht ein anderes Obsidian-Fenster im Vordergrund,
  // bleibt der Lesebereich hier LEER — kein Codeblock, kein Block, keine Fehlermeldung.
  // Der Treiber meldet dann "Zustand kam nicht zustande" und zeigt damit auf alles
  // ausser die Ursache. (Fallstrick 1 im Kopfkommentar — bisher nur in capture() behandelt.)
  await cdp.send("Page.bringToFront");
  // Grosszuegig warten: Obsidian baut Workspace und Plugins nach dem Fokuswechsel neu
  // auf. Zu frueh gemessen liefert eine leere Leseflaeche — und der erste Shot scheitert,
  // waehrend spaetere gelingen. Ein Fehlerbild, das wie Zufall aussieht.
  await new Promise((r) => setTimeout(r, 4000));

  // viewMode auf "on-click": der Block startet als Standbild, und ERST der Klick darauf
  // meldet sich als Nutzerinteraktion (`onInteract` -> `active.set`). Mit "immediate"
  // rendert der Block zwar sofort, registriert aber nie einen aktiven Controller — und
  // ohne den bleiben Sidebar-Panel leer, Edit-Modus unerreichbar und die Kamera
  // unsteuerbar. Das steht so in src/obsidian/viewer-host.ts:288 als Befund aus
  // Smoke #4; ich bin am 2026-08-15 in dieselbe Falle gelaufen.
  await setPluginSetting(cdp, PLUGIN_ID, "viewMode", "on-click");
  // Feste Fenstergroesse — sonst haengt jedes Bild am Display, auf dem es entstand.
  await setWindowSize(cdp, FENSTER_BREITE, FENSTER_HOEHE);
  // Zur Laufzeit, nicht ueber die Fixture-Datei: ein laufendes Obsidian liest sie nicht neu.
  await setAppConfig(cdp, "readableLineLength", false);
  // Inline-Titel aus: Obsidian zeigt sonst den Dateinamen als Ueberschrift UND die Notiz
  // ihre eigene H1 direkt darunter — im Bild steht derselbe Titel zweimal.
  await setAppConfig(cdp, "showInlineTitle", false);
  // Gestapelte Tabs abschalten: in diesem Modus zeigt Obsidian ALLE Tabs gleichzeitig
  // als schmale vertikale Streifen. Am 2026-08-15 stand der 3D-Block dadurch in einer
  // 110 px breiten Spalte — die Aufnahme gelang technisch und war als Bild wertlos.
  await cdp.evaluate(`
    if (document.querySelector(".workspace-tabs.mod-stacked")) {
      app.commands.executeCommandById("workspace:toggle-stacked-tabs");
      await new Promise((r) => setTimeout(r, 400));
    }
    return true;
  `);

  let ok = 0;
  let fehlend = 0;
  for (const shot of SHOTS) {
    if (nur && shot.name !== nur) continue;
    try {
      const box = await shot.run(cdp);
      const png = box ? await capture(cdp, box) : null;
      if (!png) {
        console.log(`  ✗ ${shot.name} — Zustand kam nicht zustande`);
        fehlend++;
        continue;
      }
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
