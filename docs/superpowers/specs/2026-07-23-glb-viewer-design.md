# 3d-codeblocks — GLB-Artefakt-Viewer (Stufe 1)

**Datum:** 2026-07-23 · **Status:** Design freigegeben · **Scope:** Stufe 1 (Artefakt-Viewer)

## 1. Zweck und Abgrenzung

Ein Obsidian-Plugin, das generierte 3D-Artefakte aus einem Codeblock heraus
interaktiv in der Notiz rendert — Orbit/Zoom/Pan statt statisches Bild.

````markdown
```3d
file: weltmodell/3d/eg.glb
height: 420
title: Erdgeschoss
```
````

**Erstkonsument** ist der Weltmodell-Loop in `outpost-worldbuilding`: `data.py` als
Geometrie-SSOT → VTK exportiert GLB je Etage → die Weltmodell-Note zeigt alle Etagen
untereinander → Feedback → Geometrie-Verfeinerung. Bis dieses Plugin existiert,
behilft sich der Loop mit dem Community-Plugin „3D Embed" oder externen Viewern.

**Nicht in diesem Scope (Stufe 2, eigene Spec):** Rendering von `scad`- und
`x3d`-**Quellcode** aus dem Codeblock. Diese Stufe bringt eine eigene Toolchain mit
(OpenSCAD-WASM bzw. -CLI, X3D-Engine) und ist durch Obsidians Worker-Verbot technisch
riskant — sie darf den akuten GLB-Bedarf nicht blockieren.

**Grundsatz (aus der outpost-Session 2026-07-23):** Das Plugin ist ein **Viewer für
generierte Artefakte, kein Editor-Substrat.** Die Geometrie-Wahrheit bleibt `data.py`
im Konsumenten-Repo. Editierbare 3D-Codeblöcke als SSOT wurden verworfen
(Zweitwahrheit-Drift).

**Zielbild:** Community-Store, wie die übrigen Plugins des Dachs. Daraus folgen harte
Constraints: keine Node-APIs (`child_process`/`fs`), keine Web Worker, keine
Laufzeit-Downloads, store-taugliche Lizenzen für gebündelte Bibliotheken.

## 2. Technische Wahl: three.js, gebündelt

`three` als npm-Dependency, von esbuild ins `main.js` gebündelt. Aus dem Paket kommen
`GLTFLoader`, `STLLoader` und `OrbitControls`.

**Warum:** deckt beide Zielformate ohne Eigenbau ab, MIT-Lizenz, keine
Laufzeit-Requests, kein Worker nötig. Kosten: das Bundle wächst auf geschätzt
500–700 KB minified. Im Dach kein Tabu (`local-image-generator` bündelt
onnxruntime-web), aber bewusst in Kauf genommen.

**Verworfen — Googles `<model-viewer>`:** `customElements.define` ist global pro
Fenster und nicht deregistrierbar; ein zweites Plugin mit derselben Komponente würde
werfen. Zudem lädt model-viewer Teile dynamisch nach (Store-Konflikt) und ist intern
ohnehin three.js.

**Verworfen — X_ITE für alles:** auf X3D-Szenengraphen zugeschnitten, glTF/STL sind
Nebenpfade. Hieße, die Engine heute nach einem Kriterium zu wählen, das erst in einer
noch nicht spezifizierten Stufe 2 zählt.

**Bewusste Grenze — keine komprimierten glTF-Dateien.** Draco- und
Meshopt-Decoder laufen worker-basiert; Obsidians Electron-Renderer verbietet Worker
(„Failed to construct 'Worker'", belegt in `apple-health` und
`local-image-generator`). VTK exportiert unkomprimiert, der Erstkonsument ist also
nicht betroffen. Solche Dateien werden erkannt und mit Klartext abgewiesen (§6).

## 3. Architektur

Drei Schichten, nach Testbarkeit geschnitten. `src/core/` importiert weder `obsidian`
noch `three` und ist per `check:pure` abgesichert.

