// Befehl "Save current view as image": legt den aktuellen Frame des aktiven Viewports als PNG im Attachment-Ordner ab
// (Grundlage ist `capturePoster()`, unveraendert). Eine vorhandene Datei bleibt unberuehrt: `getAvailablePathForAttachment`
// nummeriert, das Plugin ueberschreibt nie.
import { Notice, type App } from "obsidian";
import type { ViewportController } from "../core/active-viewport";
import { exportBaseName } from "../core/shapes/export";
import { dataUrlToBytes } from "../vendor/kit/data-url";
import { t } from "../i18n/t";

/** Bytes einer PNG-Data-URL (Kit `dataUrlToBytes`: der Puffer gehoert dem Ergebnis, `.buffer` geht direkt an
 *  `createBinary`); `null` bei fremdem Format. */
function pngBytes(dataUrl: string): ArrayBuffer | null {
  if (!dataUrl.startsWith("data:image/png;base64,")) return null;
  return dataUrlToBytes(dataUrl).buffer as ArrayBuffer;
}

export async function saveViewAsImage(app: App, controller: ViewportController): Promise<void> {
  try {
    const dataUrl = controller.snapshot?.() ?? null;
    if (dataUrl === null) {
      new Notice(t("img.nothing"));
      return;
    }
    const bytes = pngBytes(dataUrl);
    if (bytes === null) {
      new Notice(t("img.noPng"));
      return;
    }
    const sourcePath = app.workspace.getActiveFile()?.path ?? "";
    const fileName = `${exportBaseName({}, controller.label())}.png`;
    const path = await app.fileManager.getAvailablePathForAttachment(fileName, sourcePath);
    await app.vault.createBinary(path, bytes);
    new Notice(t("img.saved", path));
  } catch (error) {
    new Notice(t("img.failed", error instanceof Error ? error.message : String(error)));
  }
}
