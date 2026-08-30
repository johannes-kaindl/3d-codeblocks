// Kameras, die in der Datei selbst stehen, ueber ihren Namen ansprechbar machen.
// Pure: kein obsidian-, kein three-Import.
//
// WARUM die Namen aus dem rohen glTF-JSON kommen muessen und nicht aus dem geladenen
// Szenengraph: three.js schreibt beim Laden zwei Mal am Namen herum, und beide Male
// verliert er die Form, die der Nutzer in seiner Notiz hinschreiben wuerde.
//   1. `GLTFLoader.js:3917` setzt `camera.name = createUniqueName(cameraDef.name)` —
//      bei mehreren gleichnamigen Kameras haengt der Loader also einen Zaehler an,
//      und die zweite "Front" heisst im Objekt nicht mehr "Front".
//   2. `PropertyBinding.sanitizeNodeName` (`PropertyBinding.js:144`) ersetzt Whitespace
//      durch `_` und entfernt reservierte Zeichen — aus "Schnitt A" wird "Schnitt_A".
// Der Name im geladenen Objekt ist damit nicht der Name in der Datei. Wer gegen den
// Szenengraph sucht, macht genau die Namen unerreichbar, die ein Autor in Blender
// vergibt. Deshalb sammelt der Aufrufer `FileCameraInfo` aus dem JSON (`nodes[].name`
// und `cameras[].name`) und dieses Modul sucht ausschliesslich darin.

export interface FileCameraInfo {
  /** Name des Knotens, der die Kamera traegt — `nodes[i].name` im rohen glTF-JSON. */
  nodeName: string | null;
  /** Name der Kamera selbst — `cameras[j].name`; beides ist im Format optional. */
  cameraName: string | null;
  /** Orthographische Kameras werden gefunden, aber nicht benutzt. */
  orthographic: boolean;
}

export type CameraLookup =
  | { kind: "found"; index: number; ambiguous: boolean }
  | { kind: "orthographic"; index: number }
  | { kind: "not-found" };

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Indizes aller Kameras, deren via `pick` gewaehlter Name auf `wanted` passt. */
function matchesIn(
  cameras: readonly FileCameraInfo[],
  wanted: string,
  pick: (camera: FileCameraInfo) => string | null,
): number[] {
  const hits: number[] = [];
  for (let index = 0; index < cameras.length; index += 1) {
    const camera = cameras[index];
    if (!camera) continue;
    const name = pick(camera);
    if (name !== null && normalize(name) === wanted) hits.push(index);
  }
  return hits;
}

/** Sucht eine Datei-Kamera ueber ihren Namen, case-insensitiv.
    Zwei Namensraeume, streng nacheinander: erst ALLE Knotennamen, dann ALLE
    Kameranamen. Der Knotenname gewinnt, weil er der ist, den ein Autor im
    Szenen-Outliner sieht und vergibt; der Kameraname ist oft nur "Camera".
    Passen im gewinnenden Namensraum mehrere, wird der erste genommen und das
    Ergebnis als `ambiguous` markiert — der Aufrufer macht daraus eine Warnung,
    keinen Fehler. */
export function findFileCamera(cameras: readonly FileCameraInfo[], name: string): CameraLookup {
  const wanted = normalize(name);
  if (wanted === "") return { kind: "not-found" };

  const byNode = matchesIn(cameras, wanted, (camera) => camera.nodeName);
  const hits = byNode.length > 0 ? byNode : matchesIn(cameras, wanted, (camera) => camera.cameraName);

  const first = hits[0];
  if (first === undefined) return { kind: "not-found" };

  // Orthographische Treffer werden uebersprungen, nicht gemeldet, SOLANGE unter demselben
  // Namen eine brauchbare Kamera liegt: "not supported" waere sonst eine falsche Auskunft
  // ueber einen Namen, der sehr wohl etwas Anfahrbares bezeichnet. Erst wenn ALLE Treffer
  // orthographisch sind, ist die Meldung die Wahrheit ueber diesen Namen.
  const usable = hits.filter((index) => cameras[index]?.orthographic !== true);
  const chosen = usable[0];
  if (chosen === undefined) return { kind: "orthographic", index: first };

  // Gezaehlt werden die BRAUCHBAREN Treffer: eine Wahl zwischen einer nutzbaren und einer
  // orthographischen Kamera ist keine Mehrdeutigkeit, sondern eindeutig.
  return { kind: "found", index: chosen, ambiguous: usable.length > 1 };
}

/** Je Kamera EIN Anzeigename fuer Fehlermeldungen: Knotenname, sonst Kameraname.
    Kameras ganz ohne Namen sind nicht ansprechbar und tauchen deshalb nicht auf.
    Doppelte Namen erscheinen einmal — "this file has: Doppel, Doppel" wuerde dem
    Leser eine Auswahl vorspiegeln, die es nicht gibt. */
export function fileCameraNames(cameras: readonly FileCameraInfo[]): string[] {
  const names: string[] = [];
  for (const camera of cameras) {
    const name = camera.nodeName ?? camera.cameraName;
    if (name !== null && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Nutzer-sichtbare Hinweise zu einem Suchergebnis (Englisch, wie alle Meldungstexte).
    Leer bei einem sauberen Treffer — Stille ist der Normalfall. */
export function fileCameraNotes(
  lookup: CameraLookup,
  name: string,
  cameras: readonly FileCameraInfo[],
): string[] {
  if (lookup.kind === "not-found") {
    const names = fileCameraNames(cameras);
    // Der Vorwurf "unbekannt" ist nur brauchbar, wenn dabeisteht, was es stattdessen gibt.
    const offer = names.length > 0 ? `this file has: ${names.join(", ")}` : "this file has no cameras";
    return [`unknown camera \`${name}\` — ${offer}`];
  }

  if (lookup.kind === "orthographic") {
    return [`\`${name}\` is an orthographic camera — not supported`];
  }

  if (lookup.ambiguous) {
    return [`\`${name}\` names more than one camera — using the first`];
  }

  return [];
}