```
src/
  core/                    ← pure, node-testbar
    block-config.ts        parseBlockConfig(source) → BlockConfig | ConfigError[]
    format.ts              detectFormat(path) → 'gltf' | 'stl' | null
    gltf-inspect.ts        inspectGlb(buffer) → { requiredExtensions, jsonChunkOk }
    camera-fit.ts          fitCamera(min, max, fovDeg, aspect) → { position, target }
    context-budget.ts      pickEvictions(active, limit, lastUsedAt) → id[]
    view-model.ts          ViewerState → ViewModel (Zustand + Meldungstext)
  viewer/                  ← three-Schicht, kein obsidian-Import
    scene.ts               Szene, Licht, Hintergrund (injizierte Farben)
    loaders.ts             ArrayBuffer → Object3D (GLTFLoader / STLLoader)
    viewport.ts            Viewport: mount · requestRender · resize · dispose
  obsidian/
    processor.ts           registerMarkdownCodeBlockProcessor('3d', …)
    block-child.ts         MarkdownRenderChild: Lifecycle, Sichtbarkeit, Poster, Theme
    file-source.ts         Pfad → TFile → ArrayBuffer + mtime, 'modify'-Abo
    theme.ts               Theme-Farben lesen + 'css-change'-Abo
    settings.ts            Settings-Tab + Defaults
  main.ts
```

Die vier interessanten Entscheidungen — Config-Parsing, Format-/Kompressions-Erkennung,
Kamera-Einpassung, Zustandsdarstellung — sind reine Rechnung und ohne WebGL testbar.
`viewer/` weiß nichts von Obsidian: es bekommt einen `ArrayBuffer`, ein `HTMLElement`
und Farben. `obsidian/` verbindet beides und besitzt allein den Lebenszyklus.

### Lebenszyklus (tragendes Element)

Jeder Block wird ein `MarkdownRenderChild` und per `ctx.addChild()` an Obsidians Baum
gehängt. Wirft Obsidian den Codeblock-DOM weg — was beim Tippen in Live Preview
ständig passiert — ruft es selbst `onunload()`. Dort läuft `viewport.dispose()`:
Szene traversieren und Geometrien/Materialien/Texturen freigeben, `renderer.dispose()`,
`forceContextLoss()`, `IntersectionObserver` abmelden, Vault- und Workspace-Events
abbestellen. Kein eigenes Aufräum-Buchhaltungssystem, sondern Obsidians vorhandener
Mechanismus. Das ist die Antwort auf den bekannten Fallstrick „WebGL-Leck in Minuten".

## 4. Codeblock-Syntax und Datenfluss

**Schlüssel** (bewusst schlank; alles Weitere kommt aus den Settings und gilt global,
damit fünf Etagen in einer Note konsistent aussehen):

| Schlüssel | Pflicht | Bedeutung |
|---|---|---|
| `file:` | ja | Pfad zur 3D-Datei (Wikilink-Semantik) |
| `height:` | nein | Viewport-Höhe in px; Default aus Settings |
| `title:` | nein | Beschriftung über dem Viewport |

**Kurzform:** Eine Zeile, die nicht dem Muster `^[a-zA-Z][\w-]*:\s` entspricht, gilt
als `file:`-Pfad. Ein `3d`-Block, der nur `weltmodell/3d/eg.glb` enthält, funktioniert
also ohne Schlüssel.

**Unbekannte Schlüssel werden gemeldet, nicht ignoriert.** `heigth: 400` würde sonst
still wirkungslos bleiben — ein Tippfehler, der wie ein Plugin-Bug aussieht. Die
Meldung erscheint als Hinweiszeile *unter* dem trotzdem gerenderten Viewport, blockt
also nicht.

**Pfadauflösung** über `metadataCache.getFirstLinkpathDest(pfad, ctx.sourcePath)` —
identisch zur Wikilink-Auflösung, deckt relativ, vault-absolut und Kurzform ab.
Gelesen wird mit `vault.readBinary(file)`.

**Cache-Invalidierung bei Regenerierung.** Der Loop überschreibt Dateien unter
gleichem Pfad. Primär: Abo auf `vault.on('modify')`, gefiltert auf die eigene Datei →
Neuladen. Backstop: Beim Wiedersichtbarwerden eines Blocks wird `file.stat.mtime`
gegen den geladenen Stand geprüft — falls Obsidians Watcher eine externe Änderung
verspätet meldet.

## 5. Rendering-Strategie

