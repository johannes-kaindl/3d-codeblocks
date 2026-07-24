# 3d-codeblocks — Datei-nativer Ausbau

**Datum:** 2026-07-24 · **Status:** Design freigegeben · **Baut auf:** `2026-07-23-glb-viewer-design.md` (Stufe 1)

## 1. Zweck

Stufe 1 zeigt Modelle nur über den ` ```3d file: `-Codeblock. Dieser Ausbau macht
das Plugin **datei-nativ** — 3D-Dateien verhalten sich so, wie Obsidian es für PDFs
tut: anklicken öffnet sie, `![[…]]` bettet sie ein. Dazu ein Codeblock, in dem
glTF-Quelltext direkt steht.

Vier Wege, ein Modell zu zeigen (alle über denselben Render-Kern):

| Weg | Datenquelle | Aufhänger | Status |
|---|---|---|---|
| ` ```3d file: ` | Vault-Datei | `MarkdownRenderChild` | existiert (Stufe 1) |
| ` ```gltf ` (Code) | Codeblock-Text | `MarkdownRenderChild` | neu |
| `![[datei.gltf]]` | Vault-Datei | Embed-Postprocessor | neu |
| Datei öffnen | Vault-Datei | `FileView` | neu |

**Getroffene Entscheidungen (Brainstorm 2026-07-24):**
- **` ```3d ` bleibt, koexistiert** mit `![[…]]`. Der Block kann Titel/Höhe pro Modell
  und mehrere Modelle in einer Notiz (Weltmodell-Note); `![[…]]` ist der schnelle Weg
  für ein einzelnes. Keine bestehende Notiz bricht.
- **Default-Ansichtsmodus bleibt „sofort interaktiv"** (Nutzerentscheidung) — der
  „Standbild, Klick aktiviert"-Modus bleibt als Setting.
- **Slider nativ** über `Setting.addSlider()`, kein Kit-Baustein (das Kit hat keinen;
  Obsidian bringt `SliderComponent` mit).

## 2. Architektur: gemeinsamer Render-Kern

Alle vier Wege tun innen dasselbe: *aus `ArrayBuffer` + Format wird in einem Container
ein Viewport, mit Fehlerbehandlung, Poster, Kontext-Budget und Dispose.* Sie
unterscheiden sich nur in Datenquelle und Lebenszyklus-Aufhänger.

**Refactor:** Der innere Teil des heutigen `ModelBlock` wird in `ViewerHost`
extrahiert. `ModelBlock`, der neue `gltf`-Block, der Embed-Handler und die `FileView`
werden dünne Adapter, die nur „Bytes + Format + Container" beschaffen und an denselben
Kern übergeben. **Eine Stelle für Fehlerbehandlung** — Fixes (Doppelklick-Reset,
Kontrast, eingeklappte Fehlerfläche) gelten überall automatisch.

```
src/obsidian/
  viewer-host.ts       ← ViewerHost: render(bytes, format, label) · dispose · refreshColors
  block-child.ts       ← ModelBlock: Codeblock-Config → Datei → ViewerHost (Adapter)
  gltf-block.ts        ← GltfBlock: Codeblock-Text → ViewerHost (Adapter)
  embed.ts             ← registerModelEmbeds: .internal-embed abfangen → ViewerHost
  file-view.ts         ← ModelFileView: onLoadFile → ViewerHost (ganzes Pane)
src/core/
  embed-src.ts         ← parseEmbedSrc(src) → { path, height? } (pure)
```

### `ViewerHost` — Vertrag

