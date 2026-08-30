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

**Stand 2026-08-15: alle zehn Aufnahmen stehen** — `npm run shots:check` meldet „keine
Befunde": jedes im Vertrag zugesagte Bild existiert, hält seine Klasse, sein Budget und
seine Einbettungsform. Ordner-Summe 2,3 MB.

Die drei zuletzt fehlenden (`hover-toolbar`, `unknown-key`, `settings`) waren **keine
Fehler am Prüfling**, sondern Verhalten, das das Rezept nicht kannte: die Hover-Leiste
existiert bei „Controls placement: auto" und offener Sidebar gar nicht im DOM · die
Unbekannter-Schlüssel-Meldung steht nicht in `.tdcb-message-slot`, sondern im Blocktext ·
der Einstellungen-Tab ist ein eigenes Fenster mit URL `about:blank`. Einzelheiten in
`2ad4b88`.

### Gelöst: „ab dem dritten Bild bleibt die Lesefläche leer"

Der Sammellauf lieferte zwei bis drei Bilder und danach nur noch leere Blätter — Notiz
aktiv, Plugin geladen, Block im DOM, **Lesefläche null Zeichen**, nichts in der Konsole.
Die Ursache ist gefunden (`2ad4b88`): **`detachLeavesOfType("markdown")` hinterlässt einen
Workspace, in dem das nächste geöffnete Blatt nicht mehr rendert.** Der Aufruf steckte in
`closeExtraLeaves`; der Neuaufbau läuft jetzt über einen Notizwechsel.

Zwei Korrekturen aus derselben Suche, die vorher als Ursache durchgingen und es nicht
waren: der Workspace wuchs bei jedem Bild um eine Tab-Gruppe (Abräumen wirkt nur auf
**Container-Ebene**, `rootSplit.children` — drei andere Verfahren meldeten Erfolg und taten
nichts), und `livePreview: false` blieb nach den Split-Bildern gesetzt, sodass jedes
Folgebild Quelltext statt Modell zeigte (jeder Shot stellt seine Voraussetzungen jetzt
selbst her).

**Sichtbar wurde die Kette erst auf Screenshots des GANZEN Fensters** — an den Messwerten
sah jede Stufe wie ein Renderer-Problem aus. Wer hier weitermacht: nach jedem Lauf ein
Vollbild ansehen, nicht nur die Zahlen lesen.

