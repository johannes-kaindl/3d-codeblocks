# 3d-codeblocks — Ansicht merken

**Datum:** 2026-07-25 · **Status:** Design freigegeben · **Baut auf:** `2026-07-24-file-native-viewing-design.md`

## 1. Zweck und Einordnung

Heute ist jede Ansicht flüchtig: Wer ein Modell dreht und die Notiz neu öffnet, sieht
wieder den automatischen Einpass-Blick. Dieser Ausbau gibt dem Codeblock ein
**Gedächtnis** — der gewählte Blickwinkel wird als `view:`-Key in den Block geschrieben
und beim nächsten Öffnen wiederhergestellt.

**Die 3D-Datei wird dabei nie angefasst.** Das Plugin schreibt ausschließlich in den
Codeblock. Damit bleibt es ein Viewer im ursprünglichen Sinn: die Geometrie-Wahrheit
liegt weiterhin außerhalb (im Konsumenten-Repo, bei `outpost-worldbuilding` in
`data.py`), das Plugin hält nur fest, *wie* darauf geschaut wird.

**Scope-Entscheidung (Brainstorm 2026-07-25):** Das Plugin bleibt ein **generisches
Viewer/Editor-Plugin für den Community-Store**. Jede Loop-Logik (Intent-Rückführung,
`data.py`-Regenerierung) gehört ins Konsumenten-Repo, nicht hierher. `outpost-worldbuilding`
ist ein Konsument der generischen Fähigkeiten, kein Auftraggeber für Sonderwege.

**Zerlegung des Vorhabens „Editor-Modus + Export/Import"** in vier Teilprojekte, dieses
Dokument beschreibt ausschließlich TP1:

| # | Teilprojekt | Inhalt | Status |
|---|---|---|---|
| **1** | **Ansicht merken** | Bedienoberfläche + Rückschreib-Mechanismus + `view:` | **dieses Dokument** |
| 2 | Rein & raus | Import: Datei → fertiger Block · Export: Ansicht → PNG | offen |
| 3 | Szene kuratieren | Nodes ein-/ausblenden, benannte Presets | offen |
| 4 | Annotationen | Hotspots im 3D-Raum mit Wikilinks | offen |

TP1 zuerst, weil es die einzige echte Unbekannte enthält: Schreibt das Plugin
zuverlässig in Notizen, ohne fremde Zeilen zu beschädigen? TP3 und TP4 sind danach nur
noch Anwendungen desselben Mechanismus auf derselben Bedienoberfläche.

**Getroffene Entscheidungen:**

- **Codeblock als einziger Speicherort.** Kein Sidecar, keine `data.json` — der Zustand
  ist sichtbar, in git diffbar, mit der Notiz teilbar und überlebt kein Verschieben
  unbemerkt, weil er im verschobenen Text mitwandert.
- **Hybrid-Schreibweg** (Editor-API wenn möglich, sonst `vault.process`), damit Strg+Z
  im häufigsten Fall funktioniert.
- **Orbit-relatives Format statt Weltkoordinaten**, damit gespeicherte Ansichten eine
  Regenerierung des Modells überleben.
- **Kein Geometrie-Editing, kein GLB-Export** in diesem Teilprojekt.

**Kit-first-Befund:** Das `obsidian-kit` hat keinen passenden Baustein (nur
`collapsibleSection`, `ClockPort`). Übernommen wird stattdessen
`vim-dojo/src/hudPlacement.ts` (`resolveHudTarget`, 26 Zeilen pure Funktion) — mit uns
ist das `n=2`, also **Kit-Kandidat** für den nächsten `drift-audit`; REGISTRY-Eintrag
ist beim Abschluss zu ergänzen. `vim-dojo/src/HudMount.ts` wird als *Prinzip*
übernommen (Lifecycle hinter einem DOM-Port), nicht als Code — es hängt an Preact,
Missionen und `editorElFor(notePath)`.

