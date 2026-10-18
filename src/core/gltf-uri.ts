// Eine URI aus einer glTF-Datei einordnen: darf sie geladen werden, und wenn ja, woher?
// Pure: kein obsidian-, kein three-Import.
//
// Die Sicherheitsentscheidung faellt HIER, nicht im Obsidian-Teil — sie ist damit ohne
// Vault und ohne WebGL pruefbar. `src/obsidian/gltf-resources.ts` fuehrt das Urteil nur aus.

export type UriClass =
  /** `data:` — der three-Loader loest das selbst auf; `uri` ist die Fassung nach der Normalisierung (ohne Steuerzeichen im Schema). */
  | { kind: "embedded"; uri: string }
  /** Vault-relativer Pfad, normalisiert und garantiert innerhalb des Vaults. */
  | { kind: "vault"; path: string }
  /** `http(s):` — ob geladen wird, entscheidet die Einstellung, nicht diese Funktion. */
  | { kind: "external"; url: string }
  | { kind: "rejected"; reason: "empty" | "scheme" | "outside-vault" };

import { resolveRelPath } from "../vendor/kit/rel-path";

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** Wie der URL-Parser des Browsers (WHATWG), BEVOR er das Schema liest: Tabulator und Zeilenumbruch fallen ueberall weg (`ht<TAB>tps://x` ist
 *  `https://x`), fuehrende und nachgestellte Steuerzeichen und Leerzeichen ebenfalls. Ein Urteil ueber die rohe Zeichenkette sahe darin einen
 *  relativen Pfad, den three dann als Netz-URL laedt. Bewusst ohne Regex mit Rueckverfolgung ueber Leerraum (quadratisch bei langen Laeufen). */
function normalizeLikeBrowser(uri: string): string {
  let s = uri.replace(/[\t\n\r]/g, "");
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end -= 1;
  s = s.slice(start, end);
  return s;
}

/**
 * @param uri      Referenz aus der glTF-Datei (`buffers[].uri`, `images[].uri`).
 * @param baseDir  Ordner der Modelldatei, vault-relativ und ohne Schraegstrich am Ende.
 *                 Nebendateien liegen bei der MODELLDATEI, nicht bei der Notiz.
 */
export function classifyUri(uri: string, baseDir: string): UriClass {
  const trimmed = normalizeLikeBrowser(uri);
  if (trimmed === "") return { kind: "rejected", reason: "empty" };

  // Schema-relative Referenz (`//host/x`, auch mit Rueckwaertsstrichen: der Browser liest `\\host` bei http(s) wie `//host`): ein Netz-Ziel.
  if (/^[\\/]{2}/.test(trimmed)) return { kind: "external", url: `https:${trimmed.replace(/\\/g, "/")}` };

  const scheme = SCHEME.exec(trimmed)?.[1].toLowerCase();
  if (scheme === "data") return { kind: "embedded", uri: trimmed };
  if (scheme === "http" || scheme === "https") return { kind: "external", url: trimmed };
  if (scheme !== undefined) return { kind: "rejected", reason: "scheme" };

  // glTF verlangt prozentkodierte URIs; ein Dateiname mit Leerzeichen kommt als `%20` an.
  // Erst dekodieren, dann normalisieren — ein kodierter Schraegstrich (`%2F`) wird damit
  // zum echten Trenner und laeuft durch dieselbe Ausbruch-Pruefung wie alles andere.
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }

  // Segmentregeln aus dem Kit (`rel-path`): `..` steigt hoechstens bis zur Vault-Wurzel, `\\` ist Trenner, NUL ist verboten,
  // ein `..` mit Leerraum (`".. "`) gilt als `..`; `/a` liest der Aufruf unterhalb des Modellordners, ein Wurzel-Ergebnis ist `empty`.
  const resolved = resolveRelPath(baseDir, decoded, { absolute: "strip" });
  if (resolved.ok) return { kind: "vault", path: resolved.path };
  if (resolved.problem === "traversal") return { kind: "rejected", reason: "outside-vault" };
  if (resolved.problem === "empty") return { kind: "rejected", reason: "empty" };
  return { kind: "rejected", reason: "scheme" };
}

/** Warum eine Referenz nicht geladen wurde. Der Datentyp liegt hier, weil der Text dazu
    hier entsteht — die Obsidian-Seite fuellt ihn nur. */
export interface ResourceProblem {
  uri: string;
  reason: "missing" | "external-blocked" | "outside-vault" | "scheme" | "empty";
}

// Reihenfolge der Zeilen — bewusst fest, damit die Hinweiszeile nicht bei jedem Laden
// anders aussieht. `empty` fehlt absichtlich: eine leere Referenz ist ein Defekt der
// Datei, ueber den der Nutzer nichts entscheiden kann.
const REASON_ORDER = ["missing", "external-blocked", "outside-vault", "scheme"] as const;

const REASON_TEXT: Record<(typeof REASON_ORDER)[number], string> = {
  missing: "Not found in the vault",
  "external-blocked": 'Not loaded because "Allow external resources" is off',
  "outside-vault": "Refused, because it points outside the vault",
  scheme: "Refused, because this kind of reference cannot be read",
};

/** Hoechstens so viele Dateinamen je Zeile — ein Modell mit 50 fehlenden Texturen soll
    einen Hinweis erzeugen, keine Textwand. */
const MAX_NAMED = 3;

export function resourceProblemNotes(problems: readonly ResourceProblem[]): string[] {
  const notes: string[] = [];

  for (const reason of REASON_ORDER) {
    const uris = problems.filter((p) => p.reason === reason).map((p) => p.uri);
    if (uris.length === 0) continue;

    const named = uris.slice(0, MAX_NAMED).join(", ");
    const rest = uris.length - MAX_NAMED;
    notes.push(`${REASON_TEXT[reason]}: ${named}${rest > 0 ? ` and ${rest} more` : ""}`);
  }

  return notes;
}