```typescript
export interface ViewerHostDeps {
  settings: () => PluginSettings;
  factory: ViewportFactory;
  budget: ContextBudget;
  loadModel(bytes: ArrayBuffer, format: ModelFormat, materialColor: string): Promise<unknown>;
  readColors(el: HTMLElement): SceneColors;
  /** true = Poster/Budget nutzen (Inline, mehrere möglich); false = immer voll
      interaktiv, kein Budget (FileView: ein Modell, ein Pane). */
  managed: boolean;
}

export class ViewerHost {
  constructor(stage: HTMLElement, message: HTMLElement, deps: ViewerHostDeps);
  /** Bytes rendern. `format` bekannt (aus Endung oder Blocktyp). */
  render(bytes: ArrayBuffer, format: ModelFormat, opts?: { inspectContainer?: boolean }): Promise<void>;
  showError(state: ViewerState): void;   // z.B. missing-file, unsupported-format
  refreshColors(): void;
  dispose(): void;
}
```

`ModelBlock`s heutige `mount`/`degradeToPoster`/`reactivate`/`show`-Logik wandert
nach `ViewerHost`. `ModelBlock` behält nur: Config parsen, Datei auflösen, `modify`-Abo,
Sichtbarkeits-Observer — und ruft `host.render(...)` bzw. `host.showError(...)`.

## 3. Die vier Wege im Detail

### 3.1 ` ```gltf `-Codeblock (Quelltext im Block)

`registerMarkdownCodeBlockProcessor("gltf", …)`. Der Blocktext ist glTF-JSON. Ablauf:

1. `TextEncoder` → `ArrayBuffer`.
2. `host.render(bytes, "gltf")`.