## 2. Bedienoberfläche

### 2.1 Sidebar-View

Eine neue `ItemView` in der rechten Leiste (Icon `box`) zeigt die Bedienelemente für den
**aktiven Viewport**. Ohne aktives Modell zeigt sie einen Empty-State nach
UI-STANDARD §8 („Click a 3D model to control it here.").

**Die Oberfläche ist durchgängig englisch**, wie der gesamte Bestand („View mode",
„Default height"). Kein i18n — das Plugin nutzt die Kit-i18n-Engine bislang nicht, und
sie hier einzuführen wäre eine eigene Entscheidung außerhalb dieses Teilprojekts.

### 2.2 Aktiver Viewport

Bei mehreren Modellen in einer Notiz (Weltmodell-Note mit fünf Etagen) muss feststehen,
worauf sich die Sidebar bezieht. **Aktiv ist der zuletzt benutzte Viewport.** Der
Mechanismus existiert bereits: `onInteract` meldet heute jede echte Nutzerinteraktion
(`OrbitControls`-`start`, Doppelklick) ans Kontext-Budget — künftig setzt dieselbe
Meldung zusätzlich den aktiven Viewport. Autorotate zählt weiterhin nicht als
Interaktion.

Der aktive Block trägt einen dezenten Rahmen (`--interactive-accent`), damit sichtbar
ist, worauf die Bedienung wirkt.

### 2.3 Toolbar bei geschlossener Sidebar

Ist die Sidebar nicht sichtbar, erscheint bei Mauskontakt eine kleine Icon-Leiste oben
rechts im Viewport — **zusätzlich dauerhaft bei Tastaturfokus und auf Touch-Geräten**,
damit sie dort nicht unerreichbar ist. Die Entscheidung trifft eine pure Funktion:

```
resolvePanelTarget(placement, panelVisible) → 'panel' | 'toolbar' | 'none'

placement: 'sidebar' | 'toolbar' | 'auto'      (Setting, Default 'auto')
  'sidebar' → nur Sidebar (nichts, wenn geschlossen)
  'toolbar' → immer die Leiste im Viewport
  'auto'    → Sidebar wenn sichtbar, sonst Leiste
```

Anders als bei `vim-dojo` gibt es **keinen `dismissed`-Zustand**: Dort schwebt die Box
über dem Editortext und muss wegklickbar sein; unsere Leiste liegt in unserem eigenen
Kasten und verdeckt nichts Fremdes.

### 2.4 Aktionen

| Aktion | Beschriftung | Wirkung | Icon | Befehl |
|---|---|---|---|---|
| Ansicht übernehmen | `Save view` | schreibt `view:` in den Codeblock | `pin` | „Save current view to block" |
| Ansicht zurücksetzen | `Clear view` | entfernt `view:` wieder | `pin-off` | „Clear saved view" |
| Einpassen | `Fit` | Kamera auf den Auto-Blick, ohne zu schreiben | `maximize` | „Fit camera to model" |

Alle drei zusätzlich als hotkey-fähige Befehle in der Command Palette, wirkend auf den
aktiven Viewport. Icon-Buttons tragen `aria-label` (UI-STANDARD §2), Icons kommen über
`setIcon` aus dem Lucide-Set, DOM ausschließlich über `createEl`/`createDiv`.

### 2.5 Wege ohne Block

`![[…]]`-Embed und `FileView` haben keinen Blocktext, in den geschrieben werden könnte.
Dort sind „Save view" und „Clear view" **deaktiviert** mit erklärendem Tooltip
(„The view can only be saved in a `3d` code block"); „Fit" bleibt
nutzbar. Der Zustand ist dort bewusst flüchtig — das ist die ehrliche Auflösung der
Asymmetrie der vier Wege, kein Versehen.

## 3. Das `view:`-Format

````
```3d
file: weltmodell/3d/eg.glb
view: iso            ← benannt
view: 45,30,1.2      ← frei: Azimut°, Höhe°, Distanzfaktor
```
````

Modelle sind Y-up (wie in Stufe 1 festgelegt).

| Wert | Bereich | Bedeutung |
|---|---|---|
| Azimut | 0–359° | Drehung um die Hochachse; `0` = von vorn (+Z), wachsend nach rechts |
| Höhe | −89…89° | `0` = auf Augenhöhe, `90` = von oben |
| Distanzfaktor | > 0 | Vielfaches der automatischen Einpass-Distanz; `1` = wie ohne `view:` |

Die Höhengrenze bei ±89° ist notwendig, nicht kosmetisch: bei exakt 90° kippt der
Aufwärtsvektor von `OrbitControls` um.

Der Distanzfaktor multipliziert die von `fitCamera()` berechnete Distanz. Deshalb bleibt
eine gespeicherte Ansicht sinnvoll, wenn dasselbe Modell in anderer Größe neu generiert
wird — der genaue Grund, warum das Format relativ und nicht absolut ist.

**Benannte Ansichten** sind Abkürzungen mit Distanzfaktor 1:

| Name | Azimut | Höhe |
|---|---|---|
| `front` | 0 | 0 |
| `back` | 180 | 0 |
| `left` | 270 | 0 |
| `right` | 90 | 0 |
| `top` | 0 | 89 |
| `bottom` | 0 | −89 |
| `iso` | 45 | 30 |

**Beim Übernehmen wird der Name geschrieben, wenn er passt** (±2°, Distanz ±5 %) — also
`view: iso` statt `view: 44,31,1.03`. Das hält die Notiz lesbar und ist der Grund,
warum das Format überhaupt Namen kennt.

**`iso` wird zur einen Wahrheit des Auto-Blicks.** Die heutige Konstante
`DIRECTION = (1, 0.8, 1)` in `camera-fit.ts` entspricht Azimut 45°, Höhe 29,5°.
Künftig leitet `fitCamera` seine Richtung aus `NAMED_VIEWS.iso` ab; „ohne `view:`" und
„`view: iso`" sind damit definitionsgemäß identisch. Preis: eine unsichtbare
Verschiebung von 29,5° auf 30°.

**Bewusst nicht im Format:** Pan-Versatz (das Ziel bleibt die Modellmitte), Sichtfeld,
orthografische Projektion. Alle drei bleiben rückwärtskompatibel nachrüstbar.

## 4. Schreibweg

### 4.1 Purer Kern

```
applyViewKey(blockQuelle, spec | null) → neueQuelle
```

Ersetzt eine vorhandene `view:`-Zeile an Ort und Stelle, fügt sie sonst direkt hinter
der `file:`-Zeile ein (bzw. hinter der Pfad-Kurzform) und entfernt sie bei `null`.
Kommentare, Zeilenreihenfolge, Anführungszeichen und unbekannte Keys bleiben
unangetastet. Reiner Text→Text-Umbau; hier liegt die Testlast.

### 4.2 Transport (Hybrid)

Position im Dokument kommt aus `ctx.getSectionInfo(el)` (Start-/Endzeile des Blocks):

1. **Notiz in einem sichtbaren Editor offen** → `editor.replaceRange`. Die Änderung
   liegt in Obsidians Undo-Historie, Strg+Z wirkt wie erwartet.
2. **Sonst** → `vault.process(file, …)`. Atomar, funktioniert auch im Lesemodus.

### 4.3 Die nicht verhandelbare Sicherung

Vor **jedem** Schreiben wird geprüft, ob die Zeilen an der gemerkten Position aktuell
noch der Block sind, der gerendert wurde. `getSectionInfo` kann veraltet sein, wenn
zwischenzeitlich getippt wurde; ohne diese Prüfung würde das Plugin fremde Zeilen
überschreiben. Das ist der gefährlichste denkbare Fehler dieses Vorhabens und wird
durch Vergleich statt durch Vertrauen ausgeschlossen: Stimmt der Text nicht überein,
wird **nichts** geschrieben und eine `Notice` erklärt warum.

### 4.4 Was der Nutzer erlebt

Nach dem Übernehmen erscheint die Notice „View saved", und der Block baut sich einmal
kurz neu auf — unvermeidlich, weil sich die Blockquelle geändert hat. Die Modelldatei
kommt dabei aus dem Cache, es wird nichts neu geladen.

Da Undo im `vault.process`-Fall nicht greift, ist „Ansicht zurücksetzen" kein Komfort,
sondern die Rückfahrkarte.

## 5. Fehlerbehandlung

| Fall | Verhalten |
|---|---|
| `getSectionInfo` liefert `null` (Popover, PDF-Export, verschachtelter Kontext) | Speicher-Knöpfe deaktiviert, Tooltip nennt den Grund |
| Notiz hat sich seit dem Rendern geändert | Abbruch, nichts geschrieben, Notice „Note changed — view not saved" |
| Datei schreibgeschützt / IO-Fehler | `Notice` mit der Fehlermeldung, Viewer läuft weiter |
| Kein aktiver Viewport | Sidebar zeigt Empty-State; Befehle melden „No active 3D model" |
| `view:` unlesbar (von Hand getippt) | Hinweiszeile über den bestehenden `warnings`-Weg („`view`: unknown view — use front, back, left, right, top, bottom, iso or three numbers"), automatische Einpassung |
| Embed / FileView (kein Block) | Speichern deaktiviert, Einpassen bleibt |

Grundsatz aus Stufe 1 bleibt: **Eine kaputte Ansichtsangabe darf nie ein leeres
Kästchen erzeugen** — das Modell ist immer zu sehen.

## 6. Komponenten

**Neu in `core/` (pur, ohne three.js, ohne Obsidian):**

| Datei | Inhalt |
|---|---|
| `view-spec.ts` | `ViewSpec`, `NAMED_VIEWS`, `parseView`, `formatView`, `viewToCamera`, `cameraToView` |
| `block-edit.ts` | `applyViewKey` |
| `panel-target.ts` | `resolvePanelTarget` (übernommen von `vim-dojo/hudPlacement.ts`) |
| `active-viewport.ts` | `ViewportController`-Interface + Registry: wer ist aktiv, wer wird benachrichtigt — gespeist aus `onInteract`. Liegt in `core/`, weil es keine Obsidian-API braucht und `check-pure` es dort bewacht |

**Erweitert:** `block-config.ts` (`view`-Key + Warnung), `settings-types.ts`
(`panelPlacement`, validiert nach dem bestehenden Einzelfeld-Muster statt per Spread),
`camera-fit.ts` (Richtung aus `NAMED_VIEWS.iso`).

**Neu in `obsidian/` (dünne Adapter):**

| Datei | Inhalt |
|---|---|
| `control-panel.ts` | Sidebar-`ItemView` |
| `viewport-toolbar.ts` | Hover-Leiste im Stage |
| `block-writer.ts` | Hybrid-Transport plus Text-Übereinstimmungsprüfung |

**Erweitert:** `viewport.ts` (`setView`/`getView`), `viewer-host.ts` und
`block-child.ts` (Kamerazugriff und Blockposition durchreichen), `main.ts` (View
registrieren, drei Befehle), `settings.ts` (Placement-Auswahl), `styles.css`.

**Die UI sieht three.js nie.** Sidebar und Toolbar sprechen ausschließlich gegen ein
schmales Interface:

```
interface ViewportController {
  getView(): ViewSpec;
  applyView(spec: ViewSpec): void;
  canSave(): boolean;
  save(spec: ViewSpec | null): Promise<void>;
}
```

Damit bleiben beide ohne WebGL testbar, und TP3/TP4 hängen sich später an dieselbe
Schnittstelle.

**Keine neue Abhängigkeit** — alles eigener Code auf vorhandenen APIs. Die Bundle-Größe
(586 KB) bleibt, was für die Store-Einreichung zählt.

## 7. Tests

Vitest nach bestehendem Muster (Skill `obsidian-plugin-test-pattern`, Obsidian-Mock aus
`obsidian-kit/testing`).

| Einheit | Fälle |
|---|---|
| `view-spec` | Namen, Zahlen, Grenzwerte, Müll-Eingaben; Rundreise Kamera → Spec → Kamera; Namens-Erkennung an der Toleranzgrenze; Verhalten an der 89°-Kante; Distanzfaktor bei skaliertem Modell |
| `block-edit` | einfügen, ersetzen, entfernen; Pfad-Kurzform ohne `file:`; Kommentare und unbekannte Keys überleben; doppelte `view:`-Zeilen |
| `panel-target` | vollständige Wahrheitstabelle (3 Einstellungen × 2 Sichtbarkeiten) |
| `block-writer` | Editor-Pfad, Vault-Pfad, **Abbruch bei verändertem Text** (der wichtigste Test des Vorhabens), `getSectionInfo === null` |
| `active-viewport` | Wechsel zwischen zwei Viewports, Abmeldung beim Entladen |
| `block-config` | `view`-Key wird gelesen; unbekannter Wert erzeugt Warnung, keinen Fehler |

## 8. GUI-Smoke (Ergänzung zu Stufe 1)

Im `outpost`-Vault von Hand zu prüfen — das kann kein Unit-Test:

1. Modell drehen → „Ansicht übernehmen" → `view:`-Zeile erscheint im Block, Bild bleibt
   nach dem Neuaufbau gleich.
2. Notiz schließen und neu öffnen → dieselbe Ansicht.
3. Nahe an `top` drehen → im Block steht `view: top`, nicht `0,88,1.01`.
4. Im Editor übernehmen → Strg+Z macht es rückgängig.
5. Im Lesemodus übernehmen → funktioniert, „Zurücksetzen" entfernt es wieder.
6. Fünf Etagen in einer Notiz → der Rahmen folgt dem zuletzt gedrehten Modell, die
   Sidebar bezieht sich sichtbar darauf.
7. Sidebar schließen → Hover-Leiste erscheint; Sidebar öffnen → Leiste verschwindet.
8. `![[haus.glb]]`-Embed und FileView → Speichern deaktiviert mit Tooltip, Einpassen
   funktioniert.
9. `view: quatsch` von Hand tippen → Hinweiszeile, Modell trotzdem sichtbar.
10. Während der Viewer offen ist, die Notiz in einem zweiten Fenster ändern, dann
    übernehmen → Abbruch mit Meldung, Notiz unbeschädigt.

## 9. Bewusst nicht enthalten (YAGNI)

- **Geometrie-Editing und GLB-Export** — würde das Plugin vom Viewer zum Werkzeug machen
  und die Geometrie-Wahrheit verdoppeln. Frühestens nach TP3/TP4 erneut zu bewerten.
- **Pan-Versatz im `view:`-Format** — kostet die Robustheit gegen Regenerierung.
- **Sidecar-Dateien oder `data.json`-Zustand** — unsichtbar, nicht diffbar, bricht beim
  Verschieben.
- **Preact oder ein anderer UI-Rahmen, zentraler State-Container** — die
  Bedienoberfläche ist zu klein dafür, und das Bundle ist für den Store bereits groß.
- **Kamerafahrten, Animationen, mehrere gespeicherte Ansichten pro Block** — TP3 klärt
  Presets; alles Weitere ist Spekulation.
- **Ansichts-Gedächtnis für Embed und FileView** — dort fehlt das Substrat; ein
  Ersatzspeicher wäre genau die unsichtbare Zweitwahrheit, die dieses Design vermeidet.
