// Nebendateien einer glTF-Datei (`.bin`, Texturen) aus dem Vault aufloesen.
//
// Das Urteil ueber eine URI faellt `core/gltf-uri.ts` — hier wird es nur ausgefuehrt und
// protokolliert. Bewusst KEIN eigener Ablehnungsgrund in dieser Datei: sonst stuende die
// Sicherheitsregel an zwei Orten und koennte auseinanderlaufen.
//
// Was nicht geladen werden darf (abgelehnt, nicht gefunden, extern bei ausgeschalteter Einstellung), bekommt ein 1x1-GIF als Ersatz — NIE die
// Original-URI zurueck: three haette sie sonst geladen, und eine externe URL waere trotz „Allow external resources: aus“ ins Netz gegangen
// (und `//host/x` oder `ht<TAB>tps://…`, die ein Muster als relativ liest). `problems` nennt dem Nutzer, was fehlt; das Modell sieht ohne die
// Textur falsch aus, aber nie still: die Hinweiszeile unter dem Viewport steht je Datei.
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

/** 1x1 transparentes GIF. */
const BLOCKED_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

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

      if (verdict.kind === "embedded") return verdict.uri;

      if (verdict.kind === "external") {
        if (!allowExternal) {
          note(uri, "external-blocked");
          return BLOCKED_PIXEL;
        }
        return verdict.url;
      }

      if (verdict.kind === "rejected") {
        note(uri, verdict.reason);
        return BLOCKED_PIXEL;
      }

      const file = app.vault.getAbstractFileByPath(verdict.path);
      if (!(file instanceof TFile)) {
        note(uri, "missing");
        return BLOCKED_PIXEL;
      }
      return app.vault.getResourcePath(file);
    },
  };
}
