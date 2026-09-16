/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian, statt die Bilder von Hand zu klicken.
 *
 * Warum getrackt: ein Werkzeug, das nur einmal im Scratchpad existiert, ist keine Praxis.
 * Dieselbe Begruendung wie bei `scripts/gui-smoke.ts`, mit dem sich dieser Treiber die
 * CDP-Bruecke teilt. Bruecke, Aufnahme-Primitive und Fixture→Vault liegen zentral im Dach
 * (`obsidian-plugins/tools/obsidian-cdp/`, seit 2026-08-16 — vorher `scripts/lib/`, hier
 * entstanden und dann in sechs Repos kopiert); dieser Treiber importiert sie von dort.
 *
 * ## Ablauf
 *
 * ⚠️ **Vor dem Quit koordinieren — Obsidian ist geteilte Infrastruktur.** Dieses Rezept
 * braucht den frischen Start (ein Bild pro Start, jeder Lauf hinterlaesst Zustand); Mitnutzen ist
 * hier keine Alternative. Aber Obsidian ist Single-Instance: der Quit trifft die Instanz, an der
 * moeglicherweise eine andere Session arbeitet, und zerstoert deren Zustand. Der eigene Lauf ist
 * danach sauber gruen; der Schaden faellt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "belegt — erst fragen, wem"
 * ```
 *
 * Hoert der Port, haengt jemand dran: **erst fragen, dann quitten.** ⚠️ Und die Pruefung ersetzt die
 * Frage nicht — sie zeigt aktive CDP-Treiber, aber nicht, wer ein Fenster offen haelt oder auf den
 * Port wartet; am 2026-08-30 haette sie einen zwei Stunden alten Reindex nicht gezeigt, denn der
 * hing an Ollama, nicht am Port.
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
} from "../../tools/obsidian-cdp/cdp.js";
import {
  boxOf,
  capture,
  framesToGif,
  setWindowSize,
  writeShot,
  type Rect,
  type ShotOptions,
} from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

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
  // Live Preview WIEDER AN. splitQuelleUndBild schaltet sie ab, damit links echter
  // Quelltext steht — und liess sie bisher aus. Jedes Bild danach zeigte dann Quelltext
  // statt Modell: kein gerenderter Block, keine Fehlermeldung, nur "leseflaeche: 0".
  // Sichtbar war das nur im Vollbild des Fensters; an den Messwerten sah es aus wie ein
  // Renderer-Problem. Jeder Shot stellt seine Voraussetzungen deshalb selbst her.
  await setAppConfig(cdp, "livePreview", true);
  // ERST oeffnen, DANN aufraeumen: so ist das aktive Blatt garantiert das mit der Datei,
  // und das Abraeumen kann sich daran orientieren, statt zu raten, welches bleiben darf.
  if (!(await openExisting(cdp, notiz, "preview"))) {
    console.log(`      · ${notiz} liess sich nicht oeffnen (Datei im Vault?)`);
    return false;
  }
  const uebrig = await closeExtraLeaves(cdp);
  if (uebrig > 1) console.log(`      · ${uebrig} Blaetter offen — Aufraeumen unvollstaendig`);

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

/** Nach einem Split-Bild aufraeumen: Blatt zu, Live Preview zurueck.
 *  Ohne das bleibt eine Tab-Gruppe stehen, und die naechste kommt daneben — nach drei
 *  Bildern ist jede Spalte 380 px breit und jedes Modell darin winzig. */
async function splitAufloesen(cdp: Cdp): Promise<void> {
  await closeExtraLeaves(cdp);
  await setAppConfig(cdp, "livePreview", true);
}

/** Block + Sidebar-Panel zusammen, aber auf die BLOCK-Hoehe begrenzt, nicht die volle
 *  Panel-Hoehe: `.tdcb-panel` fuellt die Sidebar bis zum Fensterrand, weit ueber die
 *  paar Knoepfe/Felder hinaus. In dieser leeren Flaeche unten rechts sitzt ein
 *  OS-/Fenster-Artefakt (ein rotes Icon, kein Plugin-Element — bestaetigt per
 *  `elementFromPoint` an genau der Stelle: "nichts an dieser Stelle" im Seiten-DOM),
 *  das ein bis zum Panel-Ende reichender Ausschnitt sonst mit einfaengt. */
async function blockPlusPanelBox(cdp: Cdp): Promise<Rect | null> {
  const block = await boxOf(cdp, ".tdcb-block", PADDING);
  const panel = await boxOf(cdp, ".tdcb-panel", PADDING);
  if (!block || !panel) return null;
  const x = Math.min(block.x, panel.x);
  const right = Math.max(block.x + block.width, panel.x + panel.width);
  return { x, y: Math.min(block.y, panel.y), width: right - x, height: block.height };
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

/** Reihenfolge ist load-bearing: die beiden Split-Bilder (Quelltext + Rendering
 *  nebeneinander) hinterlassen einen Workspace, den das Aufraeumen bei Obsidian 1.13
 *  nicht vollstaendig zuruecksetzt. Stehen sie in der Mitte, scheitert alles danach.
 *  Ganz am Ende beschaedigen sie nur noch sich selbst. */
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
    name: "hover-toolbar.png",
    klasse: "feature",
    async run(cdp) {
      // "Controls placement" auf toolbar erzwingen. Der Default "auto" heisst laut
      // README: Sidebar wenn offen, sonst Hover-Leiste. Ist die Sidebar offen — und das
      // ist sie nach dem sidebar-controls-Bild —, existiert .tdcb-toolbar GAR NICHT im
      // DOM. Der Treiber suchte also etwas, das es per Einstellung nicht geben konnte,
      // und meldete "Zustand kam nicht zustande". Kein Fehler, dokumentiertes Verhalten.
      await setPluginSetting(cdp, PLUGIN_ID, "panelPlacement", "toolbar");
      // Neuaufbau ueber einen UMWEG, nicht ueber detachLeavesOfType.
      //
      // Das ist der Kern des tagelangen Problems: `detachLeavesOfType("markdown")` raeumt
      // zwar alles ab, aber das danach geoeffnete Blatt RENDERT NICHT MEHR — die Datei
      // gilt als aktiv, das Blatt existiert, die Leseflaeche enthaelt null Zeichen. Genau
      // dieser Aufruf steckte in closeExtraLeaves und war die Ursache dafuer, dass jeder
      // Lauf nach zwei bis drei Bildern nur noch leere Blaetter lieferte.
      //
      // Der Umweg ueber eine andere Notiz erzwingt denselben Neuaufbau, ohne den
      // Workspace leerzureissen.
      await openExisting(cdp, "Four-ways.md", "preview");
      await new Promise((r) => setTimeout(r, 600));
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      if (!(await controllerBereit(cdp))) return null;
      await blickwinkel(cdp, 320, 46);
      // Hover-Zustand herstellen. Die Leiste steht im DOM, aber mit opacity 0; ein
      // synthetisches Input.dispatchMouseEvent loest CSS-:hover in Electron nicht aus
      // (gemessen: opacity bleibt 0). Sie direkt sichtbar zu schalten ist keine
      // Faelschung — es ist genau der Zustand, den der Nutzer beim Ueberfahren sieht,
      // und ein Standbild kann den Mauszeiger ohnehin nicht zeigen.
      const sichtbar = await cdp.evaluate<boolean>(`
        const t = [...document.querySelectorAll(".tdcb-toolbar")]
          .find((e) => e.getBoundingClientRect().width > 1);
        if (!t) return false;
        t.style.opacity = "1";
        await new Promise((r) => setTimeout(r, 200));
        return true;
      `);
      if (!sichtbar) {
        console.log("      · keine .tdcb-toolbar im DOM — panelPlacement pruefen");
        return null;
      }
      const box = await boxOf(cdp, ".tdcb-toolbar", 8);
      if (!box) return null;
      const block = await boxOf(cdp, ".tdcb-block");
      if (!block) return box;
      // Volle Blockbreite, obere Haelfte: die Leiste sitzt rechts oben, das Modell
      // darunter. Ein enger Ausschnitt um die Leiste allein zeigt sie kontextlos, und
      // der ganze Block waere dasselbe Bild wie hero.png.
      return {
        x: block.x,
        y: block.y,
        width: block.width,
        height: Math.round(block.height * 0.58),
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
      return blockPlusPanelBox(cdp);
    },
  },
  {
    name: "unknown-key.png",
    klasse: "detail",
    async run(cdp) {
      // Ueber blockBereit statt eines eigenen, ungeduldigeren Klicks: das Modell rendert
      // trotz unbekanntem Schluessel (Vertrag-Befund 2026-08-18 — eine aeltere Annahme
      // hier im Kommentar behauptete das Gegenteil und war falsch), blockBereit wartet
      // aber zuverlaessig auf das sichtbare Standbild-Overlay, BEVOR es klickt — ein
      // Klick direkt nach openExisting traf das Overlay manchmal, bevor es im DOM stand,
      // und das Bild zeigte dann "Click to activate" statt des Modells.
      if (!(await blockBereit(cdp, "Unknown-key.md"))) return null;
      // Auf den TEXT im Block warten, nicht auf .tdcb-message-slot: gemessen sind die
      // Slot-Elemente leer, die Meldung steht an anderer Stelle im Block.
      const meldung = await pollUntil<boolean>(cdp, `
        const b = [...document.querySelectorAll(".tdcb-block")]
          .find((e) => e.getBoundingClientRect().width > 1);
        return !!(b && b.textContent.includes("Unknown key"));
      `, 15_000, 400);
      if (!meldung) {
        console.log("      · keine Unknown-key-Meldung im Block");
        return null;
      }
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "edit-mode.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Ground-floor.md"))) return null;
      // Bekannten Blickwinkel erzwingen statt den mitzunehmen, den ein frueherer Shot
      // zufaellig hinterlassen hat — sonst landet der Klick unten (Stairs-Wuerfel bei
      // ~37%/62% dieses Blickwinkels) im Leeren.
      await blickwinkel(cdp, 320, 46);
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
      // Die Auswahl ist ein Rig-Zustand, kein DOM-Klick auf ein Element — der 3D-Canvas
      // hat kein anklickbares Node-Element, nur Raycasting auf Mausposition. Ohne diesen
      // Klick zeigt das Bild den leeren Edit-Zustand ("Click a part of the model to
      // select it."), Reset/Save/Discard bleiben deaktiviert — genau das war der Befund
      // beim ersten Nachziehen dieses Rezepts fuer 0.4.0 (Vertrag verspricht einen
      // ausgewaehlten Knoten mit Gizmo, das Bild hatte keinen).
      // Fraktion am blickwinkel(320,46)-Blick GEMESSEN (nicht geraten): trifft den
      // "Stove"-Wuerfel. Eine erste Schaetzung (0.37/0.62) traf daneben — ohne
      // sichtbares Fehlersignal ("kein Knoten ausgewaehlt" kam erst durch den
      // pollUntil-Check unten zutage, nicht durch den Klick selbst.
      const blockBox = await boxOf(cdp, ".tdcb-block");
      if (!blockBox) return null;
      const modellPunkt = {
        x: Math.round(blockBox.x + blockBox.width * 0.32),
        y: Math.round(blockBox.y + blockBox.height * 0.55),
      };
      for (const type of ["mousePressed", "mouseReleased"] as const) {
        await cdp.send("Input.dispatchMouseEvent", {
          type, x: modellPunkt.x, y: modellPunkt.y, button: "left", clickCount: 1,
        });
      }
      const ausgewaehlt = await pollUntil<boolean>(cdp, `
        const label = document.querySelector(".tdcb-panel-edit-label");
        return !!(label && label.textContent.trim().length > 0);
      `, 6_000, 300);
      if (!ausgewaehlt) {
        console.log("      · kein Knoten ausgewaehlt — Klickpunkt traf daneben");
        return null;
      }
      return blockPlusPanelBox(cdp);
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
    // Vorher/Nachher der Beleuchtung (0.4.0): dieselbe Notiz, zweimal aufgenommen — einmal
    // mit "Off" (das alte Verhalten), einmal mit dem neuen Default "Faithful colors". Die
    // Einstellung wirkt live (`saveSettings` → `refreshLighting`, s. `src/main.ts`), ein
    // Notiz-Neuaufbau ist also nicht noetig — nur der Setting-Wechsel zwischen den beiden
    // Aufnahmen. `klasse: "feature"` fuer beide, weil sie als Paar nebeneinander stehen.
    name: "lighting-off.png",
    klasse: "feature",
    async run(cdp) {
      await setPluginSetting(cdp, PLUGIN_ID, "lighting", "off");
      if (!(await blockBereit(cdp, "Lighting.md"))) return null;
      await blickwinkel(cdp, 35, 22);
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "lighting-faithful.png",
    klasse: "feature",
    async run(cdp) {
      // Dieselbe Notiz bleibt offen (kein blockBereit-Neuaufbau) — nur die Einstellung
      // wechselt. Ein Reopen wuerde denselben Zustand liefern, aber unnoetig Zeit kosten
      // und die Kette der Aufraeum-Fallstricke (siehe Kopfkommentar) unnoetig verlaengern.
      await setPluginSetting(cdp, PLUGIN_ID, "lighting", "faithful");
      await new Promise((r) => setTimeout(r, 400));
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "camera-view.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Camera-view.md"))) return null;
      // KEIN blickwinkel() hier: die Kamera kommt aus der Datei (`view: camera:Overview`,
      // `doc-camera-floor.gltf`), ein applyView(null) wuerde sie durch die
      // Auto-Einpassung ersetzen — genau das Gegenteil dessen, was das Bild zeigen soll.
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "colored-stl.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await blockBereit(cdp, "Colored-stl.md"))) return null;
      await blickwinkel(cdp, 35, 18);
      return boxOf(cdp, ".tdcb-block", PADDING);
    },
  },
  {
    name: "code-and-render.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await splitQuelleUndBild(cdp, "Ground-floor.md"))) return null;
      await blickwinkel(cdp, 320, 46);
      const box = await boxOf(cdp, ".workspace-split.mod-root", 0);
      return box;
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

/** Der Einstellungen-Tab lebt in einem EIGENEN Fenster.
 *
 *  Obsidian 1.13 oeffnet es mit der URL `about:blank`; ein Target-Filter auf
 *  `app://obsidian.md` findet es nicht, und `Cdp.attach` bricht mit "Mehrere Fenster
 *  offen" ab. `attachTo("settings", port, REPO_NAME)` waehlt die ART ueber die Sache: es
 *  ist das Fenster OHNE Workspace. Den VAULT waehlt es seit 2026-08-30 ueber den
 *  Fenstertitel — nicht ueber dessen erstes Wort ("Settings"/"Einstellungen" ist
 *  lokalisiert und wechselt mit der UI-Sprache), sondern ueber " - <vault> - Obsidian".
 *  Ohne diesen dritten Parameter ist die Wahl bei zwei offenen Vaults ein Muenzwurf.
 *  Das Fenster schliesst sich ausserdem, sobald ein anderes den Fokus bekommt —
 *  deshalb passiert hier alles in einem Zug.
 */
