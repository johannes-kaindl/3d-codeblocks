# GLB-Artefakt-Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Obsidian-Plugin, das GLB-/glTF-/STL-Dateien aus einem ` ```3d `-Codeblock interaktiv in der Notiz rendert.

**Architecture:** Drei Schichten — `src/core/` (pure Rechnung: Config-Parsing, Format-/Kompressions-Erkennung, Kamera-Einpassung, Kontext-Budget, ViewModel; kein `obsidian`/`three`-Import, per `check:pure` abgesichert), `src/viewer/` (three.js-Kapselung, kennt Obsidian nicht) und `src/obsidian/` (Codeblock-Processor, Lebenszyklus, Dateizugriff, Settings). Jeder Block ist ein `MarkdownRenderChild`, dessen `onunload()` die WebGL-Ressourcen freigibt.

**Tech Stack:** TypeScript · esbuild · vitest (node-env, `obsidian`-Alias auf lokalen Mock) · eslint + `eslint-plugin-obsidianmd` · three.js (`GLTFLoader`, `STLLoader`, `OrbitControls`)

**Spec:** `docs/superpowers/specs/2026-07-23-glb-viewer-design.md`

## Global Constraints

- **Keine Node-APIs** (`child_process`, `fs`, `path`) im Plugin-Code — Store-Blocker.
- **Keine Web Worker** — Obsidians Electron-Renderer verbietet sie („Failed to construct 'Worker'"). Daraus folgt: kein Draco-, kein Meshopt-Decoder.
- **Keine Laufzeit-Downloads** — alles gebündelt.
- **Nur Obsidian-Theme-CSS-Variablen**, kein `#…`/`rgb()`/`!important` (UI-STANDARD §3).
- **Klassen-Präfix `tdcb-`** für jede eigene CSS-Klasse.
- **`createEl`/`createDiv` statt `innerHTML`** (UI-STANDARD §7).
- **UI-Texte in sentence case**, Sprache Englisch (Store-Zielgruppe; Meldungstexte im Plan sind verbindlich).
- **`src/core/**` darf `obsidian` und `three` nicht importieren** — `npm run check:pure` bricht sonst.
- **Lizenz:** AGPL-3.0-or-later · **Autor:** Johannes Kaindl · **Plugin-ID:** `3d-codeblocks`
- **TDD:** Erst der fehlschlagende Test, dann die Implementierung. Commit nach jeder Task.

---

## Datei-Übersicht

| Datei | Verantwortung |
|---|---|
| `manifest.json`, `versions.json` | Obsidian-Plugin-Metadaten |
| `package.json`, `tsconfig.json`, `tsconfig.test.json` | Build-/Typecheck-Konfiguration |
| `esbuild.config.mjs` | Bundling → `main.js` |
| `eslint.config.mjs` | Obsidian-Guideline-Gate |
| `vitest.config.ts` | node-env + `obsidian`-Alias auf den Mock |
| `scripts/check-bundle.mjs` | Bundle-Größenschranke |
| `tests/__mocks__/obsidian.ts` | Minimaler Obsidian-Mock, bedarfsweise erweitert |
| `src/core/block-config.ts` | Codeblock-Quelltext → `BlockConfig` + Warnungen |
| `src/core/format.ts` | Dateiendung → Format |
| `src/core/gltf-inspect.ts` | GLB-Container prüfen, benötigte Extensions lesen |
| `src/core/camera-fit.ts` | Bounding-Box → Kameraposition/-ziel |
| `src/core/context-budget.ts` | LRU-Auswahl zu verdrängender Viewports |
| `src/core/view-model.ts` | Viewer-Zustand → Anzeigemodell |
| `src/core/settings-types.ts` | Settings-Typ + Defaults + Merge |
| `src/viewer/scene.ts` | Szene, Licht, Hintergrund, Bodengitter |
| `src/viewer/loaders.ts` | `ArrayBuffer` → `Object3D` |
| `src/viewer/viewport.ts` | Renderer-Lebenszyklus, on-demand-Rendering, Poster |
| `src/obsidian/theme.ts` | Theme-Farben lesen, `css-change`-Abo |
| `src/obsidian/file-source.ts` | Pfadauflösung, Binärlesen, `modify`-Abo |
| `src/obsidian/render-box.ts` | DOM-Gerüst eines Blocks (Titel, Fläche, Meldungen) |
| `src/obsidian/block-child.ts` | `MarkdownRenderChild`: Sichtbarkeit, Laden, Dispose |
| `src/obsidian/settings.ts` | Settings-Tab |
| `src/main.ts` | Plugin-Einstieg, Processor-Registrierung, Kontext-Budget |
| `styles.css` | Alle `tdcb-`-Klassen |

---

### Task 1: Repo-Gerüst und grüne Build-Kette

Ziel: `npm run gate` läuft durch, ein trivialer Test ist grün, `main.js` entsteht.

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `esbuild.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `manifest.json`, `versions.json`, `styles.css`, `.gitignore`, `scripts/check-bundle.mjs`, `tests/__mocks__/obsidian.ts`, `src/main.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm run gate` (lint + typecheck + typecheck:test + test + check:pure + check:bundle), Mock-Modul `tests/__mocks__/obsidian.ts` mit `makeFakeEl()`, `makeFakeApp()`, Stub-Klassen `Plugin`, `PluginSettingTab`, `Setting`, `Notice`, `TFile`, `MarkdownRenderChild`.

- [ ] **Step 1: `package.json` anlegen**

```json
{
  "name": "3d-codeblocks",
  "version": "0.1.0",
  "description": "Render 3D artifacts (GLB, glTF, STL) inline in your notes from a code block — orbit, zoom, pan. Local-first, no cloud.",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc --noEmit && node esbuild.config.mjs --production",
    "typecheck": "tsc --noEmit",
    "typecheck:test": "tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src",
    "deploy": "npm run build && cp main.js manifest.json styles.css \"${OBSIDIAN_PLUGIN_DIR:?set OBSIDIAN_PLUGIN_DIR}\"/",
    "check:pure": "sh -c \"! grep -rlE \\\"from '(obsidian|three)\\\" src/core 2>/dev/null\"",
    "check:bundle": "node esbuild.config.mjs --production && node scripts/check-bundle.mjs",
    "gate": "npm run lint && npm run typecheck && npm run typecheck:test && npm test && npm run check:pure && npm run check:bundle"
  },
  "keywords": ["obsidian", "obsidian-plugin", "3d", "glb", "gltf", "stl", "viewer", "three-js"],
  "author": "Johannes Kaindl",
  "license": "AGPL-3.0-or-later",
  "dependencies": {
    "three": "^0.169.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/three": "^0.169.0",
    "esbuild": "^0.23",
    "eslint": "^9",
    "eslint-plugin-obsidianmd": "latest",
    "obsidian": "latest",
    "typescript": "^5.5",
    "typescript-eslint": "^8",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: Abhängigkeiten installieren**

Run: `npm install`
Expected: `node_modules/` entsteht, kein Fehler. Falls `three@^0.169.0` nicht auflösbar ist, die aktuellste `0.x`-Version nehmen und `@types/three` auf dieselbe Minor-Version ziehen.

- [ ] **Step 3: TypeScript-, Build- und Lint-Konfiguration anlegen**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noImplicitAny": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/**/*.ts"]
}
```

`tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`esbuild.config.mjs`:

```javascript
// Build → main.js (PROF-TS-02). obsidian/electron sind extern (vom Host bereitgestellt).
// three wird mit-gebundelt — ein einziges main.js, keine Laufzeit-Downloads (Spec §2).
import esbuild from "esbuild";

const prod = process.argv.includes("--production");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:*"],
  format: "cjs",
  target: "es2022",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
  console.log("esbuild: watching…");
}
```

`eslint.config.mjs`:

```javascript
// Obsidian-Guideline-Gate (PROF-OBS-08): type-checked gegen ECHTE obsidian-Typen.
// KEIN Inline-`// eslint-disable` — Ausnahmen NUR als file-scoped Override mit Begruendung.
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  { ignores: ["main.js", "node_modules/", "tests/"] },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      // Mock-Alias gehoert in vitest, NIE in tsconfig.json (PROF-OBS-08):
      obsidian: fileURLToPath(new URL("./tests/__mocks__/obsidian.ts", import.meta.url)),
    },
  },
});
```

`.gitignore`:

```
node_modules/
main.js
main.js.map
.DS_Store
```

- [ ] **Step 4: Plugin-Metadaten anlegen**

`manifest.json`:

```json
{
  "id": "3d-codeblocks",
  "name": "3D Codeblocks",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Render 3D artifacts (GLB, glTF, STL) inline from a code block — orbit, zoom and pan without leaving your note.",
  "author": "Johannes Kaindl",
  "authorUrl": "https://jkaindl.de",
  "fundingUrl": "",
  "isDesktopOnly": false
}
```

`versions.json`:

```json
{
  "0.1.0": "1.5.0"
}
```

- [ ] **Step 5: Bundle-Schranke anlegen**

`scripts/check-bundle.mjs`:

```javascript
// Bundle-Groessenschranke. three.js ist gross und gewollt (Spec §2) — die Schranke
// faengt versehentliche Zusatz-Deps ab, nicht three selbst.
import { statSync } from "node:fs";