**Bewusste Grenze:** nur glTF-**JSON** (Text). GLB ist binär und passt nicht in einen
Text-Block; für große generierte Modelle bleibt `file:`/Embed der Weg. Ein `gltf`-Block
ist für kleine, handgeschriebene oder Skizzen-Modelle im Vault gedacht (das „Illustration
im Vault"-Szenario aus Stufe-1-Spec §1).

**Neuer Fehlerfall:** Der Blocktext wird **vor** dem Loader mit `JSON.parse` in
`try/catch` geprüft. Schlägt es fehl → `host.showError({kind:"invalid-gltf-json"})` →
„The glTF code is not valid JSON." Das gibt dem Nutzer den echten Grund statt eines
three.js-internen Parserfehlers. Bei gültigem JSON geht es normal über
`host.render(bytes, "gltf")`.

### 3.2 `![[datei.gltf]]`-Embed

`registerMarkdownPostProcessor` (public API — es gibt keine dedizierte Embed-API, der
Postprocessor-Weg ist store-konform). Im Callback:

1. `el.querySelectorAll(".internal-embed")` durchgehen.
2. `src`-Attribut lesen; endet es auf `.gltf/.glb/.stl` → dieser Embed gehört uns.
3. Span leeren, `MarkdownRenderChild` anhängen (`ctx.addChild`), darin Stage/Message-DOM
   + `ViewerHost` aufbauen, Datei über `resolveModelPath(src, ctx.sourcePath)` holen.

**Höhe:** `![[datei.gltf|400]]` — der Teil nach `|` landet in Obsidians `alt`/`width`.
`parseEmbedSrc` (pure) trennt Pfad und optionale Höhe.

Der Embed nutzt denselben `managed`-Pfad wie die Codeblöcke (Poster/Budget, mehrere pro
Notiz möglich).

### 3.3 Datei öffnen (`ModelFileView`)

`registerView(VIEW_TYPE_3D, (leaf) => new ModelFileView(leaf, deps))` +
`registerExtensions(["gltf", "glb", "stl"], VIEW_TYPE_3D)`. `.gltf/.glb/.stl` sind
nicht nativ öffenbar → kein Konflikt mit Obsidian-Kernviews.

- `onLoadFile(file)`: `readBinary` → `detectFormat` → `host.render` (`managed: false` —
  ein Modell, ganzes Pane, immer voll interaktiv, kein Poster/Budget).
- `onUnloadFile(file)`: `host.dispose()`.
- `getViewType()`, `getIcon()` (`"box"`), `getDisplayText()` (Dateiname).

## 4. Slider-Setting

„Maximum live 3D views" wird ein Slider:

```typescript
new Setting(containerEl)
  .setName("Maximum live 3D views")
  .setDesc("How many models stay interactive at once. Older ones become still images. 0 turns the limit off.")
  .addSlider((slider) =>
    slider.setLimits(0, 12, 1).setValue(this.plugin.settings.maxContexts).setDynamicTooltip()
      .onChange(async (value) => { await this.persist({ maxContexts: value }); }),
  );
```

**Semantik `0 = off`:** die Begrenzung ist deaktiviert — unbegrenzt viele Viewports
gleichzeitig live (der Browser kappt bei ~8–16 selbst). 1–12 = konkretes Limit,
Default 6.

Änderungen:
- `mergeSettings`: `maxContexts` auf **0–12** klemmen (heute 1–16). 0 erlaubt.
  `MAX_CONTEXTS_LIMIT` = 12.
- `pickEvictions(active, limit)`: `limit === 0` → `[]` (nie verdrängen). Sonst wie bisher.

## 5. Fehlerbehandlung

Zentral in `ViewerHost`, damit alle Wege gleich reagieren. Bestehende Fälle
(missing-file, unsupported-format, compressed-gltf, invalid-file, no-webgl,
context-lost, load-failed) bleiben. Neu:

| Fall | Meldung |
|---|---|
| `gltf`-Block mit kaputtem JSON | „The glTF code is not valid JSON." |
| Embed-`src` zeigt auf nicht-3D | Embed wird ignoriert (Obsidians normaler Embed greift) |

## 6. Tests

**Pure (vitest):**
- `embed-src`: Pfad ohne Pipe, mit Höhe (`x.gltf|400`), mit Nicht-Zahl nach Pipe
  (Höhe ignoriert), Groß-/Kleinschreibung der Endung.
- `view-model`: neuer Zustand `invalid-gltf-json` → Text.
- `settings-types`: `maxContexts` 0 erlaubt, auf 0–12 geklemmt, Default 6.
- `context-budget`: `limit === 0` → keine Verdrängung.

**Obsidian-Schicht (Kit-Mock, `ViewportFactory`):**
- `ViewerHost`: die heutigen `ModelBlock`-Lebenszyklustests wandern hierher
  (render baut Viewport, dispose gibt frei, Fehler zeigt Meldung, `managed:false`
  registriert nicht beim Budget).
- `gltf-block`: gültiges JSON → render aufgerufen; kaputtes JSON → `invalid-gltf-json`,
  kein Viewport.
- `file-view`: `onLoadFile` ruft `host.render(managed:false)`; `onUnloadFile` disposet.
- `ModelBlock`: unverändert grün (Adapter-Verhalten bleibt).

**Nicht unit-getestet:** three.js-Schicht (GUI-Smoke). Der Embed-Postprocessor-
Selektor (`.internal-embed`) wird im Smoke gegen echtes Obsidian geprüft.

## 7. GUI-Smoke (Ergänzung zu Stufe 1)

- [ ] `.gltf` im Datei-Explorer anklicken → öffnet die 3D-View im ganzen Pane, voll
      interaktiv, Doppelklick-Reset geht.
- [ ] `![[weltmodell/3d/eg.gltf]]` in einer Notiz → gerendert; `![[…|300]]` → Höhe 300.
- [ ] ` ```gltf ` mit gültigem glTF-JSON → gerendert; mit kaputtem JSON → klare Meldung.
- [ ] Slider in den Settings: 0 (off) → keine Degradierung; 3 → nur 3 gleichzeitig live.
- [ ] Bestehende ` ```3d file: `-Blöcke unverändert funktionsfähig.

## 8. Bewusst nicht enthalten (YAGNI)

STL-/OBJ-Quelltext im Codeblock (nur glTF-JSON inline) · GLB im Codeblock (binär) ·
Embed mit Kamera-/Rotations-Parametern · eigenes Icon-Asset (Obsidian-`box`-Icon
genügt) · Hover-Preview von 3D-Links.
