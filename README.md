# 3d-codeblocks — Seed

**Status: Seed, kein Plan.** Angelegt 2026-07-23 aus der outpost-worldbuilding-Session.
Dieses Dokument hält Idee, Bedarf und Vorwissen fest, damit Jay hier ein eigenes
`brainstorm → spec → plan` starten kann. Es ist bewusst KEIN Scaffold — die
Plugin-Struktur entsteht erst nach der Spec.

## Die Idee

Ein Obsidian-Plugin, das 3D-Inhalte direkt in Notizen rendert — interaktiv
(Orbit/Zoom/Pan) statt als statisches Bild. Zwei Stufen:

1. **Artefakt-Viewer (erster Meilenstein):** generierte 3D-Dateien (GLB, ggf.
   STL) aus einem Codeblock heraus anzeigen, z.B.:

   ````markdown
   ```3d
   file: weltmodell/3d/eg.glb
   ```
   ````

2. **Quellcode-Renderer (Ausbaustufe):** `scad`- und `x3d`-Codeblöcke live
   rendern — OpenSCAD-Quelltext bzw. X3D-XML steht *in* der Notiz und wird beim
   Anzeigen zu einem WebGL-Viewport. Das ist die eigentliche Lücke im
   Obsidian-Ökosystem: bestehende 3D-Plugins zeigen nur statische Dateien,
   keinen Quellcode.

## Der Bedarf (Erstkonsument: outpost-worldbuilding)

Im Repo `outpost-worldbuilding` (Hybrid Code+Vault) entsteht ein iterativer
Weltmodell-Loop: `data.py` (Geometrie-SSOT) → generierte Etagen-Grundrisse (SVG)
+ 3D-Views (GLB) → Feedback in einer Weltmodell-Note → Geometrie-Verfeinerung.
Spec: `outpost-worldbuilding/docs/superpowers/specs/2026-07-23-grundriss-loop-design.md`.

Der Loop erzeugt `weltmodell/3d/{keller,eg,og,turm,haus}.glb`. Bis dieses Plugin
existiert, werden die per Community-Plugin („3D Embed") oder extern betrachtet —
dieses Plugin ersetzt das mit einem integrierten, flüssigen Viewer.

**Wichtige Architektur-Entscheidung aus der Diskussion 2026-07-23:** Das Plugin
ist ein **Viewer für generierte Artefakte, kein Editor-Substrat**. Die
Geometrie-Wahrheit bleibt `data.py` im Konsumenten-Repo; editierbare
scad/x3d-Codeblöcke als SSOT wurden verworfen (Zweitwahrheit-Drift, und die
SDXL-Anker-Pipeline braucht benannte Python-Objekte mit Semantik). Für die
Ausbaustufe heißt das: Codeblock-Rendering ja — aber Codeblöcke, die *im Vault
als Illustration/Skizze leben*, nicht als Quelle der Pipeline-Geometrie.

## Anforderungen (aus Konsumenten-Sicht)

- GLB aus Vault-Pfad rendern, Orbit-Steuerung, sinnvolle Default-Kamera.
- Theme-bewusst: Viewport-Hintergrund passt zu hellem UND dunklem Obsidian-Theme.
- Performt in einer Note mit 4–5 Viewports (eine Note = alle Etagen).
- Regenerierte Dateien (gleicher Pfad, neuer Inhalt) ohne Obsidian-Neustart
  neu laden (Cache-Invalidierung über mtime o.ä.).
- Desktop first; Mobile nice-to-have (der WASM-Pfad hielte es offen).

## Technisches Vorwissen (aus Gemini-Recherche, 2026-07-23, ungeprüft)

- **API-Kern:** `registerMarkdownCodeBlockProcessor("3d" | "scad" | "x3d", …)` —
  dasselbe Muster wie Mermaid/Dataview.
- **OpenSCAD-Rendering, zwei Pfade:** (a) `openscad-wasm` (Manifold-Engine) im
  Prozess — kein lokales OpenSCAD nötig, mobile-fähig; (b) CLI-Wrapper via
  `child_process` + STL-Import — voller Feature-Support (`use`/`include`),
  schneller Prototyp, desktop-only.
- **X3D:** X_ITE (npm) oder X3DOM — XML-String rein, fertiges Canvas mit
  Orbit-Steuerung raus.
- **Bekannte Fallstricke:** (1) Obsidian zerstört/erneuert Codeblock-DOM beim
  Tippen ständig → WebGL-Kontexte und three.js-Szenen sauber `dispose()`n,
  sonst Speicherleck in Minuten. (2) `ResizeObserver` für Pane-Resizes.
  (3) Re-Rendering im Live-Preview debounien (300–500 ms).

## Dach-Konventionen (verbindlich, vor der Spec lesen)

- `../AGENTS.md` — Kit-first-Regel: vor jedem Problem `../REGISTRY.md` +
  `obsidian-kit` prüfen.
- `../UI-STANDARD.md` — Obsidian-nativ first, nur Theme-CSS-Variablen.
- Test-Setup: Skill `obsidian-plugin-test-pattern` (vitest + Kit-Obsidian-Mock).
- Erst-Release: Skill `plugin-release-setup` im Dach.
- Settings später zweigleisig deklarativ (siehe REGISTRY „Zweigleisige
  deklarative Settings" — Kit-Kandidat mit 2 Exemplaren).

## Offene Fragen für den Brainstorm

- Engine-Wahl: three.js direkt vs. X_ITE für alles vs. Mix je Blocktyp?
- Ein Codeblock-Typ `3d` mit `file:`-Config vs. eigene Typen pro Format?
- Wie viel Viewer-Konfiguration im Codeblock (Kamera, Hintergrund, Autorotate)?
- WASM- vs. CLI-Pfad für OpenSCAD im ersten Wurf (falls Stufe 2 früh kommt)?
- Abgrenzung zum bestehenden „3D Embed"-Plugin: ersetzen oder koexistieren?
