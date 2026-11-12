// Uebernehmen im Prompt-Panel (Spec Modell per Prompt § 6.3/§ 5). Die Mechanik traegt der Kit-Baustein `panel-accept` (obsidian-kit:
// Fingerabdruck des Blocks samt Wiederfinden, Anhang anlegen und nie ueberschreiben, Cursor, Frontmatter, Lesemodus); hier steht, was
// `shapes` ist: Zaun-Sprache, die Kette aus den Runden (`acceptText`), Dateiname und Verweis einer neuen .shapes-Datei und die offene
// ShapesFileView, deren ungespeicherter Puffer vor dem Schreiben auf die Platte muss (das Kit kennt keine Plugin-Ansichten).
// Lesemodus: `readingMode: "refuse"` (der Block geht nur in den Quellmodus); `acceptPanel` wirft nie.
import { TFile, type App, type MarkdownView } from "obsidian";
import { exportBaseName } from "../core/shapes/export";
import { acceptText, chainOf, type PanelState, type PanelTarget } from "../core/shapes/panel-state";
import { parseShapes } from "../core/shapes/parse";
import { referenceBlock, shapesBlock } from "../core/shapes/references";
import type { PluginSettings } from "../core/settings-types";
import { ACCEPT_STRINGS, PANEL_TEXTS } from "../i18n/strings";
import type { WritePorts } from "../vendor/kit/block-writer";
import { askChoice } from "../vendor/kit-obsidian/choice-modal";
import {
  acceptPanel as acceptWithKit,
  readBlockText,
  type AcceptEnv,
  type AcceptOutcome,
  type AcceptSpec,
} from "../vendor/kit-obsidian/panel-accept";
import { VIEW_TYPE_SHAPES } from "./shapes-file-view";

export type { AcceptEnv, AcceptOutcome };

/** Sprache des Zauns, in dem ein shapes-Modell in der Notiz steht. */
export const SHAPES_LANG = "shapes";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Der Kit-`AcceptEnv` fuer dieses Plugin: Meldungen aus `src/i18n`, Lesemodus lehnt ab, „Ask each time“ ueber den Auswahl-Dialog. */
export function buildAcceptEnv(d: { app: App; ports: WritePorts; settings: () => PluginSettings; lastEditor: () => MarkdownView | null }): AcceptEnv {
  return {
    app: d.app,
    ports: d.ports,
    settings: d.settings,
    lastEditor: d.lastEditor,
    choose: () => chooseAcceptAs(d.app),
    strings: ACCEPT_STRINGS,
    readingMode: "refuse",
  };
}

/** Offene Ansichten einer .shapes-Datei (wie `convertFileToBlock`): ihr Puffer kann neuer sein als die Platte. */
interface OpenShapesView {
  file: TFile | null;
  save(): Promise<void>;
  getViewData(): string;
}

function openShapesViews(app: App, path: string): OpenShapesView[] {
  return app.workspace
    .getLeavesOfType(VIEW_TYPE_SHAPES)
    .map((l) => l.view as unknown as OpenShapesView)
    .filter((v) => v.file?.path === path);
}

/** Aktueller Text des Ziels fuers Panel; `null` = Datei/Block nicht (mehr) auffindbar oder veraendert. Ein Block wird ueber das Kit
 *  (`readBlockText`, Fingerabdruck samt Wiederfinden) gelesen; eine Datei aus dem Puffer der offenen Ansicht, sonst von der Platte. */
export async function readTargetText(env: AcceptEnv, t: PanelTarget): Promise<string | null> {
  if (t.kind === "block") return readBlockText(env.ports, t, SHAPES_LANG);
  if (t.kind !== "file") return null;
  const file = env.app.vault.getAbstractFileByPath(t.path);
  if (!(file instanceof TFile)) return null;
  // Ungespeichertes Tippen in einer offenen Ansicht steht nur im Puffer: der ist der aktuelle Text.
  const view = openShapesViews(env.app, t.path)[0];
  return view ? view.getViewData() : await env.app.vault.read(file);
}

function specFor(state: PanelState): AcceptSpec {
  return {
    fenceLang: SHAPES_LANG,
    wrap: shapesBlock,
    newFile: (text) => ({
      name: `${exportBaseName(parseShapes(text).header, "model")}.shapes`,
      // Die Datei endet mit genau einem Zeilenumbruch, LF, ohne BOM (wie `shapesBlock`).
      content: `${text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`,
      reference: referenceBlock,
    }),
    compute: (current) => {
      const r = acceptText(state.rounds, current);
      return r.ok ? { ok: true, text: r.text } : { ok: false, problem: r.problems.join("; ") };
    },
  };
}

export async function acceptPanel(env: AcceptEnv, state: PanelState): Promise<AcceptOutcome> {
  try {
    const t = state.target;
    if (t.kind === "file") {
      // Ungespeichertes Tippen einer offenen Ansicht zuerst auf die Platte: sonst wuerde die Kette auf den veralteten Plattentext
      // angewendet und der Puffer die Datei danach wieder ueberschreiben.
      try {
        for (const view of openShapesViews(env.app, t.path)) await view.save();
      } catch (error) {
        return { ok: false, message: env.strings.notApplied(errorText(error)) };
      }
    }
    const kind = chainOf(state.rounds)[0]?.kind === "create" ? "create" : "refine";
    return await acceptWithKit(env, specFor(state), t, kind);
  } catch (error) {
    return { ok: false, message: env.strings.couldNotApply(errorText(error)) };
  }
}

/** Zwei-Wege-Wahl fuer „Ask each time“: Kit-`askChoice`; Schliessen (Esc, Klick daneben) liefert `null` = keins von beiden. */
export function chooseAcceptAs(app: App): Promise<"block" | "file" | null> {
  return askChoice<"block" | "file">(app, {
    title: PANEL_TEXTS.acceptAsTitle,
    options: [
      { value: "block", label: PANEL_TEXTS.acceptAsBlock, cta: true },
      { value: "file", label: PANEL_TEXTS.acceptAsFile },
    ],
  });
}
