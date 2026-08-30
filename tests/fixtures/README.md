# Test-Fixtures

Binaeres Pruefmaterial, das sich nicht als Text im Test schreiben laesst.

## `ground-floor-meshopt.glb`

Das Demo-Erdgeschoss aus `docs/images/fixture/make-models.mjs`, komprimiert mit
`EXT_meshopt_compression`. Erzeugt mit:

```bash
node -e 'import("./docs/images/fixture/make-models.mjs").then(m =>
  require("fs").writeFileSync("/tmp/in.gltf", JSON.stringify(m.groundFloorGltf())))'
npx gltfpack@1.2.0 -i /tmp/in.gltf -o tests/fixtures/ground-floor-meshopt.glb -cc
```

`gltfpack` ist **keine** Abhaengigkeit des Repos — die Datei ist getrackt, weil sie sich
sonst bei jedem Lauf neu erzeugen muesste, nur um gleich zu bleiben. Wer sie neu baut,
prueft vorher, dass `extensionsRequired` weiterhin `EXT_meshopt_compression` enthaelt;
ohne das misst der Test nichts.

## `cameras.gltf`

Von Hand geschriebenes glTF mit sechs Kamera-Nodes — Pruefmaterial fuer `view: camera:<name>`.
Deckt jeden Fall ab, den die Aufloesung unterscheiden muss:

| Node | Kamera-Def | prueft |
|---|---|---|
| `Front` | namenlos | Treffer ueber den Node-Namen |
| namenlos | `Section` | Treffer ueber den Kamera-Namen |
| `Schnitt A` | namenlos | Name mit Leerzeichen |
| `Doppel` (zweimal) | namenlos | zwei gleichnamige Nodes |
| `Plan` | `Plan camera`, orthographisch | nicht unterstuetzt |

**Warum die Aufloesung auf dem rohen JSON arbeitet und nicht auf der geladenen Szene** —
an dieser Datei gemessen, three laedt sie als:

```
Front / Section / Schnitt_A / Doppel / Doppel_1 / Plan
```

`Schnitt A` wird zu `Schnitt_A` (`PropertyBinding.sanitizeNodeName` ersetzt Whitespace),
und der zweite `Doppel` heisst `Doppel_1` (`GLTFLoader.createUniqueName` haengt einen
Zaehler an). Ueber die geladenen Namen waere der erste Name nicht adressierbar und die
Dublette **gar nicht als Dublette erkennbar** — sie saehe aus wie zwei verschiedene Kameras.

Das Dreieck als Geometrie ist Beiwerk: es sorgt nur dafuer, dass die Datei durch den
echten Loader geht statt als Attrappe geprueft zu werden.
