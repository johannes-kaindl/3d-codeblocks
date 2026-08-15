# Aufnahme-Vertrag — README-Bilder

Dieser Ordner hält die Bilder, die `README.md` und `README.de.md` einbetten. Diese Datei ist
der **Vertrag** dafür: welche Bilder es gibt, was jedes zeigen muss, in welcher Klasse es
steht — und wie man sie reproduzierbar neu aufnimmt.

Geprüft wird der Vertrag automatisch: `readme_lint.py` (Workspace-Werkzeug) gleicht
**Vertrag ↔ Dateien ↔ README-Einbettungen** in alle Richtungen ab. Ein Eintrag ohne Datei,
eine Datei ohne Eintrag und eine Einbettung ohne Vertragszeile sind je ein Befund.

> **Warum das hier steht und nicht nur im Kopf:** der Aufnahme-Vertrag von
> `image-to-markdown` lag ab 2026-06-21 im Repo, das erste Bild entstand am 2026-08-14 —
> vierzehn Monate, in denen „nur Johannes kann das, braucht ein laufendes Plugin" ihn
> zuhielt. Mit `npm run shots` ist die Aufnahme ein Kommando.

## Status

**Stand 2026-08-15: sieben von zehn Aufnahmen stehen** (`hero`, `code-and-render`,
`sidebar-controls`, `saved-view`, `edit-mode`, `unapplied-edits`, `orbit.gif`), erzeugt mit
`npm run shots` gegen ein laufendes Obsidian 1.13.7.

**Drei sind offen** — `npm run shots:check` meldet sie, und genau dafuer gibt es ihn:

