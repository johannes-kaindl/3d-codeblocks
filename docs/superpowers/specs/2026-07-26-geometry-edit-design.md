# 3d-codeblocks — Geometrie-Edit (TP4)

**Datum:** 2026-07-26 · **Status:** Design freigegeben · **Baut auf:** `2026-07-25-view-memory-design.md` · **Erfüllt:** `docs/editor-anforderungen-outpost.md`

## 1. Zweck und Einordnung

Der Viewer wird um einen **Edit-Modus** erweitert: Top-Level-Nodes eines glTF/GLB-Modells
lassen sich verschieben und skalieren; das Ergebnis wird als Kopie
(`<name>.edit.gltf`/`.edit.glb`) neben dem Original gespeichert. Das Original wird nie
angefasst — es gehört dem Generator und wird bei jeder Regeneration überschrieben.

Erster Konsument ist der Weltmodell-Roundtrip von `outpost-worldbuilding`: dessen
`--diff`-Skript liest die Edit-Datei und übersetzt TRS-Änderungen in Zielwerte für sein
Geometrie-SSOT. Der Vertrag steht in `docs/editor-anforderungen-outpost.md`; die Spec der
Gegenseite in `outpost-worldbuilding/docs/superpowers/specs/2026-07-24-editor-roundtrip-design.md`.

**Scope-Entscheidung bestätigt (Brainstorm 2026-07-26):** Das Plugin bleibt generisch für
den Community-Store. Jede outpost-Spezifik wird als neutrale Editor-Tugend formuliert
(nur TRS, Speichern nie in-place, sperrbare Node-Präfixe) — kein fremder Nutzer liest
je „outpost". Loop-Wissen (`--diff`-Aufruf, `data.py`) bleibt vollständig im
Konsumenten-Repo.