**Kein Dauer-rAF-Loop.** Gerendert wird on demand: bei Orbit-/Zoom-Änderung
(`controls.addEventListener('change', …)`), bei Resize (`ResizeObserver`), nach dem
Laden. Nur bei aktivem Autorotate läuft eine kontinuierliche Schleife. Eine offene
Notiz kostet damit im Ruhezustand keine GPU-Zeit.

**Sichtbarkeit über `IntersectionObserver`.** Zwei vom Nutzer wählbare Modi
(Setting `Ansichtsmodus`):

- **Sofort interaktiv (Default):** Der Viewport wird beim Sichtwerden aufgebaut und
  ist direkt bedienbar. Verlässt der Block das Sichtfeld deutlich (Margin: zwei
  Bildschirmhöhen), wird sein aktueller Frame als Poster eingefroren und der
  WebGL-Kontext freigegeben.
- **Erst auf Klick:** Beim Sichtwerden wird die Datei geladen, **einmal** gerendert,
  der Frame per `canvas.toDataURL()` als Poster gesichert und der Kontext sofort
  freigegeben. Angezeigt wird das Standbild mit Play-Overlay; ein Klick baut den
  interaktiven Viewport auf. Poster werden pro Session im Speicher gehalten
  (Schlüssel: Pfad + mtime), damit erneutes Scrollen nicht neu rendert.

Der Poster-Frame ist bewusst kein leerer Platzhalter — beim Durchscrollen des
Weltmodells soll man Etagen sehen, nicht Dateinamen.

**Kontext-Budget.** Browser deckeln gleichzeitige WebGL-Kontexte (~8–16) und schießen
darüber hinaus stillschweigend die ältesten ab. Ein plugin-weiter Manager hält
höchstens N aktive Kontexte (Setting, Default 6) und degradiert bei Überschreitung
den am längsten nicht bedienten Viewport zum Poster. Die Auswahl ist pure Logik
(`pickEvictions`) und getestet.

**Kamera.** Aus der Bounding-Box des geladenen Objekts: Target = Box-Zentrum,
Blickrichtung normalisiert `(1, 0.8, 1)` — leicht von oben-vorn, damit Grundrisse
lesbar sind. Distanz = `radius / sin(fov/2) · 1.2`. Randfälle (leere Box, ein Punkt,
degenerierte Achse) liefern eine künstliche Mindestausdehnung statt Division durch
null. `OrbitControls` mit Damping; Doppelklick setzt die Kamera zurück.

**Licht und Material.** `HemisphereLight` + `DirectionalLight`, keine Environment-Map
(spart Bundle und Netzwerk). STL kennt keine Materialien; es bekommt ein
`MeshStandardMaterial`, dessen Farbe aus `--text-muted` abgeleitet wird — damit sitzt
es in hellen wie dunklen Themes richtig.

**Theme.** Hintergrund aus `--background-primary`, gelesen per `getComputedStyle` auf
dem Container. Abo auf `workspace.on('css-change')` → Farben neu lesen, Szene
aktualisieren, einmal nachrendern. Kein hartkodierter Farbwert im Plugin.

## 6. Fehlerbehandlung

Jeder Fehler erscheint als Meldungsbox im Block (Präfix-Klassen, Theme-Variablen) —
nie als stumme schwarze Fläche. Behandelte Fälle:

| Fall | Meldung |
|---|---|
| `file:` fehlt | „Kein `file:` angegeben." |
| Unbekannter Schlüssel | Hinweis unter dem Viewport, Rendering läuft weiter |
| `height:` ungültig | Hinweis; Default-Höhe wird verwendet |
| Datei nicht gefunden | Meldung **mit dem gesuchten Pfad** |
| Endung unbekannt | „Nicht unterstütztes Format: `.xyz` (unterstützt: .glb, .gltf, .stl)" |
| Datei leer / kein gültiger Header | „Datei ist beschädigt oder kein gültiges GLB." |
| Draco/Meshopt erforderlich | „Komprimierte glTF-Dateien werden nicht unterstützt (Obsidian erlaubt keine Web Worker) — bitte unkomprimiert exportieren." |
| WebGL nicht verfügbar | Meldung, dass der Grafikkontext fehlt |
| `webglcontextlost` | Meldung + Button „Erneut laden" |
| Ladefehler (three.js wirft) | Kurzmeldung im Block, Details in die Konsole |