| Fehlt | Warum |
|---|---|
| `hover-toolbar.png` | Der Zuschnitt auf die Werkzeugleiste steht, das Rezept liefert ihn aber noch nicht stabil. Ein synthetisches `mouseMoved` erzeugt keinen Hover-Zustand; beim aktiven Block steht die Leiste ohnehin, der Ausschnitt braucht noch Feinschliff. |
| `unknown-key.png` | Der Pruefling **versteckt das Modell**, wenn ein Schluessel unbekannt ist — GUI-Smoke-Punkt B15 ist genau deswegen rot („meldet sich, versteckt aber das Modell nicht"). Das Bild, das dieser Vertrag beschreibt (Meldung UND Modell), kann es derzeit nicht geben. Erst klaeren, ob das Verhalten oder die Beschreibung falsch ist. |
| `settings.png` | Die Einstellungen sind in Obsidian 1.13 ein **eigenes Fenster** mit URL `about:blank`. Der Treiber bringt mit `attachTo("settings", port)` schon den Weg dorthin mit, das Rezept nutzt ihn noch nicht. |

### Offen: der Workspace kippt nach zwei bis drei Bildern

`npm run shots` liefert die ersten ein bis drei Bilder zuverlässig und danach keines mehr.
Die Diagnosezeile zeigt immer dasselbe: die Notiz gilt als aktiv, `bloeckeGesamt` ist 1,
aber `leseflaeche` bleibt 0 — Obsidian rendert das geöffnete Blatt nicht. Ein Neustart
setzt zurück; die Reihenfolge der Bilder ändert nichts.

**Sichtbar wurde die Ursachenkette erst auf Screenshots des GANZEN Fensters** — an den
Messwerten sah jede Stufe wie ein Renderer-Problem aus. Wer hier weitermacht, sollte nach
jedem Lauf ein Vollbild ansehen, nicht nur die Zahlen lesen. Was dabei zutage kam:

1. Der Workspace wuchs bei jedem Bild um eine Tab-Gruppe, bis jede Spalte 380 px breit war
   und jedes Modell darin winzig. Drei Aufräum-Verfahren meldeten Erfolg und taten nichts
   (`iterateRootLeaves` + `detach`, `detachLeavesOfType`, `workspace:close-others`); erst
   das Abräumen auf **Container-Ebene** (`rootSplit.children`) wirkt.
2. `livePreview: false` — für die Split-Bilder nötig — blieb danach gesetzt. Jedes
   Folgebild zeigte Quelltext statt Modell. Jeder Shot stellt seine Voraussetzungen
   inzwischen selbst her.
3. Das Abräumen erwischte das Blatt, in dem die Datei gerade geöffnet worden war: ein Tab
   in voller Breite mit leerem Inhalt. Deshalb wird jetzt erst geöffnet, dann aufgeräumt,
   und das aktive Blatt bleibt verschont.

Nach diesen drei Korrekturen gelingen die ersten Bilder verlässlich — der Rest noch nicht.
Der verbleibende Auslöser ist nicht gefunden.

**Bis dahin gilt: `--only <name>` nach frischem Obsidian-Start.** Und vor dem Committen die
Maße prüfen: ein misslungener Lauf hinterlässt kleinere, schlechtere Bilder an derselben
Stelle, ohne dass etwas fehlschlägt. Der Bild-Standard fängt genau das — beim missratenen
Lauf am 2026-08-15 meldete `shots:check` ein Hochformat-Hero, ein 5,4-MB-GIF und die
gerissene Ordner-Summe.

## Konventionen

Verbindlich ist der workspace-weite Bild-Standard in `_docs/readme/readme-spec.json`
(`images`-Block). Kurzfassung:

| Klasse | Einbettung | Grenze |
|---|---|---|
| `hero` | `width="820"`, zentriert, direkt nach den Badges | Querformat (H ≤ B) |
| `feature` | `width="820"` | H/B ≤ 1.6 |
| `detail` | Vorschaubild `width="380"`, verlinkt auf die Vollauflösung | keine Höhengrenze |

- **Aufnahme bei 1200 px Breite** (≈1,5-fache Schärfe-Reserve für Retina), Thumbs 380 px
  unter `thumbs/`.
- **Einbettung immer per `<img width="…">`**, nie mit `![](…)`. Nackte Markdown-Syntax
  überlässt die Größe dem Container — und der ist auf GitHub (~820 px), Forgejo (unbegrenzt)
  und der Store-Seite verschieden.
- **Absolute Raw-URLs**
  (`https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/<name>`).
  Relative Pfade lösen auf fremd gerenderten Seiten nicht auf.
- **Alt-Text ist Pflicht** — er ist alles, was der Leser sieht, solange das Bild lädt.
- **Budget:** PNG ≤ 400 KB, GIF ≤ 2 MB, Ordner ≤ 5 MB.
- **Theme:** helles Standard-Theme (`moonstone`) — das Fixture setzt es selbst.
- **Ab drei `detail`-Bildern** eine sichtbare Thumbnail-Tabelle statt Einzelbildern.

## Die Bilder

| Datei | Klasse | Referenziert von | Muss zeigen |
|---|---|---|---|
| `hero.png` | hero | `README.md`, `README.de.md` (Kopf) | Die Notiz **Ground floor** in Live-Preview: der `3d`-Block gerendert, Titelzeile **Ground floor** über dem Viewport, das Modell formatfüllend und aus einem Winkel, der Räume erkennen lässt. Ruhiges Bild — keine Werkzeugleiste, kein Mauszeiger. |
| `code-and-render.png` | feature | `README.md` (Usage) | Zwei Bereiche nebeneinander: links der **Quelltext** des `3d`-Blocks (`file:`, `title:`, `height:` lesbar), rechts dieselbe Notiz gerendert. Beantwortet „wie schreibt man das" und „was kommt dabei heraus" in einem Bild. |
| `hover-toolbar.png` | feature | `README.md` (Saving a camera angle) | Die Werkzeugleiste, die beim Überfahren des Modells erscheint, mit **Fit**, **Save view**, **Clear view** und dem Stift **Edit model**. Eng auf das Modell und die Leiste beschnitten. |
| `sidebar-controls.png` | feature | `README.md` (Saving a camera angle) | Die Sidebar (Kommando **Open 3D view controls**) neben einem aktiven Modell: Kamerawerte und dieselben Aktionen als Schaltflächen. Kein leerer Zustand — **„Click a 3D model to control it here."** darf *nicht* zu sehen sein. |
| `saved-view.png` | feature | `README.md` (Saving a camera angle) | Notiz **Saved view**: die Zeile `view: 225,28,14` im Block **und** das entsprechend gedrehte Modell im selben Bild — die Aussage ist, dass der Blickwinkel in der Notiz steht. |
| `orbit.gif` | feature | `README.md` (Features) | Eine Umkreisung des Modells samt Zoom, 6–8 s, ~800 px. Das eine Feature, das als Standbild nicht erzählbar ist. |
| `edit-mode.png` | detail | `README.md` (Edit mode) | Edit-Modus aktiv: ein ausgewählter Knoten mit Gizmo, die Sidebar mit **Move**/**Scale**, den Zahlenfeldern für Translation und Skalierung, **Reset node** und **Save edits**/**Discard edits**. Der Knotenname (z. B. `Stairs`) muss lesbar sein. |
| `unapplied-edits.png` | detail | `README.md` (Edit mode) | Das Abzeichen **Unapplied edits** über dem Viewport, mit dem Modell dahinter — der Zustand „neben der Datei liegt eine `.edit.gltf`". Nutzt die Notiz **Edited** und ein **eigenes** Modell (`edited-floor.gltf`): läge die `.edit.gltf` neben dem gemeinsam genutzten Modell, trüge *jedes* Bild dieses Abzeichen. |
| `unknown-key.png` | detail | `README.md` (Block keys) | Notiz **Unknown key**: die Meldung unter dem Viewport, die `heigth:` als unbekannten Schlüssel benennt, mit dem gerenderten Modell darüber. Zeigt, dass ein Tippfehler nicht wie ein Plugin-Fehler aussieht. |
| `settings.png` | detail | `README.md` (Configuration) | Der Einstellungen-Tab: **Default height**, **Show ground grid**, **Maximum live 3D views**, **Controls placement**, **Locked node prefixes**, **Auto-rotate**. |

## Reproduktion

```bash
# 1. Vault aus dem Fixture aufbauen und das Plugin hineinbauen
npm run shots -- --setup

# 2. Obsidian mit offenem Debug-Port auf diesem Vault starten (Handarbeit —
#    die App muss dafuer neu starten, und den Vault muss ein Mensch als
#    vertrauenswuerdig markieren, bevor Plugins laufen)
osascript -e 'quit app "Obsidian"'
open -a Obsidian --args --remote-debugging-port=9222

# 3. Aufnehmen
npm run shots

# 4. Vertrag, Dateien und README abgleichen
npm run shots:check
```

Der Vault entsteht unter `$STAGING_VAULTS_DIR/3d-codeblocks` (die Variable ist Pflicht — ein
absoluter Pfad darf nicht im Repo stehen, `scripts/check-no-abs-paths.mjs` erzwingt das). Er
ist jederzeit wegwerfbar: sein Inhalt kommt vollständig aus `fixture/`.

## UI-Strings (verbatim aus `src/`)

Nicht raten — diese Zeichenketten stehen so im Code und müssen im Bild so lesbar sein:

- Werkzeugleiste / Sidebar: **Fit** · **Save view** · **Clear view** · **Edit model**
- Edit-Modus: **Move** · **Scale** · **Reset node** · **Save edits** · **Discard edits** ·
  **Click a part of the model to select it.**
- Abzeichen: **Unapplied edits** · **Note changed — view not saved** · **Click to activate**
- Sidebar leer: **Click a 3D model to control it here.**
- Kommandos: **Open 3D view controls** · **Save current view to block** ·
  **Clear saved view** · **Fit camera to model**
- Einstellungen: **Default height** · **Show ground grid** · **Maximum live 3D views** ·
  **Controls placement** (**Sidebar only**) · **Locked node prefixes** · **Auto-rotate**
- Fehlerfall Edit-Modus: **Editing requires a glTF or GLB file**

## Fixture

`fixture/` ist die getrackte Quelle des Aufnahme-Vaults:

- `make-models.mjs` — erzeugt `ground-floor.gltf` (elf benannte Top-Level-Knoten, damit der
  Edit-Modus etwas zu greifen hat) und `octahedron.stl` (Format ohne Materialien → der
  Prüffall für das theme-abhängige Default-Material). Beide Modelle gehen durch den echten
  Loader des Plugins; `tests/fixture-models.test.ts` hält das fest.
- `notes/` — die fünf Demo-Notizen.
- `obsidian/` — Vault-Konfiguration: **nur dieses Plugin** aktiv (sonst malen fremde
  Ribbon-Icons und Sidebars in jedes Bild), helles Theme, ruhiger Kern-Plugin-Satz.

**Nichts Privates.** Der GUI-Smoke fährt gegen ein Modell aus dem echten Vault des
Maintainers; für Bilder in einem öffentlichen README geht das nicht.