**Teilprojekt-Zählung:** Dieses Dokument ist **TP4 (Geometrie-Edit)** in der
Cockpit-Zählung (TP2 Szene kuratieren · TP3 Annotationen · TP4 Geometrie-Edit). Die
Tabelle in der view-memory-Spec zeigt eine ältere Zerlegung (dort TP2 = „Rein & raus");
maßgeblich ist das Cockpit. TP4 wird vorgezogen, weil die Gegenseite fertig gemergt
wartet und der Roundtrip sofort abnahmefähig ist.

**Getroffene Entscheidungen (Brainstorm 2026-07-26):**

- **Nur TP4**, nicht der ganze Editor-Komplex. TP2/TP3 docken später an dieselben
  Grenzen an (Picking, Node-Identität, Panel-Infrastruktur), werden aber nicht
  vorgebaut (YAGNI).
- **Aktivierung über die Viewport-Toolbar** („Bearbeiten"-Button). Editieren ist eine
  Handlung, kein Dokumentzustand — kein `edit:`-Block-Key. Funktioniert dadurch in
  allen Betrachtungswegen (Block, Embed, FileView): gespeichert wird eine neue
  Vault-Datei, kein Block-Key — TP1s `canSave()`-Asymmetrie gilt hier nicht.
- **Gizmo + Zahlenfelder:** `TransformControls` (three/examples/jsm, mitgebündelt) mit
  den Modi translate/scale; der rotate-Modus wird nicht angeboten (Kontrakt-Soll
  „Rotation gar nicht erst anbieten" strukturell erfüllt). Verschieben default in der
  Grundriss-Ebene (XZ), Y-Griff vorhanden. Das Sidebar-Panel zeigt editierbare
  Zahlenfelder für Präzisionsarbeit (Erstaufgabe: 6 Raum-Überlappungen auflösen).
- **Save-Mechanik: JSON-Patch statt Szenen-Export.** Es wird nie exportiert
  (`GLTFExporter` bleibt draußen — Bundle-Größe, Struktur-Drift). Stattdessen wird das
  Original-JSON geparst und ausschließlich `translation`/`scale` der editierten Nodes
  ersetzt. Die Muss-Anforderungen des Kontrakts sind damit strukturell erfüllt statt
  diszipliniert eingehalten (§6).
- **Wiederaufnahme als TRS-Overlay:** Beim Betreten wird eine vorhandene Edit-Datei
  nicht geladen, sondern nur ihre TRS-Werte per Node-Name aufs frische Original gelegt.
  Nach einer Regeneration sitzen alte Edits auf der neuen Geometrie — dieselbe
  Philosophie wie das orbit-relative `view:`-Format aus TP1.
- **Sperren per Präfix-Setting:** Plugin-Setting „Gesperrte Node-Präfixe" (Textliste,
  Default `env__`) schließt Nodes von der Auswahl aus. `__dome`-Kinder sind ohnehin
  geschützt, weil nur Top-Level-Nodes wählbar sind.
- **V1-Verzicht:** keine Mehrfachauswahl, kein Schritt-Undo (stattdessen „Verwerfen"
  + „Zurücksetzen" pro Node), kein STL-Edit (kein Node-Konzept).

**Kit-first-Befund:** REGISTRY und `obsidian-kit` haben kein glTF-/TRS-/Patch-Primitiv —
alle einschlägigen Bausteine (ViewerHost-Adapter, ActiveViewport-Registry,
GLB-Chunk-Parsing) stammen aus diesem Repo. `core/gltf-patch.ts` wird Erst-Exemplar
„glTF byte-schonend patchen"; beim Abschluss REGISTRY-Eintrag ergänzen.

## 2. Bedienoberfläche

### 2.1 Edit-Modus betreten und verlassen

Die Viewport-Toolbar (TP1) erhält einen **„Bearbeiten"**-Button. Sichtbar nur, wenn das
Modell glTF/GLB ist **und** aus einer Vault-Datei stammt (Codeblock mit `file:`, Embed,
FileView — nicht bei Quelltext-im-Block, dort gibt es keine Datei als Original).

Im Edit-Modus: sichtbarer Modus-Rahmen um den Viewport; die Toolbar wechselt auf
**Verschieben | Skalieren | Zurücksetzen | Speichern | Verwerfen**. „Speichern" ist
deaktiviert, solange `dirty === false`. „Verwerfen" setzt alle TRS auf Ausgangswerte
zurück und verlässt den Modus — bei ungespeicherten Änderungen mit Bestätigungsdialog.
Nach erfolgreichem Speichern bleibt der Modus **aktiv** (Workflow „Überlappungen
nacheinander auflösen" speichert mehrfach zwischendurch).

### 2.2 Auswahl und Manipulation

Klick auf ein Modellteil wählt dessen **Top-Level-Node** (Vorfahr direkt unter der
Szenenwurzel). Nicht wählbar: Nodes mit gesperrtem Präfix, Nodes mit `matrix`-Transform,
Nodes mit mehrdeutigem Namen (§6). Der gewählte Node bekommt das `TransformControls`-Gizmo
im aktiven Modus (translate/scale).

Das Sidebar-Panel (TP1-Infrastruktur) zeigt für den gewählten Node: Name, editierbare
Zahlenfelder für Position (x/y/z) und Skalierung (x/y/z), einen „Zurücksetzen"-Button
(TRS dieses Nodes auf Ausgangswert). Gizmo und Zahlenfelder schreiben in dieselbe
Edit-Session; beide Richtungen bleiben synchron.

## 3. Datenmodell und Module

**Grundprinzip: Die Szene ist Anzeige, die Edit-Map ist Wahrheit.** Gespeichert wird
ausschließlich aus der Edit-Session heraus, per Patch aufs Original — die three.js-Szene
wird nie serialisiert.

```
Klick auf Raum ──▶ Picking (Top-Level, nicht gesperrt) ──▶ Gizmo attach
Gizmo-Drag / Zahlenfeld ──▶ Object3D.position/scale  +  EditSession.set(node, trs)
Speichern ──▶ patchGltf(Original-Bytes, EditSession) ──▶ <name>.edit.gltf via Vault-API
```

| Modul | Schicht | Zweck |
|---|---|---|
| `core/gltf-patch.ts` | pure | `patchGltf(text, edits)` · `patchGlb(buffer, edits)` (JSON-Chunk via `gltf-inspect`-Infrastruktur unpacken/patchen/packen) · `extractTopLevelTrs(…)` für Overlay und Ausgangswerte |
| `core/edit-session.ts` | pure | Edit-Map (Node-Index → TRS), Ausgangswerte, `dirty`, Reset-pro-Node, Overlay-Merge per Name inkl. Zählung verlorener Matches |
| `viewer/edit-controls.ts` | three.js | `TransformControls` (nur translate/scale), Raycast-Picking mit Top-Level-Auflösung, Locked-Filter |
| `obsidian/…` | Host | Toolbar-Zustand, Panel-Zahlenfelder, Datei-I/O (Vault-API), Setting „Gesperrte Node-Präfixe", Bestätigungsdialog |

**Szene ↔ JSON-Zuordnung über Indizes, nicht Namen:** Intern läuft die Zuordnung
Object3D → JSON-Node über die `associations`-Map des GLTFLoaders (liefert den
Node-Index). Grund: three.js sanitisiert Node-Namen beim Laden (Leerzeichen,
Sonderzeichen). Mit Index-Zuordnung patcht der Save garantiert den richtigen JSON-Node
und lässt dessen `name`-Feld unberührt. Nur das **Overlay** (Edit-Datei → frisches
Original) matcht über Namen — dort ist der Name per Kontrakt der Schlüssel, und es sind
zwei verschiedene Dateien.

**Serialisierungs-Präzisierung:** Beim `.gltf`-Patch wird das JSON neu serialisiert —
alle *Werte* (inkl. data-URI-Buffer als Strings) bleiben identisch, die *Formatierung*
(Whitespace) normalisiert sich. Für den Diff der Gegenseite irrelevant (er parst JSON).
Beim GLB bleibt der Binär-Chunk byte-identisch; nur der JSON-Chunk wird neu geschrieben
(inkl. 4-Byte-Padding nach GLB-Spec).

## 4. Lebenszyklus

**Betreten:** Existiert die Ziel-Edit-Datei bereits, wird ihr TRS-Stand per Namens-Match
aufs Original gelegt — Notice „Bestehende Bearbeitung übernommen (N Räume)". Namen aus
der Edit-Datei ohne Gegenstück im Original werden gezählt und in der Notice genannt,
nicht stillschweigend verworfen. Die übernommenen Werte zählen als Edits
(`dirty === true`), die Ausgangswerte fürs „Zurücksetzen" sind die des Originals.

**Regeneration während des Edits** (Loop-Normalfall: `data.py` läuft, das Original
ändert sich, der bestehende Datei-Watcher lädt den Viewer neu): Die Edit-Session
**überlebt den Reload** — nach dem Neuladen wird sie über denselben Overlay-Mechanismus
per Name wieder angewendet. Kein Sonderpfad; dieselbe Notice-Logik für verlorene Matches.

**Speichern:** Zielpfad `<dir>/<basename>.edit.<ext>` neben dem Original (`eg.gltf` →
`eg.edit.gltf`, `haus.glb` → `haus.edit.glb`). Zeigt die Quelle selbst schon auf eine
`.edit.`-Datei, wird **in-place** in diese geschrieben (kein `eg.edit.edit.gltf`) — das
„nie in-place"-Verbot des Kontrakts schützt Originale, nicht User-Edits. Eine vorhandene
Edit-Datei wird überschrieben (iterativer Normalfall). Der Codeblock bleibt unangetastet;
was der Block anzeigt, ist nicht Sache des Editors.

**Verwerfen/Ende:** §2.1. Wird der Viewport zerstört (Notiz zu, Klick-Modus deaktiviert
das Modell), gehen ungespeicherte Edits verloren — bewusste V1-Abwägung: ein
Unmount-Guard über alle Obsidian-Zerstörungspfade wäre unverhältnismäßig; abgefedert
durch „Speichern lässt den Modus aktiv".

## 5. Fehlerbehandlung

Linie des Plugins: melden, nicht ignorieren.

| Fall | Verhalten |
|---|---|
| Node trägt `matrix` statt TRS | nicht wählbar, Panel-Hinweis „hat Matrix-Transform — nicht bearbeitbar" |
| Doppelte Top-Level-Namen | betroffene Nodes gesperrt + Notice (Slug-Schlüssel wäre mehrdeutig) |
| Edit-Datei existiert, aber unparsebar | Notice, Edit startet ohne Overlay vom Original |
| Vault-Write scheitert | Notice mit Grund; Modus und Session bleiben erhalten |
| STL / Quelltext-im-Block | „Bearbeiten"-Button erscheint nicht |
| Overlay-Namen ohne Gegenstück | Zählung in der Notice, Rest wird übernommen |

## 6. Kontrakt-Erfüllung (Muss-Anforderungen → Mechanismus)

| # | Muss-Anforderung | Struktureller Mechanismus |
|---|---|---|
| 1 | Nur TRS am Raum-Node, nie Mesh-Daten | Patch ersetzt ausschließlich `translation`/`scale`-Properties; Buffer/Accessors/Meshes werden nicht berührt |
| 2 | Speichern als `<etage>.edit.gltf`, nie in-place | Zielpfad-Ableitung §4; Original wird nur gelesen |
| 3 | Node-Namen unverändert | Index-basierte Zuordnung; das `name`-Feld wird vom Patch nie geschrieben |
| 4 | TRS-Properties, keine `matrix` | Patch schreibt nur `translation`/`scale`; Nodes mit vorhandener `matrix` sind nicht editierbar |
| 5 | Keine Nodes hinzufügen/löschen | Patch operiert auf dem bestehenden `nodes`-Array, kennt keine Insert/Delete-Operation |

Soll-Punkte: Rotation wird nicht angeboten (kein rotate-Modus); `env__*` per
Locked-Präfix-Default gesperrt, `__dome` durch Top-Level-Auswahl geschützt;
Float-Rauschen unkritisch (Toleranz der Gegenseite < 1 mm).

## 7. Testing

- **`core/gltf-patch.ts`** trägt die Beweislast für den Kontrakt: Patch ändert
  ausschließlich `translation`/`scale` der adressierten Indizes
  (Property-für-Property-Vergleich des restlichen JSON), fügt nie Nodes hinzu/entfernt
  keine, schreibt nie `matrix`, lässt `name` und data-URI-Buffer unangetastet;
  GLB-Roundtrip erhält den Binär-Chunk byte-identisch inkl. Padding;
  `extractTopLevelTrs` gegen Fixtures mit/ohne explizite TRS-Defaults.
- **Kontrakt-Fixture:** Mini-`eg.gltf` nach Generator-Bauart (Raum-Nodes +
  `__dome`-Kind + `env__`-Node, data-URI-Buffer); die Muss-Anforderungen 1–5 als
  benannte Testfälle direkt dagegen — unsere Seite des Abnahme-Tests, ausführbar.
- **`core/edit-session.ts`:** dirty-Übergänge, Reset-pro-Node, Overlay-Merge inkl.
  Zählung verlorener Namen.
- **Host-Tests** (vitest + Kit-Obsidian-Mock): Button-Sichtbarkeit pro Format und
  Quelle, Toolbar-Zustandswechsel, Save-Pfad-Ableitung inkl. in-place-Regel,
  Verwerfen-Dialog. **Jeder Modus-Zweig läuft mindestens einmal wirklich durch**
  (LESSONS 2026-07-26): Edit an/aus × translate/scale × beide Ansichtsmodus-Werte;
  Locked-Präfix-Setting leer und gesetzt.
- **Manueller Abnahme-Test** (→ SMOKE.md): `eg.gltf` öffnen, `privat-herd` verschieben,
  speichern; im outpost-Repo `uv run python scripts/outpost_floorplan.py --diff
  weltmodell/3d/eg.edit.gltf` → Prosa-Zeile + Zielwerte. Vorbedingung herstellbar
  geprüft: Repo und Skript liegen auf `main`.

## 8. Abgrenzung und Seeds

**Nicht in TP4:** Rotieren, Mehrfachauswahl, Schritt-Undo (Ctrl+Z), Mesh-Edit,
Node-CRUD, STL-Edit, Block-Umschreiben auf die Edit-Datei. Wiedervorlage nur bei
gezogenem Bedarf.

**Seed für `json-editor`** (nicht hier bauen): konfigurierbare Extension-Zuordnung, um
`.gltf` als JSON-Datei zu öffnen — Debug-Werkzeug für den Roundtrip („warum hat der
Diff nichts erkannt?" beantwortet der Tree-View der `eg.edit.gltf` am schnellsten).
