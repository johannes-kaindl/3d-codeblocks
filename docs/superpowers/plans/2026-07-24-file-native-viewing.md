# Datei-nativer Ausbau — Implementation Plan

> Roadmap für die Inline-Ausführung. TDD, Gate nach jeder Task. Spec:
> `docs/superpowers/specs/2026-07-24-file-native-viewing-design.md`.

**Global Constraints** (wie Stufe 1): keine Node-APIs, keine Worker, nur Theme-CSS-Variablen,
Präfix `tdcb-`, `src/core/**` frei von obsidian/three (`check:pure`), TDD, Commit je Task.

## Task-Reihenfolge (sequenziell — Task 1 ist Fundament)

### Task 1 — core-Erweiterungen (pure, TDD)
- `src/core/embed-src.ts`: `parseEmbedSrc(src) → { path, height? }`. Trennt `datei.gltf|400`.
  Tests: ohne Pipe, mit Höhe, Nicht-Zahl nach Pipe (Höhe ignoriert), Whitespace.
- `view-model.ts`: neuer Zustand `{kind:"invalid-gltf-json"}` → „The glTF code is not valid JSON."
- `settings-types.ts`: `MAX_CONTEXTS_LIMIT` 16→12; `clampContexts` erlaubt **0** (0=off).
  Test: 0 bleibt 0, 13→12, Default 6.
- `context-budget.ts`: `pickEvictions` → bei `limit === 0` immer `[]`.
  Test: limit 0 verdrängt nie, auch bei 20 aktiven.

### Task 2 — `ViewerHost` extrahieren (Refactor)
- `src/obsidian/viewer-host.ts`: nimmt `mount`/`degradeToPoster`/`reactivate`/`show`/
  `refreshColors` aus `ModelBlock`. API: `constructor(stage, message, deps)`,
  `render(bytes, format, opts?)`, `showError(state)`, `refreshColors()`, `dispose()`.
  `deps.managed` (bool): true → Poster/Budget; false → immer interaktiv, kein Budget.
- `block-child.ts`: wird Adapter — Config parsen, Datei auflösen, `modify`-Abo,
  Observer; delegiert an `ViewerHost`. Die bisherige Byte→Viewport-Logik ist weg.
- Bestehende `block-child`-Tests: anpassen/verschieben nach `viewer-host.test.ts` wo sie
  jetzt hingehören; `block-child` behält Config-/Auflösungs-/modify-Tests. **Alle grün.**

### Task 3 — `gltf`-Codeblock
- `src/obsidian/gltf-block.ts`: `GltfBlock extends MarkdownRenderChild`. `onload`:
  Box bauen, `JSON.parse(source)` in try/catch → bei Fehler `host.showError(invalid-gltf-json)`,
  sonst `host.render(encode(source), "gltf")`. `managed: true`.
  Tests: gültiges JSON → render aufgerufen (Fake-Host); kaputtes JSON → showError, kein render.

### Task 4 — Embed-Handler
- `src/obsidian/embed.ts`: `registerModelEmbeds(plugin, deps)` → `registerMarkdownPostProcessor`.
  Callback: `.internal-embed`-Spans, `src` auf 3d-Endung prüfen (`parseEmbedSrc` +
  `detectFormat`), Span leeren, `MarkdownRenderChild` mit Box + `ViewerHost` anhängen,
  Datei via `resolveModelPath`. `managed: true`.
  Test: Postprocessor-Logik über einen Fake-Container mit einem `.internal-embed`-Kind;
  Nicht-3d-src wird übersprungen. (Selektor-Verhalten im Smoke.)

### Task 5 — `ModelFileView`
- `src/obsidian/file-view.ts`: `ModelFileView extends FileView`. `getViewType`/`getIcon`
  ("box")/`getDisplayText`. `onLoadFile(file)` → `readBinary` → `detectFormat` →
  `host.render(managed:false)`; `onUnloadFile` → `host.dispose()`.
  Test: `onLoadFile` ruft render mit managed:false; `onUnloadFile` disposet (Fake-Host).

### Task 6 — Slider + main.ts Verdrahtung
- `settings.ts`: „Maximum live 3D views" → `addSlider(0,12,1)` + `setDynamicTooltip`.
- `main.ts`: `registerMarkdownCodeBlockProcessor("gltf", …)`, `registerModelEmbeds(...)`,
  `registerView` + `registerExtensions(["gltf","glb","stl"], VIEW_TYPE)`. FileView bekommt
  `managed:false`, Rest `managed:true`. `refreshColors`/`modify` erreichen auch die neuen Hosts.
- Ladetest (CJS-Kopie) erweitern: `gltf`-Processor + View registriert.

### Task 7 — Doku + Install
- README: die vier Wege dokumentieren, Slider erklären.
- `docs/SMOKE.md`: die fünf neuen Punkte aus Spec §7.
- REGISTRY (Dach): Eintrag um FileView/Embed/gltf-Wege ergänzen.
- Rebuild + nach outpost installieren.

## Self-Review
Spec §2 Kern → T2 · §3.1 gltf → T3 · §3.2 embed → T1(embed-src)+T4 · §3.3 fileview → T5 ·
§4 slider → T1(settings)+T6 · §5 Fehler → T1(view-model)+T3 · §6 Tests → jede Task.