Die Draco-/Meshopt-Erkennung liest den JSON-Chunk des GLB-Containers (`inspectGlb`,
pure) und prüft `extensionsRequired` — sie läuft **vor** dem Loader-Aufruf, damit der
Nutzer den echten Grund sieht statt eines generischen Parserfehlers.

## 7. Settings

Ein Settings-Tab über die native `Setting`-API, Sentence case, gefährliches unten:

| Einstellung | Typ | Default |
|---|---|---|
| Ansichtsmodus | Dropdown: sofort interaktiv / erst auf Klick | sofort interaktiv |
| Standardhöhe | Zahl (px) | 400 |
| Automatisch drehen | Toggle | aus |
| Bodengitter anzeigen | Toggle | aus |
| Maximale gleichzeitige 3D-Ansichten | Zahl | 6 |

## 8. Tests

**Pure (vitest, node-env):**
- `block-config`: Pflichtfeld, Kurzform, unbekannte Schlüssel, ungültige `height`,
  Leerzeilen/Kommentare, Whitespace-Toleranz.
- `format`: Endungen inkl. Groß-/Kleinschreibung und Pfaden mit Punkten.
- `gltf-inspect`: gültiger GLB-Header, abgeschnittene Datei, Draco erforderlich,
  Meshopt erforderlich, Extension nur *optional* (muss durchgehen).
- `camera-fit`: Würfel, flaches Objekt, Einzelpunkt, leere Box, extreme Aspect-Ratio.
- `context-budget`: unter Limit (keine Verdrängung), über Limit (ältester zuerst),
  Gleichstand.
- `view-model`: jeder Zustand liefert genau einen Meldungstext bzw. keinen.

**Obsidian-Schicht (Kit-Obsidian-Mock, Skill `obsidian-plugin-test-pattern`):**
- Pfadauflösung inkl. „nicht gefunden".
- `modify`-Event der eigenen Datei löst Neuladen aus, das einer fremden nicht.
- `onunload` ruft `dispose()` (Fake-Viewport, Aufruf-Zähler).

**Nicht unit-getestet:** `viewer/` — echtes WebGL ist in node nicht sinnvoll
darstellbar. Absicherung dort über den manuellen GUI-Smoke (§9), der laut
`vault-crews`-Lesson ohnehin Pflicht-Gate für Obsidian-Runtime-Verhalten ist.

## 9. GUI-Smoke (manuell, vor dem Release)

1. Block mit gültiger GLB rendert; Orbit, Zoom, Pan funktionieren.
2. Doppelklick setzt die Kamera zurück.
3. Note mit fünf Blöcken: flüssiges Scrollen, kein Kontextverlust, Lüfter bleibt ruhig.
4. Datei extern neu erzeugen → Ansicht aktualisiert sich ohne Obsidian-Neustart.
5. Theme hell↔dunkel umschalten → Hintergrund und STL-Material folgen sofort.
6. Pane-Breite ändern und Note in Split öffnen → Viewport skaliert korrekt.
7. Im Live Preview *im* Block tippen → kein Speicherwachstum über die Zeit
   (Task-Manager beobachten), keine verwaisten Canvas.
8. Ansichtsmodus „erst auf Klick": Poster erscheint, Klick aktiviert.
9. Fehlerfälle: fehlende Datei, falsche Endung, Draco-GLB → je die richtige Meldung.
10. STL-Datei lädt und ist in beiden Themes sichtbar.

## 10. Repo-Aufbau

Neues Plugin nach Dach-Standard: TypeScript, esbuild, vitest, eslint mit
`eslint-plugin-obsidianmd`, `check:pure`-Gate, `gate`-Script. `manifest.json` mit
`isDesktopOnly: false` — der gewählte Pfad ist worker- und node-frei, Mobile bleibt
damit offen (aber ungetestet). Klassen-Präfix `tdcb-`. Lizenz AGPL-3.0-or-later wie
die Geschwister-Plugins. Erst-Release später über den Dach-Skill
`plugin-release-setup`.

## 11. Bewusst nicht enthalten (YAGNI)

Animationen aus glTF · Messwerkzeuge · Schnittebenen · Export/Screenshot-Button ·
Materialwechsel zur Laufzeit · Kamera-Position im Codeblock · Umgebungs-HDRIs ·
Draco-Unterstützung · OBJ/PLY · AR.