async function settingsBild(cdp: Cdp, port: number, opts: ShotOptions): Promise<string> {
  // Auslieferungszustand herstellen: das hover-toolbar-Rezept setzt panelPlacement auf
  // "toolbar". Das Einstellungsbild zeigte sonst einen Wert, den der Treiber selbst
  // gesetzt hat — eine Doku-Aufnahme, die den eigenen Eingriff dokumentiert.
  await setPluginSetting(cdp, PLUGIN_ID, "panelPlacement", "auto");
  await cdp.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 900));
    return true;
  `);
  const fenster = await attachTo("settings", port, REPO_NAME);
  if (!fenster) return "settings.png — kein Einstellungen-Fenster gefunden";
  try {
    await fenster.send("Page.bringToFront");
    // Das Einstellungen-Fenster ist bei Standardgroesse zu klein fuer den mit 0.4.0
    // gewachsenen Tab (Lighting, Model's own lights, Allow external resources kamen
    // dazu) — `.vertical-tab-content` scrollt dann intern, und `getBoundingClientRect`
    // liefert nur die SICHTBARE Hoehe, nicht `scrollHeight`. Ein screenshot davon
    // schneidet die unteren Felder (Controls placement, Locked node prefixes) einfach
    // ab, ohne Fehler. Grosszuegige feste Fenstergroesse statt Scroll-Handling.
    await setWindowSize(fenster, 1100, 1500);
    await new Promise((r) => setTimeout(r, 600));
    const box = await boxOf(fenster, ".vertical-tab-content", 0)
      ?? await boxOf(fenster, ".modal-content", 0);
    if (!box) return "settings.png — kein Inhaltsbereich im Einstellungen-Fenster";
    const png = await capture(fenster, box);
    return await writeShot(fenster, "settings.png", png, { ...opts, thumb: true });
  } finally {
    await fenster.evaluate("window.close(); return true;").catch(() => undefined);
    fenster.close();
  }
}

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
      generator: "make-models.mjs",
      pluginId: PLUGIN_ID,
    })) {
      console.log(`  ${zeile}`);
    }
    console.log(
      "\n⚠️  Lief Obsidian waehrend dieses Setups, muss es JETZT neu starten. --setup hat\n" +
      "   Notizen, Layout und Plugin-Einstellungen ersetzt; ein laufendes Obsidian haelt\n" +
      "   den alten Stand im Speicher und schreibt ihn zurueck. Der naechste Aufnahme-Lauf\n" +
      "   scheitert dann an jedem Bild mit \"Zustand kam nicht zustande\".\n" +
      "\n⚠️  Erst prüfen, ob schon ein Obsidian läuft — ein Quit zerstört den Zustand\n" +
      "    einer fremden Session, und der eigene Lauf ist danach trotzdem grün:\n" +
      "      lsof -nP -iTCP:9222 -sTCP:LISTEN\n" +
      "    Hört der Port, hängt jemand dran: erst fragen, dann quitten.\n" +
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
  // Konsole des Prueflings mitschneiden. Meldungen werden eingerueckt ausgegeben, damit
  // sichtbar ist, WANN sie kamen — zwischen welchen beiden Bildern.
  await cdp.mitschnitt((zeile) => console.log(`      » ${zeile}`));

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
      // Nach JEDEM Bild aufraeumen, nicht nur nach den Split-Bildern: welcher Zustand
      // zurueckbleibt, darf das naechste Bild nicht bestimmen.
      await splitAufloesen(cdp);
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

  if (!nur || nur === "settings.png") {
    console.log(`  · ${await settingsBild(cdp, port, {
      outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH,
    })}`);
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
