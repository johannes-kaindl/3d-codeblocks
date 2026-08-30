// Nebendateien einer glTF-Datei (`.bin`, Texturen) aus dem Vault aufloesen.
//
// Das Urteil ueber eine URI faellt `core/gltf-uri.ts` — hier wird es nur ausgefuehrt und
// protokolliert. Bewusst KEIN eigener Ablehnungsgrund in dieser Datei: sonst stuende die
// Sicherheitsregel an zwei Orten und koennte auseinanderlaufen.
//
// Abgelehnte oder nicht gefundene Referenzen werden UNVERAENDERT zurueckgegeben statt durch
// einen Platzhalter ersetzt: three scheitert daran sichtbar, und `problems` liefert die
// Erklaerung dazu. Ein stiller Platzhalter waere ein Modell, das falsch aussieht, ohne es
// zu sagen.
import { type App, TFile } from "obsidian";
import { type ResourceProblem, classifyUri } from "../core/gltf-uri";

export type { ResourceProblem };

export interface ResourceResolver {
  /** Fuer `LoadingManager.setURLModifier` — liefert immer einen String.
      Bewusst eine Property statt einer Methode: sie wird als Referenz weitergereicht
      und traegt ihren Zustand in der Closure, nicht in `this`. */
  resolve: (uri: string) => string;
  /** Je URI hoechstens einmal; der Loader fragt dieselbe Textur mehrfach. */
  problems: ResourceProblem[];
}

export function createResourceResolver(
  app: App,
  modelPath: string,
  allowExternal: boolean,
): ResourceResolver {
  const slash = modelPath.lastIndexOf("/");
  const baseDir = slash < 0 ? "" : modelPath.slice(0, slash);
  const problems: ResourceProblem[] = [];
  const seen = new Set<string>();

  function note(uri: string, reason: ResourceProblem["reason"]): void {
    if (seen.has(uri)) return;
    seen.add(uri);
    problems.push({ uri, reason });
  }

  return {
    problems,
    resolve: (uri: string): string => {
      const verdict = classifyUri(uri, baseDir);

      if (verdict.kind === "embedded") return uri;

      if (verdict.kind === "external") {
        if (!allowExternal) note(uri, "external-blocked");
        return uri;
      }

      if (verdict.kind === "rejected") {
        note(uri, verdict.reason);
        return uri;
      }

      const file = app.vault.getAbstractFileByPath(verdict.path);
      if (!(file instanceof TFile)) {
        note(uri, "missing");
        return uri;
      }
      return app.vault.getResourcePath(file);
    },
  };
}
