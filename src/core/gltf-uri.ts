// Eine URI aus einer glTF-Datei einordnen: darf sie geladen werden, und wenn ja, woher?
// Pure: kein obsidian-, kein three-Import.
//
// Die Sicherheitsentscheidung faellt HIER, nicht im Obsidian-Teil — sie ist damit ohne
// Vault und ohne WebGL pruefbar. `src/obsidian/gltf-resources.ts` fuehrt das Urteil nur aus.

export type UriClass =
  /** `data:` — der three-Loader loest das selbst auf, wir fassen es nicht an. */
  | { kind: "embedded" }
  /** Vault-relativer Pfad, normalisiert und garantiert innerhalb des Vaults. */
  | { kind: "vault"; path: string }
  /** `http(s):` — ob geladen wird, entscheidet die Einstellung, nicht diese Funktion. */
  | { kind: "external"; url: string }
  | { kind: "rejected"; reason: "empty" | "scheme" | "outside-vault" };

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/**
 * @param uri      Referenz aus der glTF-Datei (`buffers[].uri`, `images[].uri`).
 * @param baseDir  Ordner der Modelldatei, vault-relativ und ohne Schraegstrich am Ende.
 *                 Nebendateien liegen bei der MODELLDATEI, nicht bei der Notiz.
 */
export function classifyUri(uri: string, baseDir: string): UriClass {
  const trimmed = uri.trim();
  if (trimmed === "") return { kind: "rejected", reason: "empty" };

  const scheme = SCHEME.exec(trimmed)?.[1].toLowerCase();
  if (scheme === "data") return { kind: "embedded" };
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

  const segments: string[] = baseDir === "" ? [] : baseDir.split("/").filter((s) => s !== "");
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return { kind: "rejected", reason: "outside-vault" };
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) return { kind: "rejected", reason: "empty" };
  return { kind: "vault", path: segments.join("/") };
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
