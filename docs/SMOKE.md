# GUI-Smoke — 3d-codeblocks

Manuelle Prüfung in einem echten Vault. Unit-Tests decken die Rechenlogik und den
Lebenszyklus ab, aber nicht WebGL, nicht Obsidians Live-Preview-Verhalten und nicht das
Theme — das hier ist das Gate dafür (vault-crews-Lesson: Live-Smoke ist Pflicht).

**Datum:** ______  **Obsidian-Version:** ______  **Plugin-Version:** Unreleased (view memory, auf 0.1.2)

## Vorbereitung

```bash
npm run build
OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins/3d-codeblocks" npm run deploy
```

Testdateien: mindestens eine GLB und eine STL im Vault. Für Punkt 9 zusätzlich eine
Draco-komprimierte GLB (z. B. mit `gltf-transform draco in.glb out.glb`).

## Checkliste

> [!success] Seit 2026-08-14 automatisiert — `npm run smoke:gui -- --section basis`
> Die Punkte 1–10 und „Zusätzlich zu beobachten" fährt der CDP-Treiber
> (`scripts/gui-smoke.ts`, Abschnitt `basis`) gegen ein laufendes Obsidian:
> **15 Prüfpunkte, 37/37 im Gesamtlauf.** Von Hand abzuhaken ist hier nichts mehr; die
> Beschreibungen bleiben stehen, weil sie begründen, was jeder Punkt prüft.
>
> | Punkt | Prüfpunkte im Treiber |
> |---|---|
> | 1. Grundfall | B1 (Modell ist *gezeichnet*, nicht nur ein Canvas) · B2 (Orbit) · B3 (Zoom per Rad) · B4 (Pan mit rechter Taste) |
> | 2. Kamera zurücksetzen | B5 (Doppelklick trifft den Einpass-Zustand wieder genau) |
> | 3. Mehrere Blöcke | B10 (durchscrollen, jeder der fünf Blöcke zeichnet) |
> | 4. Regenerierung | B8 (Datei extern verändert → Bild folgt ohne Neustart) |
> | 5. Theme | B7 (Hintergrund folgt hell↔dunkel — am Pixel gemessen) |
> | 6. Layout | B6 (Notiz im Split → CSS-Breite **und** Renderer-Puffer schrumpfen) |
> | 7. Kein Leck | B9 (achtmal im Block getippt, keine verwaisten Canvas) |
> | 8. Klick-Modus | **bewusst nicht doppelt** — Abschnitt „aktiver Block" deckt ihn mit 1–3 ab |
> | 9. Fehlerfälle | B13 (fehlende Datei) · B14 (falsche Endung) · B15 (Tippfehler-Schlüssel: Hinweis, Modell bleibt) · Draco bleibt Handarbeit |
> | 10. STL | B16 — eine echte `.stl` aus dem Vault hat Vorrang; gibt es keine, legt der Lauf seine eigene an (gemessen wird der **Deckungsgrad**, nicht die Farbzahl: ein einfacher Körper säße sonst genau auf der Schwelle) |
> | Zusätzlich: Kontext-Budget | B11 (`Maximum live 3D views` = 2 → nur zwei live) |
> | Zusätzlich: Poster-Qualität | B12 (das Standbild zeigt das Modell, keine leere Fläche) |
> | Zusätzlich: Popout | nicht automatisiert — ein Popout ist ein eigenes CDP-Target |
>
> **Eine dritte Voraussetzung stellt der Treiber selbst her** (neben Fensterfokus und
> Plugin-Reload): `autoRotate` **muss aus sein**. Mit Selbstdrehung wird „Drehen bewegt
> die Kamera" grün, ohne dass die Maus etwas bewirkt hätte, und „Doppelklick setzt
> zurück" rot, obwohl er es tut — genau das meldete der erste Lauf im outpost-Vault.
>
> **Gegenprobe (2026-08-14):** Doppelklick-Reset stillgelegt → nur B5 rot; Theme-Nachziehen
> stillgelegt → nur B7 rot; Verdrängung im Kontext-Budget stillgelegt → B11 und B12 rot,
> B10 zu Recht grün. Der Abschnitt misst also, was er behauptet.