const LIMIT_KB = 1200;
const sizeKb = statSync("main.js").size / 1024;

if (sizeKb > LIMIT_KB) {
  console.error(`main.js ist ${sizeKb.toFixed(0)} KB — Schranke ${LIMIT_KB} KB.`);
  console.error("Neue Dependency dazugekommen? Sonst Schranke bewusst anheben.");
  process.exit(1);
}
console.log(`main.js: ${sizeKb.toFixed(0)} KB (Schranke ${LIMIT_KB} KB)`);
```

- [ ] **Step 6: Obsidian-Mock anlegen**

`tests/__mocks__/obsidian.ts` — minimal, wird in späteren Tasks bedarfsweise erweitert (Anti-Pattern: die ganze API vorab mocken):

```typescript
import { vi } from "vitest";

export function makeFakeEl(): any {
  const children: any[] = [];
  const el: any = {
    children,
    className: "",
    textContent: "",
    style: {},
    dataset: {},
    createDiv: (opts?: any) => {
      const child = makeFakeEl();
      children.push(child);
      if (typeof opts === "string") child.className = opts;
      else if (opts) {
        if (opts.cls) child.className = opts.cls;
        if (opts.text) child.textContent = opts.text;
      }
      return child;
    },
    createEl: (tag: string, opts?: any) => {
      const child = makeFakeEl();
      children.push(child);
      child.tagName = tag.toUpperCase();
      if (opts?.text) child.textContent = opts.text;
      if (opts?.cls) child.className = opts.cls;
      return child;
    },
    createSpan: (opts?: any) => el.createEl("span", opts),
    empty: () => { children.length = 0; },
    setText: (text: string) => { el.textContent = text; },
    addClass: (cls: string) => { el.className = `${el.className} ${cls}`.trim(); },
    removeClass: (cls: string) => { el.className = el.className.replace(cls, "").trim(); },
    toggleClass: (cls: string, on: boolean) => (on ? el.addClass(cls) : el.removeClass(cls)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    appendChild: (child: any) => { children.push(child); },
    detach: () => { children.length = 0; },
  };
  return el;
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
  stat = { mtime: 0, ctime: 0, size: 0 };
}

export class Notice {
  constructor(public message: string, public timeout?: number) {}
}

export class Plugin {
  app: any;
  manifest: any;
  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
  loadData(): Promise<any> { return Promise.resolve({}); }
  saveData(_data: any): Promise<void> { return Promise.resolve(); }
  addSettingTab(_tab: any) {}
  registerMarkdownCodeBlockProcessor(_lang: string, _handler: any) {}
  registerEvent(_ref: any) {}
  register(_cb: any) {}
}

export class PluginSettingTab {
  containerEl = makeFakeEl();
  constructor(public app: any, public plugin: any) {}
  display() {}
}

export class Setting {
  constructor(public containerEl: any) {}
  setName(_n: string) { return this; }
  setDesc(_d: string) { return this; }
  setHeading() { return this; }
  addToggle(cb: any) { cb({ setValue: () => ({ onChange: () => {} }) }); return this; }
  addText(cb: any) { cb({ setValue: () => ({ onChange: () => {} }), setPlaceholder: () => ({}) }); return this; }
  addDropdown(cb: any) { cb({ addOption: () => ({}), setValue: () => ({ onChange: () => {} }) }); return this; }
}

export class MarkdownRenderChild {
  containerEl: any;
  constructor(containerEl: any) { this.containerEl = containerEl; }
  onload() {}
  onunload() {}
  register(_cb: any) {}
  registerEvent(_ref: any) {}
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function makeFakeApp(): any {
  return {
    vault: {
      readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      on: vi.fn().mockReturnValue({}),
      offref: vi.fn(),
    },
    workspace: {
      on: vi.fn().mockReturnValue({}),
      offref: vi.fn(),
    },
    metadataCache: {
      getFirstLinkpathDest: vi.fn().mockReturnValue(null),
    },
  };
}
```

- [ ] **Step 7: Minimalen Plugin-Einstieg und Rauchtest anlegen**

`src/main.ts`:

```typescript
import { Plugin } from "obsidian";

export default class ThreeDCodeblocksPlugin extends Plugin {
  onload(): void {
    // Registrierung folgt in Task 11.
  }
}
```

`styles.css`:

```css
/* 3d-codeblocks — alle Klassen tragen das Praefix `tdcb-`.
   Nur Obsidian-Theme-Variablen, keine festen Farben (UI-STANDARD §3). */
```

`tests/smoke.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";

describe("test setup", () => {
  it("provides a fake element that records children", () => {
    const el = makeFakeEl();
    el.createDiv({ cls: "tdcb-x", text: "hello" });
    expect(el.children).toHaveLength(1);
    expect(el.children[0].className).toBe("tdcb-x");
    expect(el.children[0].textContent).toBe("hello");
  });
});
```

- [ ] **Step 8: Gate laufen lassen**

Run: `npm run gate`
Expected: lint, typecheck, typecheck:test, 1 Test grün, `check:pure` still, `check:bundle` meldet die Größe von `main.js` (erwartet < 50 KB, da three noch nicht importiert wird).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: Repo-Geruest, Build-Kette und Test-Setup"
```

---

### Task 2: `core/block-config.ts` — Codeblock-Quelltext parsen

**Files:**
- Create: `src/core/block-config.ts`, `tests/core/block-config.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface BlockConfig { file: string; height?: number; title?: string }
  export interface ParseResult { config: BlockConfig | null; errors: string[]; warnings: string[] }
  export function parseBlockConfig(source: string): ParseResult
  ```
  `errors` blockieren das Rendering, `warnings` erscheinen als Hinweiszeile unter dem Viewport.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/core/block-config.test.ts` — jeder Fall mit exakt erwartetem Ergebnis:

```typescript
import { describe, expect, it } from "vitest";
import { parseBlockConfig } from "../../src/core/block-config";

describe("parseBlockConfig", () => {
  it("reads file, height and title", () => {
    const r = parseBlockConfig("file: a/b.glb\nheight: 420\ntitle: Ground floor");
    expect(r.config).toEqual({ file: "a/b.glb", height: 420, title: "Ground floor" });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("accepts a bare path as shorthand for file", () => {
    const r = parseBlockConfig("weltmodell/3d/eg.glb");
    expect(r.config?.file).toBe("weltmodell/3d/eg.glb");
    expect(r.errors).toEqual([]);
  });

  it("keeps colons inside a bare path", () => {
    const r = parseBlockConfig("some folder/odd:name.glb");
    expect(r.config?.file).toBe("some folder/odd:name.glb");
  });

  it("errors when file is missing", () => {
    const r = parseBlockConfig("height: 300");
    expect(r.config).toBeNull();
    expect(r.errors).toEqual(["No `file:` given."]);
  });

  it("errors on an empty block", () => {
    const r = parseBlockConfig("   \n\n");
    expect(r.config).toBeNull();
    expect(r.errors).toEqual(["No `file:` given."]);
  });

  it("warns about an unknown key and still renders", () => {
    const r = parseBlockConfig("file: a.glb\nheigth: 400");
    expect(r.config?.file).toBe("a.glb");
    expect(r.warnings).toEqual(["Unknown key: `heigth`"]);
  });

  it("warns about an invalid height and falls back", () => {
    const r = parseBlockConfig("file: a.glb\nheight: tall");
    expect(r.config?.height).toBeUndefined();
    expect(r.warnings).toEqual(["`height` must be a number: `tall`"]);
  });

  it("warns about a non-positive height", () => {
    const r = parseBlockConfig("file: a.glb\nheight: 0");
    expect(r.config?.height).toBeUndefined();
    expect(r.warnings).toEqual(["`height` must be a number: `0`"]);
  });

  it("ignores blank lines and # comments", () => {
    const r = parseBlockConfig("# the ground floor\n\nfile: a.glb\n");
    expect(r.config?.file).toBe("a.glb");
    expect(r.warnings).toEqual([]);
  });

  it("trims surrounding whitespace and quotes", () => {
    const r = parseBlockConfig('  file:   "a b.glb"  ');
    expect(r.config?.file).toBe("a b.glb");
  });

  it("is case-insensitive for keys", () => {
    const r = parseBlockConfig("File: a.glb\nHEIGHT: 250");
    expect(r.config).toEqual({ file: "a.glb", height: 250, title: undefined });
  });

  it("reports the last of two file keys and warns", () => {
    const r = parseBlockConfig("file: a.glb\nfile: b.glb");
    expect(r.config?.file).toBe("b.glb");
    expect(r.warnings).toEqual(["`file` given more than once — using the last one."]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/block-config.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/block-config"`.

- [ ] **Step 3: Implementieren**

`src/core/block-config.ts`. Kernregeln: Zeilen splitten; leere Zeilen und `#`-Kommentare überspringen; eine Zeile gilt nur dann als Schlüssel-Zeile, wenn sie `^[A-Za-z][A-Za-z0-9_-]*\s*:` erfüllt — sonst ist sie Pfad-Kurzform (deshalb überlebt `odd:name.glb` nur, wenn davor ein Slash oder Leerzeichen steht; der Test deckt genau diesen Fall ab, weil `some folder/odd` kein gültiger Schlüsselname ist). Bekannte Schlüssel: `file`, `height`, `title`. Werte trimmen und umschließende `"`/`'` entfernen. `height` per `Number()`; nur endliche Werte `> 0` übernehmen, sonst Warnung. Unbekannte Schlüssel sammeln als `Unknown key: \`<name>\``. Ohne `file` → `config: null`, `errors: ["No \`file:\` given."]`.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/core/block-config.test.ts`
Expected: PASS, 12 Tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/block-config.ts tests/core/block-config.test.ts
git commit -m "feat(core): Codeblock-Konfiguration parsen"
```

---

### Task 3: `core/format.ts` — Format aus der Dateiendung

**Files:**
- Create: `src/core/format.ts`, `tests/core/format.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type ModelFormat = "gltf" | "stl";
  export function detectFormat(path: string): ModelFormat | null
  export const SUPPORTED_EXTENSIONS: readonly string[]  // [".glb", ".gltf", ".stl"]
  ```

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```typescript
import { describe, expect, it } from "vitest";
import { detectFormat, SUPPORTED_EXTENSIONS } from "../../src/core/format";

describe("detectFormat", () => {
  it("maps .glb and .gltf to gltf", () => {
    expect(detectFormat("a/b.glb")).toBe("gltf");
    expect(detectFormat("a/b.gltf")).toBe("gltf");
  });

  it("maps .stl to stl", () => {
    expect(detectFormat("a/b.stl")).toBe("stl");
  });

  it("ignores case", () => {
    expect(detectFormat("A/B.GLB")).toBe("gltf");
  });

  it("uses the last dot, not the first", () => {
    expect(detectFormat("weltmodell/3d/eg.v2.glb")).toBe("gltf");
  });

  it("returns null for unknown or missing extensions", () => {
    expect(detectFormat("a/b.obj")).toBeNull();
    expect(detectFormat("a/b")).toBeNull();
    expect(detectFormat("")).toBeNull();
  });

  it("does not treat a dot in a folder name as an extension", () => {
    expect(detectFormat("v1.0/model")).toBeNull();
  });

  it("lists the supported extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toEqual([".glb", ".gltf", ".stl"]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/format.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementieren**

Dateinamen ab dem letzten `/` isolieren, dann ab dem letzten `.` — dadurch fällt `v1.0/model` korrekt durch. Endung kleinschreiben und mappen.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/core/format.test.ts`
Expected: PASS, 7 Tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/format.ts tests/core/format.test.ts
git commit -m "feat(core): Format aus Dateiendung erkennen"
```

---

### Task 4: `core/gltf-inspect.ts` — GLB-Container prüfen

Zweck: **vor** dem Loader-Aufruf erkennen, ob eine Datei Draco/Meshopt verlangt — sonst sieht der Nutzer einen generischen Parserfehler statt des echten Grundes (Spec §6).

**Files:**
- Create: `src/core/gltf-inspect.ts`, `tests/core/gltf-inspect.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface GlbInspection {
    valid: boolean;              // gültiger GLB-Container (Magic + JSON-Chunk lesbar)
    requiredExtensions: string[]; // extensionsRequired aus dem JSON-Chunk
  }
  export function inspectGlb(buffer: ArrayBuffer): GlbInspection
  export const UNSUPPORTED_EXTENSIONS: readonly string[]
    // ["KHR_draco_mesh_compression", "EXT_meshopt_compression"]
  export function unsupportedRequired(inspection: GlbInspection): string[]
  ```

GLB-Layout (Version 2): 12 Byte Header (`magic` = `0x46546C67` = "glTF", `version`, `length`), dann Chunks je 8 Byte Header (`chunkLength`, `chunkType`); der erste Chunk ist JSON (`0x4E4F534A`). Alles little-endian.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Der Test braucht einen Helfer, der einen GLB-Puffer aus einem JSON-Objekt baut — im Test-File, nicht im Produktivcode:

```typescript
import { describe, expect, it } from "vitest";
import { inspectGlb, unsupportedRequired } from "../../src/core/gltf-inspect";

function makeGlb(json: unknown, opts: { magic?: number; truncate?: boolean } = {}): ArrayBuffer {
  const jsonText = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const padded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4);
  padded.fill(0x20);
  padded.set(jsonBytes);

  const total = 12 + 8 + padded.length;
  const buf = new ArrayBuffer(opts.truncate ? 10 : total);
  const view = new DataView(buf);
  if (opts.truncate) return buf;

  view.setUint32(0, opts.magic ?? 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf).set(padded, 20);
  return buf;
}

describe("inspectGlb", () => {
  it("accepts a plain GLB with no required extensions", () => {
    const r = inspectGlb(makeGlb({ asset: { version: "2.0" } }));
    expect(r.valid).toBe(true);
    expect(r.requiredExtensions).toEqual([]);
  });

  it("reads extensionsRequired", () => {
    const r = inspectGlb(makeGlb({ extensionsRequired: ["KHR_draco_mesh_compression"] }));
    expect(r.requiredExtensions).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("rejects a wrong magic number", () => {
    expect(inspectGlb(makeGlb({}, { magic: 0x12345678 })).valid).toBe(false);
  });

  it("rejects a truncated file", () => {
    expect(inspectGlb(makeGlb({}, { truncate: true })).valid).toBe(false);
  });

  it("rejects an empty buffer", () => {
    expect(inspectGlb(new ArrayBuffer(0)).valid).toBe(false);
  });

  it("survives a broken JSON chunk", () => {
    const good = makeGlb({ asset: { version: "2.0" } });
    const bytes = new Uint8Array(good);
    bytes[20] = 0x7b; bytes[21] = 0x7b; // "{{" — kaputt
    const r = inspectGlb(good);
    expect(r.valid).toBe(false);
    expect(r.requiredExtensions).toEqual([]);
  });
});

describe("unsupportedRequired", () => {
  it("flags draco", () => {
    expect(unsupportedRequired({ valid: true, requiredExtensions: ["KHR_draco_mesh_compression"] }))
      .toEqual(["KHR_draco_mesh_compression"]);
  });

  it("flags meshopt", () => {
    expect(unsupportedRequired({ valid: true, requiredExtensions: ["EXT_meshopt_compression"] }))
      .toEqual(["EXT_meshopt_compression"]);
  });

  it("passes extensions that are merely used, not required", () => {
    expect(unsupportedRequired({ valid: true, requiredExtensions: ["KHR_materials_unlit"] }))
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/gltf-inspect.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementieren**

Längen prüfen (mindestens 20 Byte), Magic gegen `0x46546C67`, ersten Chunk-Typ gegen `0x4E4F534A`, Chunk-Länge gegen die Puffergröße plausibilisieren. JSON per `TextDecoder` lesen und in `try/catch` parsen — bei jedem Fehlschlag `{ valid: false, requiredExtensions: [] }`. `unsupportedRequired` schneidet `requiredExtensions` gegen `UNSUPPORTED_EXTENSIONS`.

Hinweis: `.gltf` (JSON-Variante, kein GLB-Container) wird hier **nicht** geprüft — dort greift die Loader-Fehlerbehandlung in Task 10. Das ist bewusst: `.gltf` referenziert externe Buffer-Dateien, die im Vault ohnehin selten vorkommen.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/core/gltf-inspect.test.ts`
Expected: PASS, 9 Tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/gltf-inspect.ts tests/core/gltf-inspect.test.ts
git commit -m "feat(core): GLB-Container pruefen und Draco/Meshopt erkennen"
```

---

### Task 5: `core/camera-fit.ts` — Kamera auf die Bounding-Box einpassen

**Files:**
- Create: `src/core/camera-fit.ts`, `tests/core/camera-fit.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface Vec3 { x: number; y: number; z: number }
  export interface CameraFit { position: Vec3; target: Vec3; near: number; far: number }
  export function fitCamera(min: Vec3, max: Vec3, fovDeg: number, aspect: number): CameraFit
  ```
  Blickrichtung normalisiert `(1, 0.8, 1)` (leicht von oben-vorn, damit Grundrisse lesbar sind), Randabstand Faktor `1.2`, Mindestausdehnung `1e-3` gegen Division durch null.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```typescript
import { describe, expect, it } from "vitest";
import { fitCamera } from "../../src/core/camera-fit";

const v = (x: number, y: number, z: number) => ({ x, y, z });

describe("fitCamera", () => {
  it("targets the centre of the box", () => {
    const f = fitCamera(v(0, 0, 0), v(2, 4, 6), 50, 1.5);
    expect(f.target).toEqual(v(1, 2, 3));
  });

  it("places the camera above and in front of the target", () => {
    const f = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 1.5);
    expect(f.position.x).toBeGreaterThan(f.target.x);
    expect(f.position.y).toBeGreaterThan(f.target.y);
    expect(f.position.z).toBeGreaterThan(f.target.z);
  });

  it("moves further away for a bigger box", () => {
    const near = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 1.5);
    const far = fitCamera(v(-10, -10, -10), v(10, 10, 10), 50, 1.5);
    const dist = (f: ReturnType<typeof fitCamera>) =>
      Math.hypot(f.position.x - f.target.x, f.position.y - f.target.y, f.position.z - f.target.z);
    expect(dist(far)).toBeGreaterThan(dist(near) * 5);
  });

  it("handles a flat object (zero height) without collapsing", () => {
    const f = fitCamera(v(0, 0, 0), v(10, 0, 10), 50, 1.5);
    expect(Number.isFinite(f.position.x)).toBe(true);
    expect(Number.isFinite(f.position.y)).toBe(true);
    expect(f.position.y).toBeGreaterThan(f.target.y);
  });

  it("handles a degenerate single point", () => {
    const f = fitCamera(v(3, 3, 3), v(3, 3, 3), 50, 1.5);
    expect(f.target).toEqual(v(3, 3, 3));
    expect(Number.isFinite(f.position.x)).toBe(true);
    expect(f.far).toBeGreaterThan(f.near);
  });

  it("widens the distance for a narrow viewport", () => {
    const wide = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 2.0);
    const narrow = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 0.5);
    const dist = (f: ReturnType<typeof fitCamera>) =>
      Math.hypot(f.position.x - f.target.x, f.position.y - f.target.y, f.position.z - f.target.z);
    expect(dist(narrow)).toBeGreaterThan(dist(wide));
  });

  it("keeps near below far and both positive", () => {
    const f = fitCamera(v(0, 0, 0), v(1, 1, 1), 50, 1);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/camera-fit.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementieren**

Mitte = `(min + max) / 2`. Ausdehnung je Achse, jede auf mindestens `1e-3` angehoben. `radius` = halbe Diagonale der (angehobenen) Ausdehnung. Vertikaler Halbwinkel `vFov = fovDeg · π / 360`; horizontaler Halbwinkel `hFov = atan(tan(vFov) · aspect)`. Nötige Distanz = `radius / sin(min(vFov, hFov))` — dadurch rückt die Kamera bei schmalem Viewport (`aspect < 1`) weiter weg. Mal Randfaktor `1.2`. Position = Mitte + normalisierte Richtung `(1, 0.8, 1)` × Distanz. `near = max(distanz / 1000, 1e-3)`, `far = distanz + radius · 10`.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/core/camera-fit.test.ts`
Expected: PASS, 7 Tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/camera-fit.ts tests/core/camera-fit.test.ts
git commit -m "feat(core): Kamera auf Bounding-Box einpassen"
```

---

### Task 6: `core/context-budget.ts` — LRU-Auswahl für WebGL-Kontexte

**Files:**
- Create: `src/core/context-budget.ts`, `tests/core/context-budget.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface ActiveContext { id: string; lastUsedAt: number }
  export function pickEvictions(active: ActiveContext[], limit: number): string[]
  ```
  Liefert die IDs, die freigegeben werden müssen, damit höchstens `limit` Kontexte aktiv bleiben — die am längsten nicht bedienten zuerst.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```typescript
import { describe, expect, it } from "vitest";
import { pickEvictions } from "../../src/core/context-budget";

describe("pickEvictions", () => {
  it("evicts nothing below the limit", () => {
    expect(pickEvictions([{ id: "a", lastUsedAt: 1 }], 6)).toEqual([]);
  });

  it("evicts nothing exactly at the limit", () => {
    const active = [
      { id: "a", lastUsedAt: 1 },
      { id: "b", lastUsedAt: 2 },
    ];
    expect(pickEvictions(active, 2)).toEqual([]);
  });

  it("evicts the least recently used first", () => {
    const active = [
      { id: "a", lastUsedAt: 30 },
      { id: "b", lastUsedAt: 10 },
      { id: "c", lastUsedAt: 20 },
    ];
    expect(pickEvictions(active, 2)).toEqual(["b"]);
  });

  it("evicts several when far over the limit", () => {
    const active = [
      { id: "a", lastUsedAt: 40 },
      { id: "b", lastUsedAt: 10 },
      { id: "c", lastUsedAt: 20 },
      { id: "d", lastUsedAt: 30 },
    ];
    expect(pickEvictions(active, 2)).toEqual(["b", "c"]);
  });

  it("breaks ties by id so the result is deterministic", () => {
    const active = [
      { id: "b", lastUsedAt: 5 },
      { id: "a", lastUsedAt: 5 },
      { id: "c", lastUsedAt: 9 },
    ];
    expect(pickEvictions(active, 2)).toEqual(["a"]);
  });

  it("treats a limit below one as one", () => {
    const active = [
      { id: "a", lastUsedAt: 1 },
      { id: "b", lastUsedAt: 2 },
    ];
    expect(pickEvictions(active, 0)).toEqual(["a"]);
  });

  it("does not mutate the input array", () => {
    const active = [
      { id: "a", lastUsedAt: 3 },
      { id: "b", lastUsedAt: 1 },
    ];
    pickEvictions(active, 1);
    expect(active[0].id).toBe("a");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/context-budget.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementieren**

Kopie der Liste sortieren (`lastUsedAt` aufsteigend, bei Gleichstand `id` alphabetisch), `limit` auf mindestens 1 anheben, die ersten `länge − limit` IDs zurückgeben (nie negativ).

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/core/context-budget.test.ts`
Expected: PASS, 7 Tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/context-budget.ts tests/core/context-budget.test.ts
git commit -m "feat(core): LRU-Auswahl fuer das WebGL-Kontext-Budget"
```

---

### Task 7: `core/view-model.ts` und `core/settings-types.ts`

**Files:**
- Create: `src/core/view-model.ts`, `src/core/settings-types.ts`, `tests/core/view-model.test.ts`, `tests/core/settings-types.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_EXTENSIONS` aus Task 3.
- Produces:
  ```typescript
  // view-model.ts
  export type ViewerState =
    | { kind: "config-error"; messages: string[] }
    | { kind: "missing-file"; path: string }
    | { kind: "unsupported-format"; path: string }
    | { kind: "compressed-gltf"; extensions: string[] }
    | { kind: "invalid-file" }
    | { kind: "no-webgl" }
    | { kind: "context-lost" }
    | { kind: "load-failed"; detail: string }
    | { kind: "loading" }
    | { kind: "poster" }
    | { kind: "ready" };
  export interface ViewModel {
    message: string | null;       // null = keine Meldungsbox
    tone: "error" | "info" | null;
    showReloadButton: boolean;
    showSpinner: boolean;
  }
  export function toViewModel(state: ViewerState): ViewModel

  // settings-types.ts
  export type ViewMode = "immediate" | "on-click";
  export interface PluginSettings {
    viewMode: ViewMode; defaultHeight: number; autoRotate: boolean;
    showGrid: boolean; maxContexts: number;
  }
  export const DEFAULT_SETTINGS: PluginSettings
  export function mergeSettings(loaded: unknown): PluginSettings
  ```

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`tests/core/view-model.test.ts` — die Meldungstexte sind verbindlich (Spec §6):

```typescript
import { describe, expect, it } from "vitest";
import { toViewModel } from "../../src/core/view-model";

describe("toViewModel", () => {
  it("shows nothing when ready", () => {
    expect(toViewModel({ kind: "ready" })).toEqual({
      message: null, tone: null, showReloadButton: false, showSpinner: false,
    });
  });

  it("shows a spinner while loading", () => {
    const vm = toViewModel({ kind: "loading" });
    expect(vm.showSpinner).toBe(true);
    expect(vm.message).toBeNull();
  });

  it("shows nothing for a poster", () => {
    expect(toViewModel({ kind: "poster" }).message).toBeNull();
  });

  it("joins config errors", () => {
    const vm = toViewModel({ kind: "config-error", messages: ["No `file:` given."] });
    expect(vm.message).toBe("No `file:` given.");
    expect(vm.tone).toBe("error");
  });

  it("names the path it looked for", () => {
    const vm = toViewModel({ kind: "missing-file", path: "weltmodell/3d/eg.glb" });
    expect(vm.message).toBe("File not found: weltmodell/3d/eg.glb");
    expect(vm.tone).toBe("error");
  });

  it("lists the supported extensions on an unsupported format", () => {
    const vm = toViewModel({ kind: "unsupported-format", path: "a/b.obj" });
    expect(vm.message).toBe("Unsupported format: a/b.obj (supported: .glb, .gltf, .stl)");
  });

  it("explains why compressed glTF cannot work", () => {
    const vm = toViewModel({ kind: "compressed-gltf", extensions: ["KHR_draco_mesh_compression"] });
    expect(vm.message).toBe(
      "Compressed glTF is not supported (Obsidian does not allow web workers). Please export uncompressed. Required: KHR_draco_mesh_compression",
    );
  });

  it("reports an invalid file", () => {
    expect(toViewModel({ kind: "invalid-file" }).message)
      .toBe("The file is damaged or not a valid GLB.");
  });

  it("reports missing WebGL", () => {
    expect(toViewModel({ kind: "no-webgl" }).message)
      .toBe("WebGL is unavailable, so the 3D view cannot be shown.");
  });

  it("offers a reload button after a lost context", () => {
    const vm = toViewModel({ kind: "context-lost" });
    expect(vm.message).toBe("The 3D context was lost.");
    expect(vm.showReloadButton).toBe(true);
  });

  it("includes the detail of a load failure", () => {
    const vm = toViewModel({ kind: "load-failed", detail: "unexpected token" });
    expect(vm.message).toBe("Could not load the model: unexpected token");
    expect(vm.showReloadButton).toBe(true);
  });
});
```

`tests/core/settings-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/core/settings-types";

describe("mergeSettings", () => {
  it("returns the defaults for null or undefined", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("has sensible defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      viewMode: "immediate", defaultHeight: 400,
      autoRotate: false, showGrid: false, maxContexts: 6,
    });
  });

  it("keeps stored values", () => {
    expect(mergeSettings({ defaultHeight: 250 }).defaultHeight).toBe(250);
  });

  it("drops an unknown view mode", () => {
    expect(mergeSettings({ viewMode: "sideways" }).viewMode).toBe("immediate");
  });

  it("drops a non-positive height", () => {
    expect(mergeSettings({ defaultHeight: 0 }).defaultHeight).toBe(400);
    expect(mergeSettings({ defaultHeight: "tall" }).defaultHeight).toBe(400);
  });

  it("clamps maxContexts to a sane range", () => {
    expect(mergeSettings({ maxContexts: 0 }).maxContexts).toBe(1);
    expect(mergeSettings({ maxContexts: 999 }).maxContexts).toBe(16);
  });

  it("ignores unknown keys", () => {
    expect(mergeSettings({ nope: true })).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/view-model.test.ts tests/core/settings-types.test.ts`
Expected: FAIL — Module nicht auflösbar.

- [ ] **Step 3: Implementieren**

`view-model.ts`: `switch` über `state.kind`, jeder Zweig liefert das komplette `ViewModel`. `config-error` verbindet `messages` mit `" "`. Der Text bei `unsupported-format` setzt `SUPPORTED_EXTENSIONS.join(", ")` ein.

`settings-types.ts`: `mergeSettings` prüft jedes Feld einzeln typ- und wertseitig (kein `{...DEFAULT, ...loaded}`-Spread, der Müllwerte durchreicht); `maxContexts` wird auf `1…16` geklemmt.

- [ ] **Step 4: Tests laufen lassen, grün bestätigen**

Run: `npx vitest run tests/core/`
Expected: PASS, alle Core-Tests (Tasks 2–7).

- [ ] **Step 5: Commit**

```bash
git add src/core tests/core
git commit -m "feat(core): ViewModel und Settings-Typen"
```

---

### Task 8: `viewer/` — three.js-Kapselung

Diese Schicht wird nicht unit-getestet (echtes WebGL ist in node nicht sinnvoll darstellbar); sie ist über den GUI-Smoke abgesichert. Deliverable ist deshalb: typecheckt, lintet, bundelt.

**Files:**
- Create: `src/viewer/scene.ts`, `src/viewer/loaders.ts`, `src/viewer/viewport.ts`

**Interfaces:**
- Consumes: `fitCamera` (Task 5), `ModelFormat` (Task 3).
- Produces:
  ```typescript
  // loaders.ts
  export function loadModel(buffer: ArrayBuffer, format: ModelFormat, materialColor: string): Promise<THREE.Object3D>

  // scene.ts
  export interface SceneColors { background: string; material: string; grid: string }
  export function buildScene(colors: SceneColors, showGrid: boolean): THREE.Scene

  // viewport.ts
  export interface ViewportOptions {
    container: HTMLElement; colors: SceneColors;
    autoRotate: boolean; showGrid: boolean;
    onContextLost: () => void; onInteract: () => void;
  }
  export class Viewport {
    constructor(options: ViewportOptions);
    setModel(object: THREE.Object3D): void;
    setColors(colors: SceneColors): void;
    resize(): void;
    resetCamera(): void;
    capturePoster(): string | null;   // Data-URL des aktuellen Frames
    dispose(): void;
    static isWebGLAvailable(): boolean;
  }
  ```

- [ ] **Step 1: Loader schreiben**

`src/viewer/loaders.ts`: `GLTFLoader.parse(buffer, "", onLoad, onError)` in ein `Promise` wickeln und `gltf.scene` liefern. Für STL `new STLLoader().parse(buffer)` → `BufferGeometry`; daraus ein `THREE.Mesh` mit `MeshStandardMaterial` (`color: materialColor`, `roughness: 0.85`, `metalness: 0.0`, `flatShading: false`) und `geometry.computeVertexNormals()`, falls keine Normalen vorhanden sind. Importe gezielt aus den Unterpfaden (`three/examples/jsm/loaders/GLTFLoader.js` usw.), damit esbuild nicht mehr zieht als nötig.

**Wichtig:** Keine `DRACOLoader`- oder `MeshoptDecoder`-Registrierung — das wäre der Worker-Pfad, den Task 10 vorher abfängt.

- [ ] **Step 2: Szene schreiben**

`src/viewer/scene.ts`: `THREE.Scene` mit `background = new THREE.Color(colors.background)`, `HemisphereLight(0xffffff, 0x444444, 2.0)` und `DirectionalLight(0xffffff, 1.2)` bei `(1, 2, 1)`. Bei `showGrid` ein `GridHelper`, dessen beide Farben aus `colors.grid` kommen. Die Lichtfarben sind bewusst neutral-weiß — das ist Beleuchtung, keine UI-Farbe, und darf deshalb konstant sein; alles, was der Nutzer als Fläche sieht (Hintergrund, Material, Gitter), kommt aus Theme-Variablen.

- [ ] **Step 3: Viewport schreiben**

`src/viewer/viewport.ts` — der Kern. Aufbau:

- `WebGLRenderer({ antialias: true, alpha: false, powerPreference: "default" })`, `setPixelRatio(Math.min(window.devicePixelRatio, 2))`, Canvas in den Container hängen.
- `PerspectiveCamera(50, aspect, near, far)` — Werte aus `fitCamera`, sobald ein Modell gesetzt wird.
- `OrbitControls` mit `enableDamping = true`; `controls.addEventListener("change", …)` setzt `needsRender` **und** ruft `onInteract()` (füttert das Kontext-Budget).
- **On-demand-Rendering:** ein `requestAnimationFrame`-Tick wird nur geplant, wenn `needsRender` gesetzt ist oder `autoRotate` läuft. Kein Dauerloop.
- `setModel`: altes Modell entsorgen (`disposeObject`, s.u.), neues einhängen, Bounding-Box per `new THREE.Box3().setFromObject(obj)` bestimmen, `fitCamera` aufrufen, Kamera und `controls.target` setzen, `needsRender = true`.
- `setColors`: Hintergrund und Gitterfarben aktualisieren, `needsRender = true`.
- `capturePoster`: einmal synchron rendern und `renderer.domElement.toDataURL("image/png")` zurückgeben; `null` bei Fehler. Voraussetzung ist `preserveDrawingBuffer` — statt es dauerhaft zu setzen (kostet Speicher), unmittelbar vor dem `toDataURL` einmal rendern und direkt danach auslesen, ohne dazwischen den Frame zu wechseln.
- `dispose`: `controls.dispose()`, Szene traversieren und je `Mesh` `geometry.dispose()` sowie Material(ien) samt deren Texturen (`map`, `normalMap`, `roughnessMap`, `metalnessMap`, `emissiveMap`, `aoMap`) disposen, `renderer.dispose()`, `renderer.forceContextLoss()`, Canvas aus dem DOM nehmen, laufenden rAF abbrechen.
- `webglcontextlost` am Canvas registrieren → `event.preventDefault()` und `onContextLost()`.
- `isWebGLAvailable()`: Test-Canvas anlegen und `getContext("webgl2") ?? getContext("webgl")` prüfen.

- [ ] **Step 4: Typecheck, Lint und Bundle prüfen**

Run: `npm run typecheck && npm run lint && npm run check:bundle`
Expected: alles grün; `check:bundle` meldet jetzt eine deutlich größere `main.js` (erwartet 500–900 KB). Liegt sie über 1200 KB, prüfen, ob versehentlich `three/examples/jsm/…`-Module mitgezogen wurden, die nicht gebraucht werden.

Hinweis: `main.ts` importiert `viewer/` noch nicht — damit esbuild die Schicht überhaupt bundelt, in diesem Schritt vorübergehend `import "./viewer/viewport";` in `src/main.ts` ergänzen und nach dem Messen wieder entfernen. Task 11 verdrahtet es endgültig.

- [ ] **Step 5: Commit**

```bash
git add src/viewer src/main.ts
git commit -m "feat(viewer): three.js-Szene, Loader und Viewport mit Dispose"
```

---

### Task 9: `obsidian/file-source.ts` und `obsidian/theme.ts`

**Files:**
- Create: `src/obsidian/file-source.ts`, `src/obsidian/theme.ts`, `tests/obsidian/file-source.test.ts`
- Modify: `tests/__mocks__/obsidian.ts` (nur falls eine benötigte API fehlt)

**Interfaces:**
- Produces:
  ```typescript
  // file-source.ts
  export interface ResolvedModel { file: TFile; data: ArrayBuffer; mtime: number }
  export function resolveModelPath(app: App, path: string, sourcePath: string): TFile | null
  export function readModel(app: App, file: TFile): Promise<ResolvedModel>

  // theme.ts
  export function readSceneColors(el: HTMLElement): SceneColors
  ```
  `readSceneColors` liest `--background-primary`, `--text-muted` und `--background-modifier-border` per `getComputedStyle` und fällt bei leeren Werten auf `"#1e1e1e"`/`"#888888"`/`"#444444"` zurück — der Fallback greift nur, wenn Obsidian gar keine Variablen liefert, und ist deshalb kein Verstoß gegen die Theme-Regel.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/obsidian/file-source.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp } from "../__mocks__/obsidian";
import { readModel, resolveModelPath } from "../../src/obsidian/file-source";

function fileAt(path: string, mtime = 100): TFile {
  const f = new TFile();
  f.path = path;
  f.extension = path.split(".").pop() ?? "";
  f.stat = { mtime, ctime: 0, size: 10 };
  return f;
}

describe("resolveModelPath", () => {
  it("resolves via the metadata cache, like a wikilink", () => {
    const app = makeFakeApp();
    const target = fileAt("weltmodell/3d/eg.glb");
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(target);

    const found = resolveModelPath(app, "weltmodell/3d/eg.glb", "notes/world.md");

    expect(found).toBe(target);
    expect(app.metadataCache.getFirstLinkpathDest)
      .toHaveBeenCalledWith("weltmodell/3d/eg.glb", "notes/world.md");
  });

  it("returns null when nothing matches", () => {
    const app = makeFakeApp();
    expect(resolveModelPath(app, "nope.glb", "notes/world.md")).toBeNull();
  });

  it("strips wrapping brackets from a wikilink-style path", () => {
    const app = makeFakeApp();
    const target = fileAt("a.glb");
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(target);

    resolveModelPath(app, "[[a.glb]]", "notes/world.md");

    expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("a.glb", "notes/world.md");
  });
});

describe("readModel", () => {
  it("returns the binary data together with the mtime", async () => {
    const app = makeFakeApp();
    const file = fileAt("a.glb", 4242);
    const buffer = new ArrayBuffer(8);
    app.vault.readBinary = vi.fn().mockResolvedValue(buffer);

    const result = await readModel(app, file);

    expect(result).toEqual({ file, data: buffer, mtime: 4242 });
    expect(app.vault.readBinary).toHaveBeenCalledWith(file);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/file-source.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementieren**

`resolveModelPath`: umschließende `[[`/`]]` und Anführungszeichen entfernen, `normalizePath` anwenden, dann `app.metadataCache.getFirstLinkpathDest(clean, sourcePath)`; Ergebnis nur zurückgeben, wenn es eine Datei ist, sonst `null`.

`readModel`: `await app.vault.readBinary(file)` und zusammen mit `file.stat.mtime` verpacken.

`theme.ts`: `getComputedStyle(el).getPropertyValue("--background-primary").trim()` je Variable, leere Werte durch die genannten Rückfallwerte ersetzen.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/obsidian/file-source.test.ts`
Expected: PASS, 4 Tests.

- [ ] **Step 5: Commit**

```bash
git add src/obsidian tests/obsidian
git commit -m "feat(obsidian): Pfadaufloesung, Binaerlesen und Theme-Farben"
```

---

### Task 10: `obsidian/render-box.ts` und `obsidian/block-child.ts` — Lebenszyklus

Das Herzstück: ein Block als `MarkdownRenderChild` mit Sichtbarkeitssteuerung, Poster-Modus, Neuladen bei `modify` und garantiertem Dispose.

**Files:**
- Create: `src/obsidian/render-box.ts`, `src/obsidian/block-child.ts`, `tests/obsidian/block-child.test.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `parseBlockConfig`, `detectFormat`, `inspectGlb`/`unsupportedRequired`, `toViewModel`, `PluginSettings`, `resolveModelPath`/`readModel`, `readSceneColors`, `Viewport`, `loadModel`.
- Produces:
  ```typescript
  export interface ViewportFactory {
    create(options: ViewportOptions): ViewportLike;      // in Tests gefaked
    isWebGLAvailable(): boolean;
  }
  export interface ViewportLike {
    setModel(o: unknown): void; setColors(c: SceneColors): void;
    resize(): void; resetCamera(): void;
    capturePoster(): string | null; dispose(): void;
  }
  export interface BlockDeps {
    app: App; settings: () => PluginSettings; factory: ViewportFactory;
    budget: { register(id: string, release: () => void): void;
              touch(id: string): void; unregister(id: string): void };
  }
  export class ModelBlock extends MarkdownRenderChild {
    constructor(containerEl: HTMLElement, source: string, sourcePath: string, deps: BlockDeps);
  }
  ```
  Die `ViewportFactory` ist der Testnaht-Punkt: im Plugin liefert sie eine echte `Viewport`, im Test einen Zähler-Fake — dadurch ist der Lebenszyklus ohne WebGL prüfbar.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/obsidian/block-child.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { TFile, makeFakeApp, makeFakeEl } from "../__mocks__/obsidian";
import { ModelBlock } from "../../src/obsidian/block-child";
import { DEFAULT_SETTINGS } from "../../src/core/settings-types";

function makeFactory() {
  const created: any[] = [];
  const factory = {
    isWebGLAvailable: () => true,
    create: (opts: any) => {
      const vp = {
        opts,
        disposed: 0,
        setModel: vi.fn(),
        setColors: vi.fn(),
        resize: vi.fn(),
        resetCamera: vi.fn(),
        capturePoster: () => "data:image/png;base64,AAA",
        dispose() { vp.disposed += 1; },
      };
      created.push(vp);
      return vp;
    },
  };
  return { factory, created };
}

function makeBudget() {
  return { register: vi.fn(), touch: vi.fn(), unregister: vi.fn() };
}

function glbFile(path = "a.glb", mtime = 1): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = { mtime, ctime: 0, size: 4 };
  return f;
}

describe("ModelBlock", () => {
  it("shows a config error and never builds a viewport", () => {
    const { factory, created } = makeFactory();
    const el = makeFakeEl();
    const block = new ModelBlock(el, "height: 300", "note.md", {
      app: makeFakeApp(), settings: () => DEFAULT_SETTINGS, factory, budget: makeBudget(),
    });

    block.onload();

    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("No `file:` given.");
  });

  it("reports a missing file with the path it looked for", async () => {
    const { factory } = makeFactory();
    const el = makeFakeEl();
    const app = makeFakeApp();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(null);
    const block = new ModelBlock(el, "file: missing.glb", "note.md", {
      app, settings: () => DEFAULT_SETTINGS, factory, budget: makeBudget(),
    });

    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("File not found: missing.glb");
  });

  it("rejects an unsupported extension before touching the vault", async () => {
    const { factory } = makeFactory();
    const el = makeFakeEl();
    const app = makeFakeApp();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile("model.obj"));
    const block = new ModelBlock(el, "file: model.obj", "note.md", {
      app, settings: () => DEFAULT_SETTINGS, factory, budget: makeBudget(),
    });

    block.onload();
    await block.loadNow();

    expect(JSON.stringify(el.children)).toContain("Unsupported format: model.obj");
    expect(app.vault.readBinary).not.toHaveBeenCalled();
  });

  it("disposes the viewport when Obsidian unloads the block", async () => {
    const { factory, created } = makeFactory();
    const el = makeFakeEl();
    const app = makeFakeApp();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    const block = new ModelBlock(el, "file: a.glb", "note.md", {
      app, settings: () => DEFAULT_SETTINGS, factory, budget: makeBudget(),
    });

    block.onload();
    await block.loadNow();
    block.onunload();

    expect(created).toHaveLength(1);
    expect(created[0].disposed).toBe(1);
  });

  it("unregisters from the context budget on unload", async () => {
    const { factory } = makeFactory();
    const budget = makeBudget();
    const app = makeFakeApp();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", {
      app, settings: () => DEFAULT_SETTINGS, factory, budget,
    });

    block.onload();
    await block.loadNow();
    block.onunload();

    expect(budget.unregister).toHaveBeenCalled();
  });

  it("reloads when its own file is modified", async () => {
    const { factory } = makeFactory();
    const app = makeFakeApp();
    const file = glbFile();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(file);
    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", {
      app, settings: () => DEFAULT_SETTINGS, factory, budget: makeBudget(),
    });

    block.onload();
    await block.loadNow();
    const before = app.vault.readBinary.mock.calls.length;
    file.stat.mtime = 999;
    await block.onFileModified(file);

    expect(app.vault.readBinary.mock.calls.length).toBe(before + 1);
  });

  it("ignores a modification of a different file", async () => {
    const { factory } = makeFactory();
    const app = makeFakeApp();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    const block = new ModelBlock(makeFakeEl(), "file: a.glb", "note.md", {
      app, settings: () => DEFAULT_SETTINGS, factory, budget: makeBudget(),
    });

    block.onload();
    await block.loadNow();
    const before = app.vault.readBinary.mock.calls.length;
    await block.onFileModified(glbFile("other.glb"));

    expect(app.vault.readBinary.mock.calls.length).toBe(before);
  });

  it("reports missing WebGL instead of building a viewport", async () => {
    const { factory, created } = makeFactory();
    factory.isWebGLAvailable = () => false;
    const el = makeFakeEl();
    const app = makeFakeApp();
    app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile());
    const block = new ModelBlock(el, "file: a.glb", "note.md", {
      app, settings: () => DEFAULT_SETTINGS, factory, budget: makeBudget(),
    });

    block.onload();
    await block.loadNow();

    expect(created).toHaveLength(0);
    expect(JSON.stringify(el.children)).toContain("WebGL is unavailable");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/block-child.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: `render-box.ts` implementieren**

Reines DOM-Gerüst, keine Entscheidungslogik (UI-STANDARD §6):

```
.tdcb-block
  .tdcb-title           (nur wenn title gesetzt)
  .tdcb-stage           (feste Höhe; nimmt Canvas oder Poster-Bild auf)
  .tdcb-message         (Meldungsbox; tone → .tdcb-message-error | .tdcb-message-info)
  .tdcb-hint            (Warnungen aus parseBlockConfig)
```

Funktionen: `buildBox(parent, opts) → { stage, message, hint, title }` und
`renderMessage(el, vm, onReload)` — setzt Text, Ton-Klasse, optionalen Button
(`Reload`, `mod-cta`) und Spinner. Nur `createDiv`/`createEl`, kein `innerHTML`.

- [ ] **Step 4: `block-child.ts` implementieren**

Ablauf in `onload()`:

1. `parseBlockConfig(source)`. Bei `errors` → `render(toViewModel({kind:"config-error", ...}))` und **Ende**.
2. Warnungen in die Hinweiszeile schreiben.
3. Box bauen; Höhe = `config.height ?? settings().defaultHeight`.
4. `IntersectionObserver` mit `rootMargin: "200% 0px"` auf die Box; beim ersten Sichtwerden `loadNow()`.

`loadNow()` (public, damit Tests es direkt aufrufen können — kein `IntersectionObserver` in node nötig):

1. `resolveModelPath` → `null` ⇒ `missing-file` mit dem Pfad aus der Config.
2. `detectFormat(file.path)` → `null` ⇒ `unsupported-format`, **vor** jedem Vault-Zugriff.
3. `readModel` → bei `gltf` und `.glb`-Endung: `inspectGlb`; `valid === false` ⇒ `invalid-file`; `unsupportedRequired(...)` nicht leer ⇒ `compressed-gltf`.
4. `factory.isWebGLAvailable()` falsch ⇒ `no-webgl`.
5. Viewport bauen (Modus `on-click`: bauen, Modell setzen, `capturePoster()`, sofort `dispose()`, Poster-Bild in die Bühne, Klick-Handler baut neu auf). `budget.register(id, () => this.degradeToPoster())`.
6. `loadModel(...)` → `setModel(...)` → Zustand `ready`.

Fehler aus `loadModel` in `try/catch` → `load-failed` mit `error.message`, Details per `console.error`.

`onFileModified(file)`: nur reagieren, wenn `file.path === this.file?.path` **und** `file.stat.mtime !== this.loadedMtime`; dann erneut laden.

`onunload()`: `viewport?.dispose()`, `observer?.disconnect()`, `budget.unregister(id)`, Poster-Referenz lösen. Vault- und Workspace-Abos laufen über `this.registerEvent(...)`, damit Obsidian sie selbst abräumt.

- [ ] **Step 5: CSS ergänzen**

`styles.css` um die `tdcb-`-Klassen erweitern — ausschließlich Theme-Variablen:

```css
.tdcb-block { margin: var(--size-4-2) 0; }
.tdcb-title { color: var(--text-muted); font-size: var(--font-ui-small); margin-bottom: var(--size-4-1); }
.tdcb-stage {
  position: relative; width: 100%; overflow: hidden;
  border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m);
  background: var(--background-primary);
}
.tdcb-stage canvas { display: block; width: 100%; height: 100%; }
.tdcb-poster { width: 100%; height: 100%; object-fit: contain; cursor: pointer; }
.tdcb-play {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: var(--text-on-accent); background: var(--background-modifier-hover); cursor: pointer;
}
.tdcb-message {
  display: flex; align-items: center; gap: var(--size-4-2);
  padding: var(--size-4-2); font-size: var(--font-ui-small); color: var(--text-normal);
}
.tdcb-message-error { background: var(--background-modifier-error); color: var(--text-error); border-radius: var(--radius-s); }
.tdcb-message-info { color: var(--text-muted); }
.tdcb-hint { color: var(--text-faint); font-size: var(--font-ui-smaller); padding: var(--size-4-1) var(--size-4-2); }
```

- [ ] **Step 6: Tests laufen lassen, grün bestätigen**

Run: `npx vitest run`
Expected: PASS, alle Tests aus Tasks 1–10.

- [ ] **Step 7: Commit**

```bash
git add src/obsidian styles.css tests/obsidian
git commit -m "feat(obsidian): Block-Lebenszyklus mit Dispose, Poster und Reload"
```

---

### Task 11: `main.ts`, Kontext-Budget und Settings-Tab

**Files:**
- Create: `src/obsidian/settings.ts`, `src/obsidian/context-manager.ts`, `tests/obsidian/context-manager.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `pickEvictions` (Task 6), `ModelBlock` (Task 10), `mergeSettings`/`PluginSettings` (Task 7), `Viewport` (Task 8).
- Produces:
  ```typescript
  export class ContextManager {
    constructor(limit: () => number, now: () => number);
    register(id: string, release: () => void): void;
    touch(id: string): void;
    unregister(id: string): void;
  }
  export class SettingsTab extends PluginSettingTab { … }
  ```
  `ContextManager` verdrängt nach jedem `register`/`touch` gemäß `pickEvictions` und ruft das `release` der verdrängten Einträge. `now` wird injiziert, damit der Test ohne Uhr auskommt.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```typescript
import { describe, expect, it, vi } from "vitest";
import { ContextManager } from "../../src/obsidian/context-manager";

describe("ContextManager", () => {
  it("keeps everything below the limit", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(() => 3, () => ++clock.t);
    const a = vi.fn(); const b = vi.fn();
    mgr.register("a", a);
    mgr.register("b", b);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("releases the least recently used once the limit is exceeded", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(() => 2, () => ++clock.t);
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn();
    mgr.register("a", a);
    mgr.register("b", b);
    mgr.register("c", c);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
  });

  it("protects a context that was just touched", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(() => 2, () => ++clock.t);
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn();
    mgr.register("a", a);
    mgr.register("b", b);
    mgr.touch("a");
    mgr.register("c", c);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("does not release an unregistered context", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(() => 1, () => ++clock.t);
    const a = vi.fn(); const b = vi.fn();
    mgr.register("a", a);
    mgr.unregister("a");
    mgr.register("b", b);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("releases each context only once", () => {
    const clock = { t: 0 };
    const mgr = new ContextManager(() => 1, () => ++clock.t);
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn();
    mgr.register("a", a);
    mgr.register("b", b);
    mgr.register("c", c);
    expect(a).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/context-manager.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: `ContextManager` implementieren**

`Map<string, { lastUsedAt: number; release: () => void }>`. `register` und `touch` setzen `lastUsedAt = now()`; danach `pickEvictions([...], limit())` aufrufen, für jede ID `release()` rufen und den Eintrag **aus der Map entfernen** (sonst wird derselbe Viewport mehrfach freigegeben).

- [ ] **Step 4: Settings-Tab implementieren**

`src/obsidian/settings.ts`: `PluginSettingTab` mit `display()` und fünf `new Setting(containerEl)`-Zeilen (Reihenfolge und Texte verbindlich, sentence case):

| Zeile | Steuerelement | Beschreibung |
|---|---|---|
| „View mode" | Dropdown `immediate` = „Interactive right away", `on-click` = „Still image, activate on click" | „How 3D blocks behave when a note opens." |
| „Default height" | Text (Zahl) | „Height in pixels for blocks without a `height:` key." |
| „Auto-rotate" | Toggle | „Slowly spin the model until you interact with it." |
| „Show ground grid" | Toggle | „Draw a reference grid under the model." |
| „Maximum live 3D views" | Text (Zahl) | „Older views turn into still images beyond this number. Raise only if your machine copes." |

Jede Änderung → `mergeSettings` anwenden, `plugin.saveSettings()`.

- [ ] **Step 5: `main.ts` verdrahten**

```typescript
import { MarkdownPostProcessorContext, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, mergeSettings } from "./core/settings-types";
import { ModelBlock } from "./obsidian/block-child";
import { ContextManager } from "./obsidian/context-manager";
import { SettingsTab } from "./obsidian/settings";
import { Viewport } from "./viewer/viewport";

export default class ThreeDCodeblocksPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private blocks = new Set<ModelBlock>();
  private contexts = new ContextManager(() => this.settings.maxContexts, () => Date.now());

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("3d", (source, el, ctx: MarkdownPostProcessorContext) => {
      const block = new ModelBlock(el, source, ctx.sourcePath, {
        app: this.app,
        settings: () => this.settings,
        factory: {
          create: (options) => new Viewport(options),
          isWebGLAvailable: () => Viewport.isWebGLAvailable(),
        },
        budget: this.contexts,
      });
      this.blocks.add(block);
      block.register(() => this.blocks.delete(block));
      ctx.addChild(block);
    });

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile) {
        for (const block of this.blocks) void block.onFileModified(file);
      }
    }));

    this.registerEvent(this.app.workspace.on("css-change", () => {
      for (const block of this.blocks) block.refreshColors();
    }));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

`ModelBlock` braucht dafür zusätzlich `refreshColors()` (liest die Theme-Farben neu und reicht sie an den Viewport durch) — in Task 10 mit angelegt, hier lediglich aufgerufen.

- [ ] **Step 6: Gate laufen lassen**

Run: `npm run gate`
Expected: alles grün, alle Tests aus Tasks 1–11.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: Codeblock-Processor, Kontext-Budget und Settings verdrahten"
```

---

### Task 12: README, Registry-Eintrag und Smoke-Vorbereitung

**Files:**
- Modify: `README.md`
- Modify: `../REGISTRY.md` (Dach-Repo `obsidian-plugins`)
- Create: `docs/SMOKE.md`

- [ ] **Step 1: README auf Dach-Standard umschreiben**

Der bisherige Seed-Inhalt (Idee, offene Fragen) ist mit der Spec überholt. Neues README: Was das Plugin tut, Codeblock-Beispiel mit allen drei Schlüsseln, unterstützte Formate, die bewusste Draco-/Meshopt-Grenze mit Begründung, Settings-Tabelle, Installation, Lizenz. Der Seed-Kontext bleibt über die Git-History erhalten und ist zusätzlich in der Spec §1 festgehalten.

- [ ] **Step 2: Smoke-Checkliste anlegen**

`docs/SMOKE.md` mit den zehn Punkten aus Spec §9, je als abhakbare Zeile, plus Feld für Datum und Obsidian-Version.

- [ ] **Step 3: Registry-Eintrag ergänzen (Kit-first-Regel Punkt 2)**

In `../REGISTRY.md` (Dach-Repo `obsidian-plugins`) eine Zeile in der passenden Kategorie ergänzen — das Ökosystem hatte bislang **kein** 3D-/WebGL-Primitiv:

> **WebGL-Viewport im Codeblock, leckfrei** (`MarkdownRenderChild.onunload` → `dispose()` traversiert Geometrien/Materialien/Texturen + `forceContextLoss()`; on-demand-Rendering statt rAF-Dauerloop; `IntersectionObserver` + LRU-Kontext-Budget gegen das Browser-Limit von ~8–16 Kontexten; Poster-Frame via `toDataURL` beim Degradieren) | `3d-codeblocks/src/viewer/viewport.ts` + `src/obsidian/block-child.ts` + `src/core/context-budget.ts` (pure, TDD) | Muster-Referenz, erstes Exemplar (2026-07-23) — three.js gebündelt; **Draco/Meshopt bewusst ausgeschlossen** (worker-basiert, Obsidian-Renderer verbietet Worker)

- [ ] **Step 4: Gate ein letztes Mal**

Run: `npm run gate`
Expected: alles grün.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/SMOKE.md
git commit -m "docs: README auf Dach-Standard, Smoke-Checkliste"
```

Der REGISTRY-Eintrag wird im Dach-Repo separat committet (eigenes Git-Repo).

---

## Self-Review

**Spec-Abdeckung:** §1 Zweck → README/Task 12 · §2 three.js + Draco-Grenze → Tasks 1, 4, 8 · §3 Architektur/Lebenszyklus → Tasks 2–11, Dispose in Task 10 getestet · §4 Syntax/Pfad/Cache → Tasks 2, 9, 10 · §5 Rendering/Sichtbarkeit/Budget/Kamera/Theme → Tasks 5, 6, 8, 10, 11 · §6 Fehlerbehandlung → Task 7 (Texte) + Task 10 (Auslösung) · §7 Settings → Tasks 7, 11 · §8 Tests → jede Task · §9 GUI-Smoke → Task 12 · §10 Repo-Aufbau → Task 1 · §11 YAGNI → nichts davon geplant.

**Offen gelassen (bewusst):** Die Poster-Erzeugung braucht `preserveDrawingBuffer` oder ein Auslesen unmittelbar nach dem Render-Aufruf (Task 8, Step 3). Sollte sich im Smoke zeigen, dass `toDataURL` ein leeres Bild liefert, ist die Nachbesserung, `preserveDrawingBuffer: true` nur für Viewports im Modus `on-click` zu setzen — die Alternative ist dokumentiert, damit sie niemand neu herleiten muss.
