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