> [!check] Durchlauf 2026-08-19 — **16/16 grün** (Obsidian 1.13.7, outpost-worldbuilding)
> Zweimal in Folge, gegen `weltmodell/3d/ug2.gltf`. **Damit ist ein drei Tage alter Irrtum
> erledigt:** B13/B14/B15 wurden seit dem 2026-08-15 als rot geführt, B15 sogar mit einer
> Begründung am Prüfling („bei unbekanntem Schlüssel versteckt das Plugin das Modell").
> Alle drei sind grün, und `docs/images/unknown-key.png` zeigt genau den Zustand, den B15
> verlangt — Meldung *und* Modell. Am Plugin hat sich seit dem 15.08. nichts geändert; die
> Rot-Meldung stammte also aus einem Lauf, dessen Umstände nicht festgehalten wurden.
>
> **Gegenprobe (2026-08-19):** die drei Fehlermeldungen stillgelegt (`missing-file` und
> `unsupported-format` auf `SILENT`, das `warnings.push` für den unbekannten Schlüssel
> entfernt) → **genau B13, B14, B15 rot**, die anderen dreizehn grün. Deploy-Exitcode 0
> geprüft, bevor der Lauf startete.
>
> **Und ein Mangel im Treiber, den nur die Gegenprobe zeigte:** im selben Lauf fiel **B6**
> mit um, obwohl die Mutation nichts mit Layout zu tun hat — `CSS 698→362px · Puffer
> 1396→1396px`. Der Punkt wartete auf die **CSS-Breite**, behauptet aber etwas über den
> **Renderer-Puffer**, den der `ResizeObserver` erst im Frame danach schreibt. Er wartet
> jetzt auf beide Größen. Ein sporadisch roter Prüfpunkt ist teurer als ein fehlender:
> man sucht den Defekt im Plugin.

- [ ] **1. Grundfall** — Block mit gültiger GLB rendert; Orbit (linke Maustaste), Zoom
      (Rad) und Pan (rechte Maustaste) funktionieren.
- [ ] **2. Kamera zurücksetzen** — Doppelklick setzt die Ansicht zurück.
- [ ] **3. Mehrere Blöcke** — Note mit fünf 3D-Blöcken: flüssiges Scrollen, kein Block
      wird schwarz, Lüfter bleibt ruhig (Aktivitätsanzeige beobachten).
- [ ] **4. Regenerierung** — Datei extern neu erzeugen (Skript/Export). Die Ansicht
      aktualisiert sich ohne Obsidian-Neustart.
- [ ] **5. Theme** — hell ↔ dunkel umschalten: Hintergrund und STL-Material folgen
      sofort, ohne die Note neu zu öffnen.
- [ ] **6. Layout** — Pane-Breite ändern und die Note im Split öffnen: der Viewport
      skaliert korrekt mit.
- [ ] **7. Kein Leck** — im Live Preview *innerhalb* des Blocks tippen (mehrere
      Sekunden). Speicherverbrauch bleibt stabil, keine verwaisten Canvas im
      DevTools-Elementbaum.
- [ ] **8. Klick-Modus** — Setting auf „Still image, activate on click": Standbild
      erscheint, Klick aktiviert den Viewport.
- [ ] **9. Fehlerfälle** — je die richtige Meldung:
      - [ ] fehlende Datei → „File not found: <pfad>"
      - [ ] falsche Endung (`.obj`) → „Unsupported format …"
      - [ ] Draco-GLB → „Compressed glTF is not supported …"
      - [ ] Tippfehler-Schlüssel (`heigth: 400`) → Hinweis unter dem Viewport, Modell
            wird trotzdem angezeigt
- [ ] **10. STL** — lädt und ist in hellem wie dunklem Theme gut sichtbar.

## Zusätzlich zu beobachten

- [ ] **Popout-Fenster** — Note in ein eigenes Fenster ziehen: der Viewport rendert
      weiter (rAF hängt am Fenster des Containers, nicht am Haupt-Window).
- [ ] **Kontext-Budget** — „Maximum live 3D views" auf 2 stellen, Note mit fünf Blöcken
      durchscrollen: ältere Ansichten werden zu Standbildern statt schwarz zu werden.
- [ ] **Poster-Qualität** — das eingefrorene Standbild zeigt das Modell, nicht eine
      leere Fläche (falls doch: `preserveDrawingBuffer` in `viewer/viewport.ts` prüfen).

## Datei-nativer Ausbau (2026-07-24)

> [!success] Seit 2026-08-14 automatisiert — `npm run smoke:gui -- --section files`
> Alle sechs Punkte fährt der CDP-Treiber (Abschnitt `files`): **11 Prüfpunkte.**
>
> | Punkt | Prüfpunkte im Treiber |
> |---|---|
> | Datei öffnen | F1 (richtige View **und** gezeichnetes Modell) · F2 (drehen, Doppelklick-Reset) · F3 (zweites Format: `.glb`/`.stl`, sobald eines im Vault liegt) |
> | Embed | F4 (rendert im Embed-Container) · F5 (`![[modell\|300]]` → 300px) |
> | `gltf`-Codeblock | F6 (gültiges JSON rendert) · F7 (kaputtes meldet „not valid JSON") |
> | Slider | F8 (`input[type=range]`, 0..12) · F9 (0 = aus: nichts wird eingefroren — das Gegenstück zu B11) |
> | Koexistenz | F10 (Codeblock und Embed in derselben Notiz) |
> | Theme in Embed/gltf-Block | F11 (beide Wege folgen hell↔dunkel, am Pixel gemessen) |
>
> **Was der Lauf dabei gelernt hat:** OrbitControls läuft mit `enableDamping` — nach
> einem Drag zieht die Kamera noch nach, und ein Rücksetzen mitten in dieser Nachbewegung
> ist erst ein paar Frames später am Ziel. Der Treiber wartet deshalb auf Ruhe (drei
> gleiche Messungen), nicht auf eine feste Frist; die erste Fassung meldete 38°/32° statt
> 45°/30° und sah aus wie ein Defekt.
>
> **Gegenprobe (2026-08-14):** Embed-Höhe ignoriert → nur F5 rot; „0 = aus" im
> Kontext-Budget aufgehoben → nur F9 rot.

- [ ] **Datei öffnen** — `.gltf` im Datei-Explorer anklicken → 3D-View im ganzen Pane,
      voll interaktiv, Doppelklick-Reset geht. Auch `.glb`/`.stl`.
- [ ] **Embed** — `![[weltmodell/3d/eg.gltf]]` in einer Notiz → gerendert;
      `![[weltmodell/3d/eg.gltf|300]]` → Höhe 300.
- [ ] **`gltf`-Codeblock** — gültiges glTF-JSON → gerendert; kaputtes JSON → Meldung
      „The glTF code is not valid JSON."
- [ ] **Slider** — Settings: „Maximum live 3D views" ist ein Slider (0–12). Auf 0 →
      keine Degradierung (alle inline live); auf 2 → nur 2 gleichzeitig live, Rest Standbild.
- [ ] **Koexistenz** — bestehende ` ```3d file: `-Blöcke funktionieren unverändert.
- [ ] **Theme im Embed/gltf-Block** — hell↔dunkel wechseln → Hintergrund folgt auch
      in Embeds und gltf-Blöcken.

## Ansicht merken (2026-07-25)

> [!success] Seit 2026-08-14 automatisiert — `npm run smoke:gui`
> Die Punkte 1–8 fährt der CDP-Treiber (`scripts/gui-smoke.ts`, Abschnitt `view`) gegen ein
> laufendes Obsidian: **14 Prüfpunkte, 22/22 im Gesamtlauf**, zweimal in Folge. Von Hand
> abzuhaken ist hier nichts mehr; die Beschreibungen bleiben als Begründung stehen, was
> jeder Punkt eigentlich prüft.
>
> | Punkt | Prüfpunkte im Treiber |
> |---|---|
> | 1. Speichern und wiederfinden | V1 (echter Maus-Drag bewegt die Kamera) · V2 (`view:`-Zeile entsteht) · V3 (Ansicht nach Neuöffnen wieder da) · V3b (kein Drift über zwei Speicherzyklen) |
> | 2. Namens-Schreibweise | V4 (`view: iso` statt drei Zahlen) |
> | 3. Undo im Editor | V6 (Live Preview, Write im Buffer, `undo()` nimmt ihn zurück) |
> | 4. Lesemodus / Clear view | V5 (entfernt die Zeile — und prüft vorher, dass eine da war) |
> | 5. Fünf Etagen, Aktiv-Rahmen | **bewusst nicht doppelt** — Abschnitt „aktiver Block" deckt das mit 5–7 ab; der Treiber sagt das im Lauf an, statt es stillschweigend auszulassen |
> | 6. Sidebar auf/zu | V7 (Hover-Leiste kommt und geht) · V8 (ohne Neuaufbau der Notiz) |
> | 7. Ohne Codeblock kein Merken | V9/V10 (Embed: Save/Clear aus, Fit an, mit Begründung im Tooltip) · V11 (dasselbe für die geöffnete Datei) |
> | 8. `view: quatsch` | V12 (Hinweiszeile) · V13 (Modell bleibt sichtbar) |
>
> **Zwei Voraussetzungen prüft der Treiber selbst**, weil ihre Verletzung sonst wie ein
> Plugin-Defekt aussieht: Fensterfokus (sonst drosselt Chromium den Renderer — der Lauf
> bricht mit Ansage ab) und der geladene Plugin-Stand (er lädt das Plugin neu, weil
> `npm run deploy` nur Dateien ersetzt und die laufende Instanz sonst den alten Code misst).

- [ ] **1. Ansicht speichern und wiederfinden** — Modell drehen, **Save view** drücken
      (Sidebar oder Pin-Button in der Hover-Leiste) → `view:`-Zeile erscheint im Block,
      das Bild bleibt nach dem Neuaufbau gleich. Notiz schließen und neu öffnen → dieselbe
      Ansicht.
- [ ] **2. Namens-Schreibweise** — nahe an einen Standardwinkel drehen und speichern → im
      Block steht der Name (`iso`, `top`, …) statt drei Zahlen.
      **Toleranz ist 5°** (seit 0.1.3, vorher 2° — das traf von Hand niemand). Weiter
      daneben bleiben Zahlen stehen, und das ist richtig so: der Name ist verlustbehaftet,
      ab einer gewissen Abweichung würde die Kamera beim Wiederherstellen sichtbar auf den
      Standardwinkel springen. `top` liegt bei 89° (Anschlag, weil OrbitControls bei 90°
      umkippt) — von Hand landet man dort typisch bei 70–80° und bekommt dann Zahlen.
- [ ] **3. Undo im Editor** — im Quelltext-Editor speichern → Strg+Z (Cmd+Z) macht die
      `view:`-Zeile rückgängig.
- [ ] **4. Lesemodus** — im Lesemodus speichern → funktioniert; **Clear view** entfernt
      die Zeile wieder.
- [ ] **5. Fünf Etagen mit Aktiv-Rahmen** — Notiz mit fünf `3d`-Blöcken → der `tdcb-active`-
      Rahmen folgt dem zuletzt bedienten Modell, Sidebar/Toolbar beziehen sich sichtbar
      darauf.
- [ ] **6. Sidebar auf/zu** — Sidebar schließen → Hover-Leiste erscheint auf dem Modell;
      Sidebar öffnen → Leiste verschwindet wieder, ohne die Notiz neu zu laden (prüft das
      `layout-change`-Nachziehen aus Task 13).
- [ ] **7. Embed/FileView deaktiviert** — `![[haus.glb]]`-Embed und geöffnete Datei →
      **Save view**/**Clear view** deaktiviert mit Tooltip „The view can only be saved in
      a \`3d\` code block", **Fit** funktioniert trotzdem.
- [ ] **8. `view: quatsch`** — von Hand eintippen → Hinweiszeile unter dem Viewport,
      Modell trotzdem sichtbar.
- [x] **9. Fremdänderung während offener Notiz — gestrichen, in der GUI nicht herstellbar
      (gemessen 2026-07-26).** Zwei Anläufe im echten Vault: eine einzelne externe Änderung,
      dann 60 Änderungen in 15 s bei gleichzeitigen `Save view`-Klicks. **Jedes Mal
      „View saved", Notiz jedes Mal unbeschädigt.** Kein Zufall, sondern strukturell: der
      Guard vergleicht `expectedBody` gegen **die Quelle, in die er schreibt** — Datei
      (`vault.read`) bzw. Editor-Buffer (`editor.getValue()`). Ein externer Schreiber
      trifft beide Seiten gleichzeitig; entweder Obsidian lädt nach (alles aktuell) oder
      nicht (beide Seiten konsistent alt). Die Divergenz, die der Guard fängt, entsteht
      nur durch Obsidian-**interne** Veralterung von `getSectionInfo`/`source` — von außen
      nicht erzwingbar. Abdeckung liegt bei `tests/obsidian/block-writer.test.ts` (beide
      Schreibwege, geänderter Rumpf, verschobener Block, Fence-Sprache, CRLF, „ohne den
      Buffer anzufassen"). Gestrichen aus demselben Grund wie Punkt 10.
- [x] **10. Trailing newline — erledigt durch Punkt 1, keine eigene Beobachtung nötig.**
      Ursprünglich als offene Frage notiert („liefert Obsidian den `source` mit oder ohne
      abschließendes `\n`?"). Beantwortet sich implizit: der Schreibweg vergleicht den
      gemerkten Blockrumpf gegen die Notiz, und `stripTrailingNewline` (`block-child.ts`)
      deckt beide Fälle ab. **Speichert Punkt 1 erfolgreich, ist der reale Fall abgedeckt** —
      und nur das ist die verwertbare Information. Welcher der beiden Fälle es ist, ändert
      am Code nichts, kostet aber einen Devtools-Umweg. Bewusst gestrichen statt beobachtet.

## Edit mode (2026-07-26)

> [!success] Seit 2026-08-14 automatisiert — `npm run smoke:gui -- --section edit`
> Die Punkte 1–5 fährt der CDP-Treiber (Abschnitt `edit`): **7 Prüfpunkte.**
>
> | Punkt | Prüfpunkte im Treiber |
> |---|---|
> | 1. Betreten | E1 (Modus an, `.tdcb-editing` am Viewport, Move/Scale da) · E2 (Klick wählt einen Knoten) |
> | 2. Speichern | E3 (Verschiebung macht „Save edits" bedienbar, Notice + `.edit.gltf` entstehen) · E4 (das Original bleibt unangetastet) |
> | 3. Wiedereinstieg | E5 (Notice „Loaded existing edits" **und** derselbe Knoten trägt wieder seinen gespeicherten Wert) |
> | 4. Locked-Präfix | E6 (beide Hälften: mit `env__` nie auswählbar, ohne Sperre sehr wohl) |
> | 5. Dirty-Discard | E7 (Rückfrage erscheint, „Keep editing" bleibt, „Discard" verlässt) |
> | 6. Abnahme-Test | nicht automatisiert — prüft ein Python-Skript im Konsumenten-Repo |
> | 7. Regeneration im Modus | nicht automatisiert — braucht einen Erzeuger, der während des offenen Modus umbenennt |
>
> **Der Gizmo-Drag selbst bleibt ungeprüft** und der Lauf sagt das an: der Griff ist eine
> 3D-Trefferfläche in der Szene, seine Pixelposition hängt an Modell und Kamera — ein Drag
> darauf wäre eine Wette. E3 fährt dieselbe Kette (`applyTrs` → Session → dirty → Save)
> über die Zahlenfelder des Panels.
>
> **Zwei Dinge, die der Treiber selbst herstellt:** Er baut sein eigenes Prüfmodell (eine
> Kopie, in der ein Top-Level-Knoten das gesperrte Präfix trägt) — sonst wüsste er nicht,
> welcher Knoten gesperrt sein *sollte*. Und er wählt Knoten über ein Klick-Raster aus der
> Draufsicht: von schräg oben verdecken sie sich gegenseitig, das Raster traf dann immer
> dieselben zwei von sechs.
>
> **Gegenprobe (2026-08-14):** Laden der `.edit`-Datei stillgelegt → nur E5 rot;
> Präfix-Sperre ausgehebelt → nur E6 rot (und E2 sieht folgerichtig einen Knoten mehr).

- [ ] **1. Betreten** — Block mit `eg.gltf` → **Edit model** (Pencil in der Hover-Leiste
      oder in der Sidebar) → Raum anklicken → Gizmo erscheint, Rahmen um den Raum sichtbar.
- [ ] **2. Speichern** — Raum mit dem Gizmo verschieben → **Save edits** → Notice „Edits
      saved to …edit.gltf" → `eg.edit.gltf` existiert neben `eg.gltf`; die mtime von
      `eg.gltf` selbst bleibt unverändert.
- [ ] **3. Wiedereinstieg** — Edit-Modus erneut betreten → Notice „Loaded existing edits
      for 1 node(s)", die Verschiebung sitzt wieder auf dem frisch gelesenen Original.
- [ ] **4. Locked-Präfix** — einen `env__`-Node anklicken → keine Auswahl, kein Gizmo.
- [ ] **5. Dirty-Discard** — Node verschieben (dirty, nicht gespeichert) → **Discard
      edits** → Confirm-Dialog „Discard unsaved edits?"; **Keep editing** bleibt im
      Modus, **Discard** verwirft und schließt.
- [ ] **6. Abnahme-Test (Kontrakt §Abnahme)** — im outpost-Repo:
      `uv run python scripts/outpost_floorplan.py --diff weltmodell/3d/eg.edit.gltf` →
      Prosa-Zeile + Zielwerte, die zur im Editor vorgenommenen Verschiebung passen.
- [ ] **7. Regeneration im Edit-Modus** — bei offenem Edit-Modus das outpost-Skript
      laufen lassen, das `eg.gltf` neu erzeugt → Edits bleiben nach dem Reload erhalten;
      wurde dabei ein bearbeiteter Node umbenannt/entfernt, erscheint die Notice „N
      edited node(s) no longer exist: …" statt die Session stillschweigend zu verlieren.

## Unapplied-edits-Badge (2026-07-29)

Der Hinweis, der den Smoke-#5-Befund schließt: außerhalb des Edit-Modus zeigt der Viewer
weiter das Original — der Badge sagt, dass daneben ein ungenutzter Änderungswunsch liegt.

> [!check] Durchlauf 2026-07-30 — alle acht Punkte grün
> Gefahren gegen die laufende Obsidian-Instanz (1.13.4) im outpost-Vault, über den
> Electron-Debug-Port statt von Hand: echte Toolbar-Klicks, echtes WebGL, beide Themes.
> Dabei gefunden: der three-r169-`dispose()`-Fehler (siehe `## Befunde`) — der Badge
> selbst lief auf Anhieb wie entworfen.

- [x] **1. Erscheinen** — Block mit `eg.gltf`, `eg.edit.gltf` existiert bereits (aus dem
      Edit-Smoke oben) → oben **links** im Viewport steht „Unapplied edits" mit
      Stift-Icon. Tooltip nennt den Pfad `…/eg.edit.gltf`.
- [x] **2. Direkt nach dem Speichern** — mit einer Datei OHNE Edit-Datei starten:
      Edit-Modus → verschieben → **Save edits** → Edit-Modus verlassen → der Badge
      erscheint **ohne** Reload der Notiz.
- [x] **3. Im Edit-Modus unsichtbar** — Edit-Modus betreten → Badge verschwindet
      (dort sind die Edits ohnehin zu sehen) → verlassen → Badge ist zurück.
- [x] **4. Verschwinden** — `eg.edit.gltf` im Datei-Explorer löschen → der Badge
      verschwindet ohne Reload.
- [x] **5. Alle Wege** — derselbe Zustand in `![[eg.gltf]]`-Embed und in der FileView
      (Datei im Explorer anklicken).
- [x] **6. Kein Bedien-Hindernis** — auf dem Badge ziehen: der Orbit reagiert normal,
      der Badge fängt den Drag nicht ab.
- [x] **7. Nicht bei der Edit-Datei selbst** — `eg.edit.gltf` direkt öffnen → **kein**
      Badge (man schaut ja genau auf den Wunsch).
- [x] **8. Theme** — hell ↔ dunkel: Badge bleibt lesbar (nur Theme-Variablen).

## Befunde

_Hier notieren, was auffällt._

### 2026-07-30 · `TransformControls.dispose()` wirft — der Edit-Modus ließ sich nicht verlassen

Beim Badge-Durchlauf aufgefallen, betrifft aber **nicht** den Badge: three r169 hat
`TransformControls` von `Object3D` auf `Controls` umgestellt, sein `dispose()` ruft aber
weiterhin `this.traverse(...)`. Jeder Aufruf endete in `TypeError: this.traverse is not
a function` — live reproduziert: nach `exitSilently()` blieben `active`, `rig` und
`session` **unverändert** stehen.

Weil der Fehler ungebremst nach oben lief, riss er alles mit, was danach kam:

- `EditRig.dispose()` erreichte `setOrbitEnabled(true)`, `requestRender()` und
  `onDispose()` nicht → Orbit blieb gesperrt, Autorotate blieb pausiert, ein Reset
  wurde nicht mehr gezeichnet.
- `EditCoordinator.exitSilently()` erreichte `session = null` nicht → der Edit-Modus
  ließ sich nicht verlassen.
- `ModelBlock.onunload()` ruft `host.dispose()` **hinter** `exitSilently()` → der
  WebGL-Kontext wurde beim Entladen eines Blocks nie freigegeben.

Das erklärt rückwirkend Smoke #5, Schritt 7 („🟡 Discard verwarf scheinbar nichts, Modus
blieb offen"). Die damalige Epoch-Bail-Hypothese (Reload während des Dialogs, Verdacht
obsidian-git) trägt nicht: der Fall trat **ohne** jede Notice auf.

Behoben: `edit-controls.ts` erledigt die Aufräumarbeit selbst (`disconnect()` + Helper
freigeben) statt das kaputte `dispose()` zu rufen; `edit-mode.ts` kapselt den
Rig-Teardown zusätzlich in try/catch, damit ein Fehler dort den Ausstieg nie wieder
blockieren kann.

## Aktiver Block & Standbild-Klick (2026-08-03)

Der Fall aus Smoke #4 („Sidebar-Knöpfe erscheinen nicht beim Klick aufs Modell") plus
die Sichtbarkeit des Aktiv-Bezugs. **Automatisiert** — dieser Abschnitt läuft als
Treiber, nicht von Hand:

```bash
osascript -e 'quit app "Obsidian"'
open -a Obsidian --args --remote-debugging-port=9222
OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins/three-d-codeblocks" npm run deploy
npm run smoke:gui -- --vault <vault-name>
```

`--vault` ist bei mehreren offenen Fenstern Pflicht — der Treiber bricht lieber ab, als
im falschen Vault zu prüfen. Weitere Flags: `--model <pfad>`, `--port`, `--keep`
(Notiz stehen lassen).

> [!check] Durchlauf 2026-08-04 — **8/8 grün** (Obsidian 1.13.4, outpost-worldbuilding)
> Gegengeprüft gegen einen Build **ohne** den Fix: 2/8, Punkt 3 rot mit genau dem
> historischen Symptom („Sidebar blieb leer"). Der Smoke misst also den Defekt, statt
> nur mitzulaufen. Diese Gegenprobe hat außerdem zwei Mängel im Treiber selbst
> aufgedeckt — siehe `## Befunde`.

Der Treiber (`scripts/gui-smoke.ts`) legt eine temporäre Notiz mit zwei betitelten
Blöcken an, stellt den Ansichtsmodus auf „erst auf Klick", öffnet die Sidebar und räumt
danach wieder auf. Grundlage ist CORE-TEST-02: das Werkzeug gehört ins Repo, nicht in
einen Session-Scratchpad — beim ersten Durchlauf am 2026-07-30 lag es dort und war beim
nächsten Mal weg.

- [ ] **1. Beide Blöcke starten als Standbild** — Modus „erst auf Klick" greift.
- [ ] **2. Sidebar zeigt zunächst den Platzhalter** — „Click a 3D model to control it here."
- [ ] **3. Klick aufs Standbild füllt die Sidebar** — die Regression zu `eb78941`: das
      Modell wird live **und** die Leiste zeigt den Titel des geklickten Blocks.
- [ ] **4. „Save view" ist bedienbar** — nicht nur sichtbar, sondern nicht deaktiviert.
- [ ] **5. Genau ein Block ist aktiv markiert** — `.tdcb-active` hängt nicht an mehreren.
- [ ] **6. Der Titel des aktiven Blocks hebt sich ab** — gemessen am *computed style*,
      nicht an der Klasse: die Klasse hing auch vorher schon, sichtbar war sie zu wenig.
- [ ] **7. Der Aktiv-Rahmen liegt auf der Bühne** — `box-shadow` gesetzt.
- [ ] **8. Der Akzent folgt dem Theme** — hell ≠ dunkel (übersprungen, falls
      `app.changeTheme` in der Obsidian-Version fehlt).

### 2026-08-04 · Drei Fallen beim automatisierten GUI-Smoke

Alle drei beim ersten echten Lauf des getrackten Treibers gefunden, keine davon in einem
Unit-Test sichtbar:

1. **`Page.bringToFront` reicht auf macOS nicht.** Im Hintergrund blieb das DOM der Notiz
   komplett leer (`.tdcb-block` = 0, kein Notiztext), während `app.workspace` die Datei
   korrekt als aktiv meldete — Zustand richtig, Anzeige nicht da. Erst
   `osascript -e 'tell application "Obsidian" to activate'` (die **App** nach vorn, nicht
   nur das Fenster) rendert. CORE-TEST-02 nennt die Drosselung; der macOS-Zusatz fehlte.
2. **Ein Prüfpunkt ohne Gegenstand war grün.** Punkt 6 verglich die Farbe des aktiven
   Titels mit der eines inaktiven — ohne aktiven Block verglich er einen leeren String
   mit einer echten Farbe und meldete „unterscheidet sich". Genau im Defektfall, den er
   fangen sollte, war er grün. Jetzt prüft er erst die Existenz beider Elemente.
3. **Das Prüfwerkzeug hat die Einstellungen seines Wirts umgeschrieben.**
   `app.changeTheme` schreibt nach `.obsidian/appearance.json` und machte aus einem
   Vault, der dem System folgte (kein `theme`-Schlüssel), einen fest eingestellten. Der
   Theme-Punkt tauscht jetzt nur die Body-Klassen `theme-dark`/`theme-light` — dieselbe
   Messung, ohne Spur. Ebenso wird der Ansichtsmodus im `finally` auf den Vorwert
   zurückgeschrieben, auch nach einem Abbruch.