**Trotzdem gilt weiter: `--only <name>` nach frischem Obsidian-Start.** Jeder Lauf
hinterlässt Zustand; der Sammellauf ist nicht als stabil belegt. Und vor dem Committen die
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
| `code-and-render.png` | feature | `README.md` (Usage) | Zwei Bereiche nebeneinander: links der **Quelltext** des `3d`-Blocks (`file:`, `title:`, `height:` lesbar), rechts dieselbe Notiz gerendert. Beantwortet „wie schreibt man das" und „was kommt dabei heraus" in einem Bild. ⚠️ Der aktuelle Stand trägt noch den doppelten Titel (Dateiname + H1), weil das Split-Rezept das instabilste ist: von drei Versuchen nach `showInlineTitle: false` scheiterten zwei, der dritte vertauschte die Blätter (links gerendert statt Quelltext). Inhalt schlägt Kosmetik — die ältere Aufnahme trifft die Aussage, die neuere nicht. |
| `hover-toolbar.png` | feature | `README.md` (Saving a camera angle) | Die Werkzeugleiste, die beim Überfahren des Modells erscheint, mit **Fit**, **Save view**, **Clear view** und dem Stift **Edit model**. Eng auf das Modell und die Leiste beschnitten. |
| `sidebar-controls.png` | feature | `README.md` (Saving a camera angle) | Die Sidebar (Kommando **Open 3D view controls**) neben einem aktiven Modell: Kamerawerte und dieselben Aktionen als Schaltflächen. Kein leerer Zustand — **„Click a 3D model to control it here."** darf *nicht* zu sehen sein. |
| `saved-view.png` | feature | `README.md` (Saving a camera angle) | Notiz **Saved view**: die Zeile `view: 225,28,14` im Block **und** das entsprechend gedrehte Modell im selben Bild — die Aussage ist, dass der Blickwinkel in der Notiz steht. |
| `orbit.gif` | detail (aufgenommen als feature) | `README.md` (Features) | Eine Umkreisung des Modells samt Zoom, 6–8 s, ~800 px. Das eine Feature, das als Standbild nicht erzählbar ist. ⚠️ **Eingebettet als klickbare 380-px-Vorschau, nicht in voller Breite** (2026-08-18): `framesToGif` skaliert die Frames auf eine feste Zielbreite (800) und rechnet die Retina-Dichte dabei heraus — `image-scale` unterstellt jeder Datei unter `capture_width` aber eine dpr-2-Aufnahme und lässt deshalb nur 400 Anzeigebreite zu. Wer das GIF wieder breit einbetten will, muss es in 1200 px erzeugen (GIF-Budget 2048 KB prüfen, aktuell 1131 KB bei 800 px), nicht die Einbettung hochsetzen. |
| `edit-mode.png` | detail | `README.md` (Edit mode) | Edit-Modus aktiv: ein ausgewählter Knoten mit Gizmo, die Sidebar mit **Move**/**Scale**, den Zahlenfeldern für Translation und Skalierung, **Reset node** und **Save edits**/**Discard edits**. Der Knotenname (z. B. `Stairs`) muss lesbar sein. |
| `unapplied-edits.png` | detail | `README.md` (Edit mode) | Das Abzeichen **Unapplied edits** über dem Viewport, mit dem Modell dahinter — der Zustand „neben der Datei liegt eine `.edit.gltf`". Nutzt die Notiz **Edited** und ein **eigenes** Modell (`edited-floor.gltf`): läge die `.edit.gltf` neben dem gemeinsam genutzten Modell, trüge *jedes* Bild dieses Abzeichen. |
| `unknown-key.png` | detail | `README.md` (Block keys) | Notiz **Unknown key**: die Meldung unter dem Viewport, die `heigth:` als unbekannten Schlüssel benennt, mit dem gerenderten Modell darüber. Zeigt, dass ein Tippfehler nicht wie ein Plugin-Fehler aussieht. ⚠️ **Das Bild widerlegt eine bis 2026-08-18 geführte Annahme:** der Prüfling versteckt das Modell bei unbekanntem Schlüssel *nicht* — Meldung und Modell stehen beide da. GUI-Smoke B15 prüft genau diese Kombination (`hint` enthält `heigth` und `canvas > 0`) und ist trotzdem rot; er misst allerdings in einer Notiz mit **drei** Fehlerblöcken. Der Verdacht liegt damit beim Messpunkt, nicht am Plugin — offen, braucht einen Smoke-Lauf. |
| `settings.png` | detail | `README.md` (Configuration) | Der Einstellungen-Tab: **Default height**, **Show ground grid**, **Maximum live 3D views**, **Controls placement**, **Locked node prefixes**, **Auto-rotate**. |

## Reproduktion

⚠️ **Vor dem Quit koordinieren — Obsidian ist geteilte Infrastruktur.** Dieses Rezept
braucht den frischen Start (ein Bild pro Start, jeder Lauf hinterlässt Zustand); Mitnutzen ist
hier keine Alternative. Aber Obsidian ist Single-Instance: der Quit trifft die Instanz, an der
möglicherweise eine andere Session arbeitet, und zerstört deren Zustand. Der eigene Lauf ist
danach sauber grün; der Schaden fällt nicht auf.

```bash
lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "belegt — erst fragen, wem"
```

Hört der Port, hängt jemand dran: **erst fragen, dann quitten.** ⚠️ Und die Prüfung ersetzt die
Frage nicht — sie zeigt aktive CDP-Treiber, aber nicht, wer ein Fenster offen hält oder auf den
Port wartet; am 2026-08-30 hätte sie einen zwei Stunden alten Reindex nicht gezeigt, denn der
hing an Ollama, nicht am Port.

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
