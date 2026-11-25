// Uebernehmen im Prompt-Panel (Spec Modell per Prompt § 6.3/§ 5). Seit K9 Etappe 3 schreibt der Kit-Rahmen (`buildPromptPanel`, Station 7) ueber `acceptPanel`
// des Kits und setzt den Schnappschuss vor jedem Ueberschreiben selbst; hier steht nur die Beschreibung (`acceptSpecFor`): Zaun-Sprache, die Kette aus den
// Runden (`acceptText`), Dateiname und Verweis einer neuen .shapes-Datei, Beschriftung eines neu eingefuegten Blocks, und die offene ShapesFileView,
// deren ungespeicherter Puffer vor dem Schreiben auf die Platte muss (`prepare`; das Kit kennt keine Plugin-Ansichten).
// Lesemodus: `readingMode: "refuse"` (der Block geht nur in den Quellmodus); `acceptPanel` wirft nie.
import { TFile, type App, type MarkdownView } from "obsidian";
import { exportBaseName } from "../core/shapes/export";
import { acceptText, chainOf, type PanelState, type PanelTarget } from "../core/shapes/panel-state";
import { parseShapes } from "../core/shapes/parse";
import { referenceBlock, shapesBlock } from "../core/shapes/references";
import { acceptStrings } from "../i18n/strings";
import { t } from "../i18n/t";
import type { WritePorts } from "../vendor/kit/block-writer";
import { readBlockText, type AcceptEnv, type AcceptOutcome, type AcceptSpec } from "../vendor/kit-obsidian/panel-accept";
import { VIEW_TYPE_SHAPES } from "./shapes-file-view";

export type { AcceptEnv, AcceptOutcome };

/** Sprache des Zauns, in dem ein shapes-Modell in der Notiz steht. */
export const SHAPES_LANG = "shapes";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Der Kit-`AcceptEnv` fuer dieses Plugin ohne Einstellung und Wahl (der Rahmen waehlt nie; beide Wege sind Knoepfe): Meldungen aus `src/i18n`, Lesemodus lehnt ab. */
export function buildAcceptEnv(d: { app: App; ports: WritePorts; lastEditor: () => MarkdownView | null }): Omit<AcceptEnv, "settings" | "choose"> {
  return { app: d.app, ports: d.ports, lastEditor: d.lastEditor, strings: acceptStrings(), readingMode: "refuse" };
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
export async function readTargetText(env: Pick<AcceptEnv, "app" | "ports">, target: PanelTarget): Promise<string | null> {
  if (target.kind === "block") return readBlockText(env.ports, target, SHAPES_LANG);
  if (target.kind !== "file") return null;
  const file = env.app.vault.getAbstractFileByPath(target.path);
  if (!(file instanceof TFile)) return null;
  // Ungespeichertes Tippen in einer offenen Ansicht steht nur im Puffer: der ist der aktuelle Text.
  const view = openShapesViews(env.app, target.path)[0];
  return view ? view.getViewData() : await env.app.vault.read(file);
}

/** Was das Panel schreibt, als Beschreibung fuer den Kit-Rahmen (ohne `beforeWrite`: den Schnappschuss setzt der Rahmen). */
export function acceptSpecFor(state: PanelState): Omit<AcceptSpec, "beforeWrite"> {
  return {
    fenceLang: SHAPES_LANG,
    wrap: shapesBlock,
    newFile: (text) => ({
      name: `${exportBaseName(parseShapes(text).header, "model")}.shapes`,
      // Die Datei endet mit genau einem Zeilenumbruch, LF, ohne BOM (wie `shapesBlock`).
      content: `${text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`,
      reference: referenceBlock,
    }),
    // Der Titel der Form, wie ihn der Block selbst nennt (`gltf-block.ts: label()`).
    blockLabel: (_path, _openLine, body) => parseShapes(body).header.title ?? t("view.shapesBlock"),
    compute: (current) => {
      const r = acceptText(state.rounds, current);
      return r.ok ? { ok: true, text: r.text } : { ok: false, problem: r.problems.join("; ") };
    },
  };
}

/** `create`, wenn die Kette mit einem Erzeugen beginnt, sonst `refine`. */
export function acceptKind(state: PanelState): "create" | "refine" {
  return chainOf(state.rounds)[0]?.kind === "create" ? "create" : "refine";
}

/** Ungespeichertes Tippen einer offenen Ansicht zuerst auf die Platte (Haken `prepare` des Schreibwegs, nur beim Ziel `file`): sonst wuerde die Kette auf den
 *  veralteten Plattentext angewendet und der Puffer die Datei danach wieder ueberschreiben. Wirft eine Ansicht beim Speichern, wird nichts geschrieben. */
export async function saveOpenShapesViews(app: App, state: PanelState): Promise<void> {
  const target = state.target;
  if (target.kind !== "file") return;
  try {
    for (const view of openShapesViews(app, target.path)) await view.save();
  } catch (error) {
    throw new Error(errorText(error));
  }
}
