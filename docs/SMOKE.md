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

## Befunde

_Hier notieren, was auffällt._
