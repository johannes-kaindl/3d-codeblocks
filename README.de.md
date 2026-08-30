# 3D Codeblocks

3D-Artefakte (GLB, glTF, STL) in Obsidian ansehen — drehen, zoomen und schieben, ohne
die Notiz zu verlassen. 3D-Dateien verhalten sich wie PDFs: klicken zum Öffnen,
`![[…]]` zum Einbetten.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/3d-codeblocks?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/3d-codeblocks/releases)
[![Obsidian](https://img.shields.io/badge/obsidian-1.5.0%2B-purple)](https://obsidian.md)

> **Hinweis:** Diese Übersetzung folgt der englischen [`README.md`](README.md).
> Bei Abweichungen gilt die englische Fassung.

<p align="center"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/hero.png" width="820" alt="Ein Grundriss-Modell in einer Obsidian-Notiz, Waende und Raeume von oben sichtbar"></p>

## Features

- `.glb`-, `.gltf`- und `.stl`-Dateien in einem eigenen Tab öffnen oder mit `![[…]]`
  einbetten, so wie man ein PDF einbettet.
- Zwei Codeblöcke: `3d` für einen Dateiverweis mit optionalem Titel und optionaler
  Höhe, `gltf` für glTF-JSON direkt in der Notiz.
- Drehen, zoomen, schieben; **einen Kamerawinkel im Block speichern**, sodass die
  Ansicht mit der Notiz reist und im Git-Diff auftaucht — oder mit einer Kamera
  starten, die die Modelldatei selbst mitbringt.
- **Bearbeitungsmodus:** die obersten Knoten eines glTF-/GLB-Modells verschieben und
  skalieren. Änderungen landen in einer eigenen `.edit.gltf` — das Original wird nie
  verändert.
- Theme-treues Standardmaterial für STL, das selbst keines mitbringt.
- Keine dauerhafte Render-Schleife: gezeichnet wird nur, wenn sich etwas ändert.

<a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/orbit.gif"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/orbit.gif" width="380" alt="Das Modell wird in der Notiz umkreist und gezoomt"></a><br><sub>Klick auf die Vorschau zeigt die Schleife in voller Groesse</sub>

## Voraussetzungen

- **Obsidian 1.5.0** oder neuer.
- WebGL-Unterstützung im Renderer — auf dem Desktop Standard. Auf Mobilgeräten
  funktioniert es, aber große Modelle sind langsam und das Browser-Limit für
  gleichzeitige 3D-Ansichten ist früher erreicht.
- **Kein Draco.** Meshopt-komprimierte Dateien funktionieren; Draco-komprimierte können nicht
  gelesen werden (siehe [Unterstützte Formate](#unterstützte-formate)).

## Installation

**Aus Obsidian heraus.** Einstellungen → Community-Plugins → Durchsuchen → nach
*3D Codeblocks* suchen → Installieren, dann Aktivieren.

**Aus dem Quellcode**, für den aktuellen Entwicklungsstand: mit `npm install && npm run build`
bauen, dann `main.js`, `manifest.json` und `styles.css` nach
`<vault>/.obsidian/plugins/three-d-codeblocks/` kopieren.

## Verwendung

### Vier Wege, ein Modell zu zeigen

**1. Eine Datei öffnen.** Klick auf eine `.gltf`, `.glb` oder `.stl` im Dateibaum — sie
öffnet sich in einem eigenen Tab, in voller Größe und vollständig bedienbar.

**2. Eine Datei einbetten** mit der normalen Wiki-Embed-Syntax. `|<höhe>` setzt eine
feste Höhe:

```markdown
![[weltmodell/3d/eg.gltf]]
![[weltmodell/3d/eg.gltf|300]]
```

**3. Der `3d`-Codeblock** — ein Dateiverweis mit optionalem Titel und optionaler Höhe.
Am besten, wenn mehrere Modelle in einer Notiz stehen sollen (etwa jedes Geschoss eines
Gebäudes), jedes mit eigener Beschriftung:

````markdown
```3d
file: weltmodell/3d/eg.glb
height: 420
title: Erdgeschoss
```
````

Nur `file:` ist Pflicht; ein Block, der nichts als einen Pfad enthält, geht auch.

**4. Der `gltf`-Codeblock** — glTF-**JSON** direkt in der Notiz, für kleine, von Hand
geschriebene Skizzenmodelle. (Binäres GLB passt nicht in einen Textblock; dafür eine
Datei nehmen.)

````markdown
```gltf
{ "asset": { "version": "2.0" }, "scenes": [], "nodes": [] }
```
````

<img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/code-and-render.png" width="820" alt="Links ein 3d-Codeblock im Editor, rechts das gerenderte Modell">

### Anleitungen

- [Ein 3D-Modell von Hand schreiben](docs/guide/writing-gltf-by-hand.md) *(englisch)* —
  ein Modell als Text in einer Notiz bauen und dabei lernen, jede `.gltf`-Datei zu lesen.
  Jedes Beispiel wird bei jedem Commit geprüft.

### Unterstützte Formate

| Endung | Anmerkung |
|---|---|
| `.glb`, `.gltf` | Materialien und Farben kommen aus der Datei |
| `.stl` | Das Format kennt keine Materialien; das Plugin setzt ein theme-treues Standardmaterial — außer die Datei bringt Flächenfarben mit |

Eine `.gltf` steht selten allein: die Geometrie liegt in einer `.bin` daneben, Texturen in
einem Ordner dabei. Diese Dateien werden aus dem Vault geladen, aufgelöst **relativ zur
Modelldatei** — ein Blender-Export funktioniert also, wenn der ganze Ordner im Vault
liegt. Was die Datei anfordert und im Vault nicht existiert, wird übersprungen und unter
dem Viewport benannt, statt einfach zu fehlen. Adressen im Netz werden nur geladen, wenn
**Externe Ressourcen erlauben** eingeschaltet ist.

**Meshopt-Kompression funktioniert, Draco nicht.** Der Meshopt-Decoder kann im
Haupt-Thread laufen, `EXT_meshopt_compression`-Dateien laden also wie jede andere — was
sich lohnt, weil Meshopt ein Modell oft auf einen Bruchteil schrumpft. Dracos Decoder ist
fest an einen Web-Worker gebunden, den Obsidians Renderer verbietet; solche Dateien werden
erkannt und in Klartext gemeldet, statt mit einem Parser-Fehler abzubrechen.
`gltfpack -cc` erzeugt Meshopt-Dateien.

### Block-Schlüssel

| Schlüssel | Pflicht | Bedeutung |
|---|---|---|
| `file:` | ja | Pfad zum Modell. Wird wie ein Wikilink aufgelöst (relativ, vault-absolut oder Kurzform) |
| `height:` | nein | Höhe des Ansichtsfensters in Pixeln; sonst greift die Einstellung |
| `title:` | nein | Beschriftung über dem Ansichtsfenster |
| `view:` | nein | Gespeicherter Kamerawinkel — ein Name (`front`, `back`, `left`, `right`, `top`, `bottom`, `iso`), drei Zahlen `azimut,elevation,distanz` oder `camera:<name>` für eine Kamera aus der Datei selbst |

Unbekannte Schlüssel werden unter dem Ansichtsfenster gemeldet statt stillschweigend
ignoriert — ein Tippfehler wie `heigth:` soll nicht wie ein Plugin-Fehler aussehen.

### Eine Kamera aus der Datei anfahren

Eine `.gltf` oder `.glb` kann eigene Kameras mitbringen — den Blickwinkel, den der Autor
des Modells für den richtigen hielt. `view: camera:<name>` startet dort:

```3d
file: haus.gltf
view: camera:Schnitt
```

Position, Blickrichtung und Bildwinkel kommen unverändert aus der Datei. Von da an lässt
sich wie gewohnt orbitieren, zoomen und schwenken — gedreht wird um den Punkt, auf den die
Kamera blickt, nicht um die Modellmitte. Eine Kamera, die einen Ausschnitt rahmt, behält
damit ihren Ausschnitt.

**Gesucht wird der Name, der in der Datei steht**, ohne Rücksicht auf Groß- und
Kleinschreibung: erst unter den Namen der Kamera-*Knoten* (in Blender der Objektname aus
dem Outliner), dann unter den Namen der Kamera-*Definitionen*. Namen mit Leerzeichen
funktionieren — `view: camera:Schnitt A` —, obwohl three.js sie beim Laden zu `Schnitt_A`
umschreibt; das Plugin liest die Datei, nicht die geladene Szene. Orthographische Kameras
werden gefunden, aber nicht benutzt: das Ansichtsfenster ist perspektivisch.

Ein Name, den es nicht gibt, wird unter dem Ansichtsfenster gemeldet — zusammen mit den
Namen, die die Datei anbietet — und das Modell stattdessen eingepasst, bleibt also sichtbar.

### Einen Kamerawinkel speichern

Das Modell in den gewünschten Winkel drehen, dann **Ansicht speichern** drücken — in
der Seitenleiste (Befehl **3D-Ansichtssteuerung öffnen**) oder über die Nadel, die beim
Überfahren des Modells erscheint. Der Winkel landet als `view:` im Codeblock, reist
also mit deiner Notiz und taucht in Git-Diffs auf. Die Modelldatei selbst wird nie
verändert.

**Ansicht speichern** schreibt immer Zahlen: auf einem Block mit `camera:` gedrückt,
ersetzt es den Verweis durch den Winkel, aus dem du gerade schaust.
**Ansicht löschen** entfernt den `view:`-Schlüssel wieder; **Einpassen** setzt die
Kamera zurück, ohne ihn anzurühren. Dieselben drei Aktionen gibt es auch als Befehle
(**Aktuelle Ansicht in Block speichern**, **Gespeicherte Ansicht löschen**, **Kamera
auf Modell einpassen**) — jeweils für das Modell, mit dem du zuletzt gearbeitet hast.
Einbettungen und geöffnete Dateien lassen sich genauso ausrichten und einpassen, haben
aber keinen Codeblock, in den gespeichert werden könnte.

Die Einstellung **Platzierung der Steuerung** entscheidet, wo die Schaltflächen
auftauchen: in der Seitenleiste, wenn sie offen ist, sonst in der Hover-Leiste
(Standard) — oder immer nur in einem von beiden.

<img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/hover-toolbar.png" width="820" alt="Die Werkzeugleiste ueber einem Modell: anheften, loesen, einpassen, bearbeiten">

<img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/sidebar-controls.png" width="820" alt="Die 3D-Sidebar neben einem Modell: Ansichts-Vorgaben, Save view, Clear view, Fit und Edit model">

<img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/saved-view.png" width="820" alt="Links der view:-Schluessel im Codeblock, rechts das entsprechend gedrehte Modell">

### Bearbeitungsmodus

Die obersten Knoten eines `.gltf`- oder `.glb`-Modells verschieben und skalieren — ein
Geschoss, eine Wand, ein Möbelstück — ohne Obsidian zu verlassen. Nicht verfügbar für
`gltf`-Codeblöcke (JSON in der Notiz) und STL, weil beiden die Knotenstruktur fehlt, auf
der der Editor arbeitet.

Den Bearbeitungsmodus startet die **Stift**-Schaltfläche (**Modell bearbeiten**) in der
Hover-Leiste oder dieselbe Schaltfläche in der 3D-Seitenleiste. Ein Klick wählt einen
Knoten aus — ein Gizmo erscheint — dann schaltet **Verschieben**/**Skalieren** um, was
das Gizmo tut, oder du tippst exakte Zahlen in die Felder für Translation und Skalierung
in der Seitenleiste. **Knoten zurücksetzen** betrifft nur die Auswahl;
**Änderungen speichern**/**Änderungen verwerfen** wirken auf die ganze Sitzung. Während
der Bearbeitung pausiert die Auto-Rotation, damit das Modell stillhält; sie läuft
weiter, sobald du den Modus verlässt.

**Originale werden nie verändert — Änderungen landen in einer `<name>.edit.gltf` (oder
`.edit.glb`) neben der Datei** und überschreiben eine gleichnamige, bereits vorhandene
Änderungsdatei. Bearbeitest du eine `.edit.`-Datei selbst, wird an Ort und Stelle
gespeichert — sie ist ja bereits eine Nutzeränderung, nicht das erzeugte Original.

Deshalb **zeigt der Betrachter weiter das Original**, sobald du den Bearbeitungsmodus
verlässt — deine gespeicherte Arbeit ist ein Änderungs*wunsch*, nicht das Modell selbst.
Eine kleine Marke **Nicht übernommene Änderungen** erscheint oben links, solange eine
Änderungsdatei neben dem Modell liegt, damit dieser Zustand sichtbar statt überraschend
ist. Sie verschwindet, sobald die Änderungen von dem, was das Original erzeugt, wieder
eingearbeitet wurden (oder sobald du die Änderungsdatei löschst).

Beim erneuten Betreten liest der Bearbeitungsmodus das frische Original neu ein und legt
die vorhandene Änderungsdatei wieder darüber, zugeordnet über den **Namen** des Knotens
(eine Notiz meldet „Vorhandene Änderungen für N Knoten geladen"). Genau das lässt
Änderungen eine Neuerzeugung überleben: lass das, was das Original erzeugt, erneut
laufen, und beim nächsten Betreten sind deine Verschiebungen und Skalierungen wieder da
— außer ein Knoten wurde umbenannt oder entfernt, dann listet eine Notiz auf, welche
Änderungen nicht mehr passen.

Verlässt du den Modus mit ungesicherten Änderungen, erscheint eine Rückfrage
(„Ungesicherte Änderungen verwerfen?" — **Verwerfen** oder **Weiter bearbeiten**); ein
schrittweises Rückgängig gibt es nicht, nur **Knoten zurücksetzen** für die aktuelle
Auswahl und **Änderungen verwerfen** für die ganze Sitzung.

**Gesperrte Knoten-Präfixe** (Einstellung, Standard `env__`) schützt Knoten über ihren
Namen — ein Knoten, dessen Name mit einem der kommagetrennten Präfixe beginnt, lässt
sich weder auswählen noch bearbeiten.

<table>
<tr>
<td><a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/edit-mode.png"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/thumbs/edit-mode.png" width="380" alt="Bearbeitungsmodus"></a><br><sub>Bearbeitungsmodus</sub></td>
<td><a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/unapplied-edits.png"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/thumbs/unapplied-edits.png" width="380" alt="Nicht uebernommene Aenderungen"></a><br><sub>Nicht uebernommene Aenderungen</sub></td>
</tr>
<tr>
<td><a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/unknown-key.png"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/thumbs/unknown-key.png" width="380" alt="Ein 3d-Block meldet einen unbekannten Schluessel unter dem Viewport, statt ihn zu ignorieren"></a><br><sub>Unbekannter Schluessel</sub></td>
<td><a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/settings.png"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/thumbs/settings.png" width="380" alt="Die Plugin-Einstellungen: Standardhoehe, Bodenraster, maximale aktive Ansichten, Platzierung der Bedienelemente, gesperrte Knoten-Praefixe"></a><br><sub>Einstellungen</sub></td>
</tr>
</table>

#### Grenzen

- Nur Translation und Skalierung — keine Rotation, mit Absicht (der Vertrag, dem dieser
  Editor folgt, braucht sie nicht, und es hält Gizmo und Datei-Diff einfach).
- Nur oberste Knoten, keine Mehrfachauswahl.
- Kein schrittweises Rückgängig; stattdessen Verwerfen/Zurücksetzen.
- STL und `gltf`-Codeblöcke sind nicht bearbeitbar.

**Bekannte Grenze:** die Knoten-Identität hängt an den glTF-Knotenindizes, die der
`GLTFLoader` von three.js über `parser.associations` meldet. In Dateien, in denen sich
mehrere oberste Knoten ein einziges Mesh teilen, kann diese Zuordnung mehrdeutig werden
— eine Eigenheit des `GLTFLoader`, nichts, was dieses Plugin steuert. Eine Fehlauswahl
ist inzwischen ausgeschlossen: Knoten mit mehrdeutigem Index sind schlicht nicht
auswählbar, ein Klick verschiebt also nie den falschen Raum. Dateien mit geteilten
Meshes zu bearbeiten bleibt dennoch nicht unterstützt — diese Knoten lassen sich gar
nicht bearbeiten. Ein Mesh pro Knoten vermeidet das; die meisten Erzeuger
(CAD-Exporte, Grundriss-Skripte) liefern Modelle ohnehin so.

## Konfiguration

| Einstellung | Standard | Bedeutung |
|---|---|---|
| Ansichtsmodus | Sofort bedienbar | Oder: Standbild, per Klick aktivieren |
| Standardhöhe | 400 px | Für Blöcke ohne `height:` |
| Auto-Rotation | aus | Dreht, bis du eingreifst |
| Bodengitter zeigen | aus | Referenzgitter unter dem Modell |
| Maximale Zahl aktiver 3D-Ansichten | 6 (Regler 0–12) | Ältere eingebettete Ansichten werden darüber hinaus zu Standbildern; 0 hebt die Grenze auf |
| Platzierung der Steuerung | Seitenleiste, wenn offen, sonst Leiste | Wo die Schaltflächen Speichern/Löschen/Einpassen erscheinen |
| Gesperrte Knoten-Präfixe | `env__` | Kommagetrennte Namenspräfixe, die vor Bearbeitung geschützt sind |
| Externe Ressourcen erlauben | aus | Ein Modell darf Dateien von http(s)-Adressen laden, nicht nur aus dem Vault |

Die letzte Einstellung gibt es, weil Browser die Zahl gleichzeitiger WebGL-Kontexte
begrenzen (etwa 8–16) und die ältesten stillschweigend abräumen. Statt das dem Zufall zu
überlassen, entscheidet das Plugin, welches eingebettete Ansichtsfenster zum Standbild
wird. Geöffnete Dateien (Weg 1) sind immer voll bedienbar und zählen nie gegen diese
Grenze.

## Funktionsweise

Erzeugte 3D-Ausgaben — ein Grundriss, ein Scan, ein CAD-Export — liegen meist neben der
Notiz, die sie bespricht, aber zum Anschauen muss man Obsidian verlassen. Dieses Plugin
hält sie an Ort und Stelle: Datei neu erzeugen, und die Ansicht aktualisiert sich ohne
Neustart.

Es gibt keine dauerhafte Render-Schleife. Ein Bild wird nur gezeichnet, wenn sich etwas
ändert — eine offene Notiz mit mehreren 3D-Blöcken kostet beim Lesen keine GPU-Zeit.
Blöcke bauen ihr Ansichtsfenster auf, wenn sie ins Sichtfeld scrollen, und geben es
wieder frei, wenn sie es verlassen.

Der Code ist so geschnitten, dass jede Schicht für sich testbar bleibt: `src/core/`
trägt die pure Logik (Konfigurations-Parsing, Formaterkennung, Kamera-Einpassung,
Kontext-Budget) und importiert weder `obsidian` noch `three` — erzwungen von
`check:pure`. `src/viewer/` kapselt three.js und weiß nichts von Obsidian.
`src/obsidian/` verbindet beide und besitzt den Lebenszyklus.

## Entwicklung

```bash
npm install
npm run dev     # Watch-Build
npm run gate    # lint + typecheck + tests + purity + bundle size
```

Entwurf und Plan: `docs/superpowers/specs/` und `docs/superpowers/plans/`.
Manuelle Testcheckliste: `docs/SMOKE.md`.

## Lizenz

AGPL-3.0-or-later
