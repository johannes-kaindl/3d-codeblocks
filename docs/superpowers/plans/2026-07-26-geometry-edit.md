# Geometrie-Edit (TP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit-Modus für den Viewer — Top-Level-Nodes verschieben/skalieren, Speichern als `<name>.edit.gltf`/`.edit.glb` per JSON-Patch aufs Original; erfüllt den Konsumenten-Kontrakt `docs/editor-anforderungen-outpost.md`.

**Architecture:** Die three.js-Szene ist nur Anzeige; Wahrheit ist eine pure `EditSession` (Node-Index → TRS). Gespeichert wird nie per Export, sondern per Patch des Original-JSON (`core/gltf-patch.ts`). Ein `EditCoordinator` (obsidian-Schicht, I/O injiziert) orchestriert Betreten/Overlay/Speichern/Reload; das Gizmo (`TransformControls`) hängt als `EditRig` am Viewport.

**Tech Stack:** TypeScript, three.js (gebündelt, inkl. `three/examples/jsm/controls/TransformControls.js`), Obsidian Plugin API, vitest (node-env, Obsidian-Mock unter `tests/__mocks__/obsidian.ts`).

**Spec:** `docs/superpowers/specs/2026-07-26-geometry-edit-design.md`

## Global Constraints

- **Kontrakt-Härte:** Patch ändert ausschließlich `translation`/`scale` bestehender Nodes. Nie `matrix` schreiben, nie `name` anfassen, nie Nodes hinzufügen/löschen, nie Mesh-/Buffer-Daten berühren (Spec §6).
- **UI-Sprache Englisch** — das ist ein Store-Plugin; alle sichtbaren Strings (Buttons, Notices, Tooltips) auf Englisch, wie die bestehenden („Save view", „View saved"). Die deutschen Formulierungen der Spec sind inhaltliche Vorgaben, keine Copy.
- **UI-STANDARD:** DOM nur über `createEl`/`createDiv`, Icon-Buttons brauchen `aria-label`, nur Theme-CSS-Variablen in styles.css.
- **Kein `GLTFExporter`**, keine neuen Dependencies, keine Worker.
- **Test-Setup:** vitest `environment: "node"`; Obsidian wird über den Alias `tests/__mocks__/obsidian.ts` gemockt (Skill `obsidian-plugin-test-pattern`). three.js-Mathe (Object3D, Raycaster) läuft headless.
- **Lesson-Pflicht (LESSONS 2026-07-26):** Jeder Enum-/Modus-Wert bekommt mindestens einen Test, der den Zweig wirklich durchläuft (translate/scale, Edit an/aus, Locked-Präfix leer/gesetzt, viewMode immediate/on-click).
- **Gate vor jedem Commit:** `npm test` grün; am Task-Ende zusätzlich `npm run build` (esbuild) fehlerfrei, wo TypeScript-Signaturen geändert wurden.
- Commit-Messages im bestehenden Stil (`feat(edit): …`, `test(edit): …`), Footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File Structure

| Datei | Status | Verantwortung |
|---|---|---|
| `src/core/gltf-patch.ts` | neu | pure: Top-Level-Analyse, TRS-Extraktion, JSON-/GLB-Patch |
| `src/core/edit-target.ts` | neu | pure: Zielpfad-Ableitung `eg.gltf` → `eg.edit.gltf`, in-place-Regel |
| `src/core/edit-session.ts` | neu | pure: Edit-Zustand, dirty, Overlay-Merge; UI-Modell-Typen (`EditUiModel`, `EditRigLike`) |
| `src/core/settings-types.ts` | ändern | Setting `lockedNodePrefixes` + `parseLockedPrefixes` |
| `src/core/gltf-inspect.ts` | ändern | GLB-Konstanten + `glbJsonText()` exportieren (bisher modul-privat) |
| `src/core/active-viewport.ts` | ändern | `notify()`-Methode; `ViewportController.editPanel?` |
| `src/viewer/loaders.ts` | ändern | `userData.tdcbNodeIndex` aus GLTFLoader-`associations` |
| `src/viewer/edit-controls.ts` | neu | `EditRig`: TransformControls + Raycast-Picking |
| `src/viewer/viewport.ts` | ändern | `createEditRig()` |
| `src/obsidian/viewer-host.ts` | ändern | `pin()`, `createEditRig()`-Delegation, `ViewportLike.createEditRig?` |
| `src/obsidian/edit-mode.ts` | neu | `EditCoordinator` (enter/save/discard/reload), `EditIo` + `vaultEditIo` |
| `src/obsidian/confirm.ts` | neu | Bestätigungsdialog (Obsidian-Modal) als Promise |
| `src/obsidian/viewport-toolbar.ts` | ändern | Edit-Zustand der Toolbar |
| `src/obsidian/block-child.ts` | ändern | Coordinator-Verdrahtung im Block |
| `src/obsidian/control-panel.ts` | ändern | Edit-Sektion mit Zahlenfeldern |
| `src/obsidian/read-only-controller.ts` | ändern | optionaler `editPanel`-Durchgriff |
| `src/obsidian/embed.ts`, `src/obsidian/file-view.ts` | ändern | Coordinator für Embed/FileView (Bedienung über Sidebar) |
| `src/obsidian/settings.ts`, `src/main.ts`, `styles.css` | ändern | Setting-Zeile, Verdrahtung, Styles |
| `tests/helpers/contract-gltf.ts` | neu | Kontrakt-Fixture (Generator-Bauart) |

**Bedienwege:** Die Hover-Toolbar existiert nur am Codeblock — dort bekommt sie die Edit-Buttons. Embed und FileView werden ausschließlich über die Sidebar bedient (die ohnehin den aktiven Viewport zeigt); dafür bekommt die Sidebar dieselbe Edit-UI. Das deckt Spec §2.1 („alle Betrachtungswege") ohne neue Toolbar-Flächen ab.

---

### Task 1: `core/gltf-patch.ts` — Analyse & TRS-Extraktion + Kontrakt-Fixture

**Files:**
- Create: `src/core/gltf-patch.ts`
- Create: `tests/helpers/contract-gltf.ts`
- Test: `tests/core/gltf-patch.test.ts`

**Interfaces:**
- Consumes: nichts (pure, nur JSON).
- Produces: `Vec3`, `NodeTrs { translation: Vec3; scale: Vec3 }`, `LockReason = "prefix" | "matrix" | "duplicate-name" | "unnamed"`, `EditableNode { index: number; name: string; base: NodeTrs; lock: LockReason | null }`, `analyzeTopLevelNodes(json: unknown, lockedPrefixes: string[]): EditableNode[]`, `extractTrsByName(json: unknown): Map<string, NodeTrs>`. Fixture: `makeContractGltf(): Record<string, unknown>` und `contractGltfText(): string`.

- [ ] **Step 1: Fixture-Helper schreiben**

```ts
// tests/helpers/contract-gltf.ts
// Mini-glTF nach Generator-Bauart (Spec §7): Raum-Nodes, __dome-Kind, env__-Node,
// data-URI-Buffer. Bewusst als Objekt, damit Tests einzelne Felder abwandeln koennen.
export function makeContractGltf(): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 2, 3] }],
    nodes: [
      { name: "privat-herd", mesh: 0, translation: [1, 0, 2], children: [1] },
      { name: "privat-herd__dome", mesh: 0, translation: [0, 0, 0] },
      { name: "privat-bad", mesh: 0, translation: [-3, 0, 1], scale: [1, 1, 1] },
      { name: "env__gelaende", mesh: 0, translation: [0, -0.1, 0] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [
      {
        byteLength: 36,
        uri: "data:application/octet-stream;base64," + btoa(String.fromCharCode(...new Uint8Array(36))),
      },
    ],
  };
}

export function contractGltfText(): string {
  return JSON.stringify(makeContractGltf());
}
```

- [ ] **Step 2: Failing Tests schreiben**

```ts
// tests/core/gltf-patch.test.ts
import { describe, expect, it } from "vitest";
import { analyzeTopLevelNodes, extractTrsByName } from "../../src/core/gltf-patch";
import { makeContractGltf } from "../helpers/contract-gltf";

describe("analyzeTopLevelNodes", () => {
  it("liefert die Szenen-Nodes in Reihenfolge, mit TRS-Defaults", () => {
    const nodes = analyzeTopLevelNodes(makeContractGltf(), []);
    expect(nodes.map((n) => n.name)).toEqual(["privat-herd", "privat-bad", "env__gelaende"]);
    expect(nodes[0].index).toBe(0);
    expect(nodes[0].base).toEqual({ translation: [1, 0, 2], scale: [1, 1, 1] });
    expect(nodes[1].base.scale).toEqual([1, 1, 1]);
  });

  it("Kind-Nodes (__dome) erscheinen nicht — nur Top-Level ist waehlbar", () => {
    const nodes = analyzeTopLevelNodes(makeContractGltf(), []);
    expect(nodes.some((n) => n.name === "privat-herd__dome")).toBe(false);
  });

  it("sperrt Nodes mit passendem Praefix", () => {
    const nodes = analyzeTopLevelNodes(makeContractGltf(), ["env__"]);
    expect(nodes.find((n) => n.name === "env__gelaende")?.lock).toBe("prefix");
    expect(nodes.find((n) => n.name === "privat-herd")?.lock).toBeNull();
  });

  it("ohne Praefix-Liste ist nichts praefix-gesperrt", () => {
    const nodes = analyzeTopLevelNodes(makeContractGltf(), []);
    expect(nodes.every((n) => n.lock !== "prefix")).toBe(true);
  });

  it("sperrt Nodes mit matrix-Transform", () => {
    const json = makeContractGltf();
    (json.nodes as Record<string, unknown>[])[0].matrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const nodes = analyzeTopLevelNodes(json, []);
    expect(nodes.find((n) => n.name === "privat-herd")?.lock).toBe("matrix");
  });

  it("sperrt doppelte Namen — der Slug-Schluessel waere mehrdeutig", () => {
    const json = makeContractGltf();
    (json.nodes as Record<string, unknown>[])[2].name = "privat-herd";
    const nodes = analyzeTopLevelNodes(json, []);
    expect(nodes.filter((n) => n.lock === "duplicate-name")).toHaveLength(2);
  });

  it("sperrt namenlose Nodes", () => {
    const json = makeContractGltf();
    delete (json.nodes as Record<string, unknown>[])[2].name;
    const nodes = analyzeTopLevelNodes(json, []);
    expect(nodes[1].lock).toBe("unnamed");
    expect(nodes[1].name).toBe("#2"); // Anzeige-Fallback: Index
  });

  it("wirft nicht bei kaputtem JSON-Gerippe, sondern liefert []", () => {
    expect(analyzeTopLevelNodes(null, [])).toEqual([]);
    expect(analyzeTopLevelNodes({ scenes: "nope" }, [])).toEqual([]);
  });
});

describe("extractTrsByName", () => {
  it("liefert TRS pro benanntem Top-Level-Node", () => {
    const map = extractTrsByName(makeContractGltf());
    expect(map.get("privat-herd")).toEqual({ translation: [1, 0, 2], scale: [1, 1, 1] });
    expect(map.get("env__gelaende")).toEqual({ translation: [0, -0.1, 0], scale: [1, 1, 1] });
    expect(map.has("privat-herd__dome")).toBe(false);
  });
});
```

- [ ] **Step 3: Test laufen lassen — muss fehlschlagen** (`npx vitest run tests/core/gltf-patch.test.ts` → Modul nicht gefunden)

- [ ] **Step 4: Implementierung**

```ts
// src/core/gltf-patch.ts
// glTF byte-schonend analysieren und patchen — pure, ohne three.
//
// Der Editor exportiert NIE die Szene: gespeichert wird durch gezieltes Ersetzen
// von translation/scale im Original-JSON. Dadurch koennen die Kontrakt-Regeln
// (keine Mesh-Edits, keine Node-CRUD, keine matrix, Namen unangetastet) gar nicht
// verletzt werden — sie sind Struktureigenschaft, kein Versprechen.

export type Vec3 = [number, number, number];

export interface NodeTrs {
  translation: Vec3;
  scale: Vec3;
}

export type LockReason = "prefix" | "matrix" | "duplicate-name" | "unnamed";

export interface EditableNode {
  index: number;
  name: string;
  base: NodeTrs;
  lock: LockReason | null;
}

interface GltfNode {
  name?: unknown;
  translation?: unknown;
  scale?: unknown;
  matrix?: unknown;
}

interface GltfDoc {
  scene?: unknown;
  scenes?: unknown;
  nodes?: unknown;
}

const DEFAULT_TRANSLATION: Vec3 = [0, 0, 0];
const DEFAULT_SCALE: Vec3 = [1, 1, 1];

function vec3(value: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number")
    ? [value[0], value[1], value[2]]
    : [...fallback];
}

/** Indizes der Root-Nodes der aktiven Szene — [] bei jedem Struktur-Defekt. */
function sceneNodeIndices(doc: GltfDoc): number[] {
  if (typeof doc !== "object" || doc === null || !Array.isArray(doc.scenes)) return [];
  const sceneIndex = typeof doc.scene === "number" ? doc.scene : 0;
  const scene = doc.scenes[sceneIndex] as { nodes?: unknown } | undefined;
  if (!scene || !Array.isArray(scene.nodes)) return [];
  return scene.nodes.filter((n): n is number => typeof n === "number");
}

export function analyzeTopLevelNodes(json: unknown, lockedPrefixes: string[]): EditableNode[] {
  const doc = json as GltfDoc;
  const indices = sceneNodeIndices(doc);
  if (indices.length === 0 || !Array.isArray(doc.nodes)) return [];

  const nodes = doc.nodes as GltfNode[];
  const named = indices
    .map((index) => ({ index, node: nodes[index] }))
    .filter((entry): entry is { index: number; node: GltfNode } => entry.node !== undefined);

  const nameCounts = new Map<string, number>();
  for (const { node } of named) {
    if (typeof node.name === "string" && node.name !== "") {
      nameCounts.set(node.name, (nameCounts.get(node.name) ?? 0) + 1);
    }
  }

  return named.map(({ index, node }) => {
    const name = typeof node.name === "string" && node.name !== "" ? node.name : `#${index}`;
    const unnamed = typeof node.name !== "string" || node.name === "";
    const lock: LockReason | null = unnamed
      ? "unnamed"
      : node.matrix !== undefined
        ? "matrix"
        : lockedPrefixes.some((p) => name.startsWith(p))
          ? "prefix"
          : (nameCounts.get(name) ?? 0) > 1
            ? "duplicate-name"
            : null;

    return {
      index,
      name,
      base: {
        translation: vec3(node.translation, DEFAULT_TRANSLATION),
        scale: vec3(node.scale, DEFAULT_SCALE),
      },
      lock,
    };
  });
}

/** TRS pro benanntem Top-Level-Node — der Overlay-Leseweg (Edit-Datei → Original). */
export function extractTrsByName(json: unknown): Map<string, NodeTrs> {
  const map = new Map<string, NodeTrs>();
  for (const node of analyzeTopLevelNodes(json, [])) {
    if (node.lock === "unnamed" || node.lock === "duplicate-name") continue;
    map.set(node.name, node.base);
  }
  return map;
}
```

- [ ] **Step 5: Tests grün** (`npx vitest run tests/core/gltf-patch.test.ts`)

- [ ] **Step 6: Commit** — `git add src/core/gltf-patch.ts tests/helpers/contract-gltf.ts tests/core/gltf-patch.test.ts && git commit -m "feat(edit): glTF-Analyse — Top-Level-Nodes, TRS, Sperrgruende (pure)"`

---

### Task 2: `core/gltf-patch.ts` — JSON-Patch + GLB-Container-Patch

**Files:**
- Modify: `src/core/gltf-patch.ts`
- Modify: `src/core/gltf-inspect.ts` (Konstanten + `glbJsonText` exportieren)
- Test: `tests/core/gltf-patch.test.ts` (erweitern), `tests/core/gltf-inspect.test.ts` (unangetastet lassen — nur prüfen, dass er grün bleibt)

**Interfaces:**
- Consumes: `analyzeTopLevelNodes` (Task 1), GLB-Chunk-Wissen aus `gltf-inspect.ts`.
- Produces: `TrsEdit { index: number; translation: Vec3; scale: Vec3 }`, `patchGltfJson(text: string, edits: TrsEdit[]): string`, `patchGlbContainer(buffer: ArrayBuffer, edits: TrsEdit[]): ArrayBuffer`. Aus `gltf-inspect.ts` neu exportiert: `glbJsonText(buffer: ArrayBuffer): string | null`.

- [ ] **Step 1: Failing Tests schreiben** (an `tests/core/gltf-patch.test.ts` anhängen)

```ts
import { patchGltfJson, patchGlbContainer, type TrsEdit } from "../../src/core/gltf-patch";
import { glbJsonText } from "../../src/core/gltf-inspect";
import { contractGltfText } from "../helpers/contract-gltf";

const MOVE: TrsEdit[] = [{ index: 0, translation: [4, 0, 2], scale: [1, 1, 1] }];

describe("patchGltfJson", () => {
  it("ersetzt nur translation/scale des adressierten Nodes — Rest identisch", () => {
    const before = JSON.parse(contractGltfText());
    const after = JSON.parse(patchGltfJson(contractGltfText(), MOVE));
    expect(after.nodes[0].translation).toEqual([4, 0, 2]);
    expect(after.nodes[0].scale).toEqual([1, 1, 1]);
    // Alles andere Property-fuer-Property unveraendert:
    expect(after.nodes[0].name).toBe(before.nodes[0].name);
    expect(after.nodes[0].children).toEqual(before.nodes[0].children);
    expect(after.nodes.length).toBe(before.nodes.length);
    expect(after.buffers).toEqual(before.buffers);
    expect(after.meshes).toEqual(before.meshes);
    expect(after.accessors).toEqual(before.accessors);
    expect(after.scenes).toEqual(before.scenes);
  });

  it("schreibt nie matrix und loescht keine rotation", () => {
    const json = JSON.parse(contractGltfText());
    json.nodes[0].rotation = [0, 0, 0, 1];
    const after = JSON.parse(patchGltfJson(JSON.stringify(json), MOVE));
    expect(after.nodes[0].matrix).toBeUndefined();
    expect(after.nodes[0].rotation).toEqual([0, 0, 0, 1]);
  });

  it("wirft bei unbekanntem Node-Index", () => {
    expect(() => patchGltfJson(contractGltfText(), [{ index: 99, translation: [0,0,0], scale: [1,1,1] }]))
      .toThrow(/99/);
  });

  it("wirft bei Node mit matrix — der ist per Analyse gesperrt, ein Edit hier ist ein Bug", () => {
    const json = JSON.parse(contractGltfText());
    json.nodes[0].matrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    expect(() => patchGltfJson(JSON.stringify(json), MOVE)).toThrow(/matrix/);
  });
});

describe("patchGlbContainer", () => {
  /** Kontrakt-JSON als GLB verpacken: 12-Byte-Header + JSON-Chunk + BIN-Chunk. */
  function makeGlb(jsonText: string): ArrayBuffer {
    const jsonBytes = new TextEncoder().encode(jsonText);
    const jsonPadded = (jsonBytes.length + 3) & ~3;
    const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // 8 Bytes, schon 4er-aligned
    const total = 12 + 8 + jsonPadded + 8 + bin.length;
    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    view.setUint32(0, 0x46546c67, true); // magic "glTF"
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonPadded, true);
    view.setUint32(16, 0x4e4f534a, true); // "JSON"
    bytes.fill(0x20, 20, 20 + jsonPadded);
    bytes.set(jsonBytes, 20);
    view.setUint32(20 + jsonPadded, bin.length, true);
    view.setUint32(24 + jsonPadded, 0x004e4942, true); // "BIN\0"
    bytes.set(bin, 28 + jsonPadded);
    return buffer;
  }

  it("patcht den JSON-Chunk und laesst den BIN-Chunk byte-identisch", () => {
    const glb = makeGlb(contractGltfText());
    const patched = patchGlbContainer(glb, MOVE);
    const after = JSON.parse(glbJsonText(patched) ?? "null");
    expect(after.nodes[0].translation).toEqual([4, 0, 2]);
    // BIN-Chunk (letzte 8 Bytes) unveraendert:
    expect([...new Uint8Array(patched).slice(-8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("haelt Header-Laenge und 4-Byte-Padding der GLB-Spec ein", () => {
    const patched = patchGlbContainer(makeGlb(contractGltfText()), MOVE);
    const view = new DataView(patched);
    expect(view.getUint32(8, true)).toBe(patched.byteLength);
    expect(view.getUint32(12, true) % 4).toBe(0);
  });

  it("wirft bei ungueltigem Container", () => {
    expect(() => patchGlbContainer(new ArrayBuffer(4), MOVE)).toThrow();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

- [ ] **Step 3: `gltf-inspect.ts` erweitern** — Konstanten exportieren und den JSON-Chunk-Lesepfad als Funktion herausziehen (der bestehende `inspectGlb` nutzt sie danach):

```ts
// In src/core/gltf-inspect.ts: aus den privaten consts werden Exporte,
// und der Chunk-Lesepfad wird wiederverwendbar:
export const GLB_MAGIC = 0x46546c67;
export const CHUNK_TYPE_JSON = 0x4e4f534a;
export const GLB_HEADER_BYTES = 12;
export const GLB_CHUNK_HEADER_BYTES = 8;

/** Text des JSON-Chunks — `null` bei jedem Struktur-Defekt. */
export function glbJsonText(buffer: ArrayBuffer): string | null {
  if (buffer.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  if (view.getUint32(GLB_HEADER_BYTES + 4, true) !== CHUNK_TYPE_JSON) return null;
  const jsonLength = view.getUint32(GLB_HEADER_BYTES, true);
  const jsonStart = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
  if (jsonLength === 0 || jsonStart + jsonLength > buffer.byteLength) return null;
  return new TextDecoder().decode(new Uint8Array(buffer, jsonStart, jsonLength));
}
```

`inspectGlb` intern auf `glbJsonText` umstellen (JSON.parse in try/catch bleibt dort). Bestehende `gltf-inspect.test.ts` muss unverändert grün bleiben.

- [ ] **Step 4: Patch-Funktionen implementieren** (an `src/core/gltf-patch.ts` anhängen)

```ts
import {
  CHUNK_TYPE_JSON,
  GLB_CHUNK_HEADER_BYTES,
  GLB_HEADER_BYTES,
  GLB_MAGIC,
  glbJsonText,
} from "./gltf-inspect";

export interface TrsEdit {
  index: number;
  translation: Vec3;
  scale: Vec3;
}

export function patchGltfJson(text: string, edits: TrsEdit[]): string {
  const doc = JSON.parse(text) as GltfDoc;
  if (!Array.isArray(doc.nodes)) throw new Error("glTF has no nodes array");
  const nodes = doc.nodes as GltfNode[];

  for (const edit of edits) {
    const node = nodes[edit.index];
    if (node === undefined) throw new Error(`glTF node index ${edit.index} does not exist`);
    // Gesperrt ab Analyse — landet trotzdem ein Edit hier, ist das ein Programmierfehler,
    // und stilles Ueberschreiben wuerde den Kontrakt (TRS statt matrix) brechen.
    if (node.matrix !== undefined) throw new Error(`node ${edit.index} uses a matrix transform`);
    node.translation = [...edit.translation];
    node.scale = [...edit.scale];
  }

  return JSON.stringify(doc);
}

export function patchGlbContainer(buffer: ArrayBuffer, edits: TrsEdit[]): ArrayBuffer {
  const jsonText = glbJsonText(buffer);
  if (jsonText === null) throw new Error("not a valid GLB container");

  const patchedJson = new TextEncoder().encode(patchGltfJson(jsonText, edits));
  // GLB-Spec: JSON-Chunk mit 0x20 (Space) auf ein Vielfaches von 4 auffuellen.
  const paddedLength = (patchedJson.length + 3) & ~3;

  const view = new DataView(buffer);
  const oldJsonLength = view.getUint32(GLB_HEADER_BYTES, true);
  const restStart = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + oldJsonLength;
  const rest = new Uint8Array(buffer, restStart); // BIN-Chunk inkl. Header, verbatim

  const total = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + paddedLength + rest.byteLength;
  const out = new ArrayBuffer(total);
  const outView = new DataView(out);
  const outBytes = new Uint8Array(out);

  outView.setUint32(0, GLB_MAGIC, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, total, true);
  outView.setUint32(GLB_HEADER_BYTES, paddedLength, true);
  outView.setUint32(GLB_HEADER_BYTES + 4, CHUNK_TYPE_JSON, true);
  outBytes.fill(0x20, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + paddedLength);
  outBytes.set(patchedJson, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES);
  outBytes.set(rest, GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + paddedLength);
  return out;
}
```

- [ ] **Step 5: Alle Tests grün** (`npx vitest run tests/core/`)

- [ ] **Step 6: Commit** — `feat(edit): JSON- und GLB-Patch — nur translation/scale, Container byte-schonend`

---

### Task 3: `core/edit-target.ts` — Zielpfad-Ableitung

**Files:**
- Create: `src/core/edit-target.ts`
- Test: `tests/core/edit-target.test.ts`

**Interfaces:**
- Produces: `EditTarget { path: string; inPlace: boolean }`, `editTargetPath(path: string): EditTarget | null` (null bei nicht-editierbarer Endung), `editFormatFor(path: string): "gltf-json" | "glb" | null`.

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/edit-target.test.ts
import { describe, expect, it } from "vitest";
import { editFormatFor, editTargetPath } from "../../src/core/edit-target";

describe("editTargetPath", () => {
  it("leitet die Nachbar-Datei ab: eg.gltf → eg.edit.gltf", () => {
    expect(editTargetPath("weltmodell/3d/eg.gltf")).toEqual({
      path: "weltmodell/3d/eg.edit.gltf",
      inPlace: false,
    });
  });

  it("behaelt die Endung: haus.glb → haus.edit.glb", () => {
    expect(editTargetPath("haus.glb")).toEqual({ path: "haus.edit.glb", inPlace: false });
  });

  it("Edit-Datei selbst → in-place (kein eg.edit.edit.gltf)", () => {
    expect(editTargetPath("weltmodell/3d/eg.edit.gltf")).toEqual({
      path: "weltmodell/3d/eg.edit.gltf",
      inPlace: true,
    });
  });

  it("STL und Unbekanntes sind nicht editierbar", () => {
    expect(editTargetPath("teil.stl")).toBeNull();
    expect(editTargetPath("bild.png")).toBeNull();
  });
});

describe("editFormatFor", () => {
  it("unterscheidet JSON-glTF und GLB, case-insensitiv", () => {
    expect(editFormatFor("eg.gltf")).toBe("gltf-json");
    expect(editFormatFor("HAUS.GLB")).toBe("glb");
    expect(editFormatFor("teil.stl")).toBeNull();
  });
});
```

- [ ] **Step 2: Test fehlschlagen sehen · Step 3: Implementierung**

```ts
// src/core/edit-target.ts
// Wohin speichert der Editor? Pure. Das "nie in-place"-Verbot des Kontrakts schuetzt
// Originale (der Generator ueberschreibt sie); eine .edit.-Datei ist bereits User-Edit
// und wird deshalb in-place fortgeschrieben.

export interface EditTarget {
  path: string;
  inPlace: boolean;
}

export type EditFormat = "gltf-json" | "glb";

export function editFormatFor(path: string): EditFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".gltf")) return "gltf-json";
  if (lower.endsWith(".glb")) return "glb";
  return null;
}

export function editTargetPath(path: string): EditTarget | null {
  const match = path.match(/^(.*)\.(gltf|glb)$/i);
  if (!match) return null;
  const [, stem, ext] = match;
  if (stem.toLowerCase().endsWith(".edit")) return { path, inPlace: true };
  return { path: `${stem}.edit.${ext}`, inPlace: false };
}
```

- [ ] **Step 4: Tests grün · Step 5: Commit** — `feat(edit): Zielpfad-Ableitung fuer .edit.-Dateien (pure)`

---

### Task 4: `core/edit-session.ts` — Edit-Zustand + Overlay

**Files:**
- Create: `src/core/edit-session.ts`
- Test: `tests/core/edit-session.test.ts`

**Interfaces:**
- Consumes: `EditableNode`, `NodeTrs`, `TrsEdit` aus Task 1/2.
- Produces:
  - `class EditSession`: `list(): EditableNode[]` · `isSelectable(index): boolean` · `current(index): NodeTrs | null` · `set(index, trs): void` · `resetNode(index): void` · `dirty: boolean` (ggü. letztem Save) · `changes(): TrsEdit[]` (ggü. Original) · `markSaved(): void` · `applyOverlay(byName: Map<string, NodeTrs>): { applied: number; lost: string[] }` · `editsByName(): Map<string, NodeTrs>`.
  - UI-/Rig-Kontrakte für spätere Tasks: `EditRigLike { setMode(m: "translate"|"scale"): void; select(index: number|null): void; applyTrs(index: number, trs: NodeTrs): void; dispose(): void }` und `EditUiModel { active: boolean; disabledReason: string | null; mode: "translate"|"scale"; dirty: boolean; selection: { name: string; trs: NodeTrs } | null; enter(): void; save(): void; discard(): void; setMode(m: "translate"|"scale"): void; reset(): void; applyTrs(trs: NodeTrs): void }`.

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/edit-session.test.ts
import { describe, expect, it } from "vitest";
import { EditSession } from "../../src/core/edit-session";
import type { EditableNode } from "../../src/core/gltf-patch";

const trs = (t: [number, number, number], s: [number, number, number] = [1, 1, 1]) => ({
  translation: t,
  scale: s,
});

function nodes(): EditableNode[] {
  return [
    { index: 0, name: "privat-herd", base: trs([1, 0, 2]), lock: null },
    { index: 2, name: "privat-bad", base: trs([-3, 0, 1]), lock: null },
    { index: 3, name: "env__gelaende", base: trs([0, -0.1, 0]), lock: "prefix" },
  ];
}

describe("EditSession", () => {
  it("startet sauber: nicht dirty, keine Aenderungen, current = base", () => {
    const s = new EditSession(nodes());
    expect(s.dirty).toBe(false);
    expect(s.changes()).toEqual([]);
    expect(s.current(0)).toEqual(trs([1, 0, 2]));
  });

  it("set macht dirty und erscheint in changes()", () => {
    const s = new EditSession(nodes());
    s.set(0, trs([4, 0, 2]));
    expect(s.dirty).toBe(true);
    expect(s.changes()).toEqual([{ index: 0, translation: [4, 0, 2], scale: [1, 1, 1] }]);
  });

  it("set auf gesperrtem Node wird ignoriert", () => {
    const s = new EditSession(nodes());
    s.set(3, trs([9, 9, 9]));
    expect(s.dirty).toBe(false);
    expect(s.isSelectable(3)).toBe(false);
  });

  it("resetNode stellt base wieder her", () => {
    const s = new EditSession(nodes());
    s.set(0, trs([4, 0, 2]));
    s.resetNode(0);
    expect(s.dirty).toBe(false);
    expect(s.current(0)).toEqual(trs([1, 0, 2]));
  });

  it("markSaved: dirty faellt, changes() bleibt (Patch vergleicht gegen ORIGINAL)", () => {
    const s = new EditSession(nodes());
    s.set(0, trs([4, 0, 2]));
    s.markSaved();
    expect(s.dirty).toBe(false);
    expect(s.changes()).toHaveLength(1);
    s.set(2, trs([-5, 0, 1]));
    expect(s.dirty).toBe(true);
  });

  it("applyOverlay setzt per Name und zaehlt Verlorene; Overlay macht dirty (Spec §4)", () => {
    const s = new EditSession(nodes());
    const result = s.applyOverlay(
      new Map([
        ["privat-herd", trs([7, 0, 2])],
        ["abgerissen", trs([0, 0, 0])],
        ["env__gelaende", trs([9, 9, 9])], // gesperrt → verloren
      ]),
    );
    expect(result.applied).toBe(1);
    expect(result.lost.sort()).toEqual(["abgerissen", "env__gelaende"]);
    expect(s.dirty).toBe(true);
    expect(s.current(0)).toEqual(trs([7, 0, 2]));
  });

  it("editsByName liefert die Abweichungen vom Original fuers Reload-Reapply", () => {
    const s = new EditSession(nodes());
    s.set(0, trs([4, 0, 2]));
    expect([...s.editsByName().entries()]).toEqual([["privat-herd", trs([4, 0, 2])]]);
  });
});
```

- [ ] **Step 2: fehlschlagen sehen · Step 3: Implementierung**

```ts
// src/core/edit-session.ts
// Der Edit-Zustand — die Wahrheit des Editors. Pure; die three.js-Szene ist nur Anzeige.
//
// Zwei Bezugspunkte, bewusst getrennt: `changes()` vergleicht gegen das ORIGINAL
// (der Patch schreibt immer die Gesamt-Abweichung), `dirty` gegen den letzten
// Save-Stand (steuert nur den Speichern-Button).
import type { EditableNode, NodeTrs, TrsEdit, Vec3 } from "./gltf-patch";

export interface EditRigLike {
  setMode(mode: "translate" | "scale"): void;
  select(index: number | null): void;
  applyTrs(index: number, trs: NodeTrs): void;
  dispose(): void;
}

/** Ein UI-Modell fuer BEIDE Bedienorte (Toolbar am Block, Sidebar-Panel). */
export interface EditUiModel {
  active: boolean;
  disabledReason: string | null;
  mode: "translate" | "scale";
  dirty: boolean;
  selection: { name: string; trs: NodeTrs } | null;
  enter(): void;
  save(): void;
  discard(): void;
  setMode(mode: "translate" | "scale"): void;
  reset(): void;
  applyTrs(trs: NodeTrs): void;
}

const same = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const sameTrs = (a: NodeTrs, b: NodeTrs) => same(a.translation, b.translation) && same(a.scale, b.scale);
const copy = (trs: NodeTrs): NodeTrs => ({ translation: [...trs.translation], scale: [...trs.scale] });

export class EditSession {
  private readonly byIndex = new Map<number, EditableNode>();
  private readonly currentTrs = new Map<number, NodeTrs>();
  private readonly savedTrs = new Map<number, NodeTrs>();

  constructor(private readonly nodes: EditableNode[]) {
    for (const node of nodes) {
      this.byIndex.set(node.index, node);
      this.currentTrs.set(node.index, copy(node.base));
      this.savedTrs.set(node.index, copy(node.base));
    }
  }

  list(): EditableNode[] {
    return this.nodes;
  }

  isSelectable(index: number): boolean {
    return this.byIndex.get(index)?.lock === null;
  }

  current(index: number): NodeTrs | null {
    const trs = this.currentTrs.get(index);
    return trs ? copy(trs) : null;
  }

  set(index: number, trs: NodeTrs): void {
    if (!this.isSelectable(index)) return;
    this.currentTrs.set(index, copy(trs));
  }

  resetNode(index: number): void {
    const node = this.byIndex.get(index);
    if (node) this.currentTrs.set(index, copy(node.base));
  }

  get dirty(): boolean {
    for (const [index, trs] of this.currentTrs) {
      const saved = this.savedTrs.get(index);
      if (saved && !sameTrs(trs, saved)) return true;
    }
    return false;
  }

  /** Abweichungen vom ORIGINAL — das ist, was der Patch schreibt. */
  changes(): TrsEdit[] {
    const edits: TrsEdit[] = [];
    for (const node of this.nodes) {
      const trs = this.currentTrs.get(node.index);
      if (trs && !sameTrs(trs, node.base)) {
        edits.push({ index: node.index, translation: [...trs.translation], scale: [...trs.scale] });
      }
    }
    return edits;
  }

  markSaved(): void {
    for (const [index, trs] of this.currentTrs) this.savedTrs.set(index, copy(trs));
  }

  applyOverlay(byName: Map<string, NodeTrs>): { applied: number; lost: string[] } {
    const lost: string[] = [];
    let applied = 0;
    const byNodeName = new Map(this.nodes.map((n) => [n.name, n]));
    for (const [name, trs] of byName) {
      const node = byNodeName.get(name);
      if (!node || node.lock !== null) {
        lost.push(name);
        continue;
      }
      // Overlay nur zaehlen, wenn es wirklich abweicht — sonst meldet die Notice
      // "N uebernommen" fuer Nodes, die im Edit-File unveraendert mitgeschrieben wurden.
      if (sameTrs(trs, node.base)) continue;
      this.currentTrs.set(node.index, copy(trs));
      applied += 1;
    }
    return { applied, lost };
  }

  /** Abweichungen vom Original, per Name — fuers Wieder-Anwenden nach einem Reload. */
  editsByName(): Map<string, NodeTrs> {
    const map = new Map<string, NodeTrs>();
    for (const edit of this.changes()) {
      const node = this.byIndex.get(edit.index);
      if (node) map.set(node.name, { translation: edit.translation, scale: edit.scale });
    }
    return map;
  }
}
```

- [ ] **Step 4: Tests grün · Step 5: Commit** — `feat(edit): EditSession — dirty/changes getrennt, Overlay-Merge per Name (pure)`

---

### Task 5: Setting „Locked node prefixes"

**Files:**
- Modify: `src/core/settings-types.ts`
- Modify: `src/obsidian/settings.ts` (Definition-Item in der bestehenden `SettingDefinitionItem`-Liste — exakt dem Muster der vorhandenen 6 Einträge folgen)
- Test: `tests/core/settings-types.test.ts` (erweitern), `tests/obsidian/settings.test.ts` (erweitern, dem Muster der bestehenden Zeilen-Tests folgen)

**Interfaces:**
- Produces: `PluginSettings.lockedNodePrefixes: string` (Default `"env__"`), `parseLockedPrefixes(value: string): string[]`.

- [ ] **Step 1: Failing Tests** (an `tests/core/settings-types.test.ts` anhängen)

```ts
import { parseLockedPrefixes } from "../../src/core/settings-types";

describe("lockedNodePrefixes", () => {
  it("Default env__, fremde Typen fallen auf den Default", () => {
    expect(mergeSettings({}).lockedNodePrefixes).toBe("env__");
    expect(mergeSettings({ lockedNodePrefixes: 42 }).lockedNodePrefixes).toBe("env__");
    expect(mergeSettings({ lockedNodePrefixes: "sky__, env__" }).lockedNodePrefixes).toBe("sky__, env__");
    expect(mergeSettings({ lockedNodePrefixes: "" }).lockedNodePrefixes).toBe("");
  });
});

describe("parseLockedPrefixes", () => {
  it("splittet an Kommas, trimmt, verwirft Leeres", () => {
    expect(parseLockedPrefixes("env__, sky__ ,,")).toEqual(["env__", "sky__"]);
    expect(parseLockedPrefixes("")).toEqual([]);
  });
});
```

- [ ] **Step 2: fehlschlagen sehen · Step 3: Implementierung** — in `settings-types.ts`: Feld + Default ergänzen; im `mergeSettings`: `lockedNodePrefixes: typeof raw.lockedNodePrefixes === "string" ? raw.lockedNodePrefixes : DEFAULT_SETTINGS.lockedNodePrefixes` (leerer String ist gültig — bedeutet „nichts sperren"). Dazu:

```ts
/** "env__, sky__" → ["env__", "sky__"] — leere Eintraege und Raender verworfen. */
export function parseLockedPrefixes(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
```

- [ ] **Step 4: Settings-Tab-Zeile** in `src/obsidian/settings.ts`: neues Definition-Item vom Typ `text`, `key: "lockedNodePrefixes"`, Name `Locked node prefixes`, Beschreibung `Comma-separated name prefixes protected from editing (e.g. env__).` — exakt in der Form der bestehenden Items (der Generic `SettingDefinitionItem<keyof PluginSettings>` bricht den Build bei Tippfehlern). Test in `tests/obsidian/settings.test.ts` nach dem Muster der bestehenden: Zeile wird gezeichnet, onChange schreibt den Wert.

- [ ] **Step 5: Alle Tests grün · Step 6: Commit** — `feat(edit): Setting "Locked node prefixes" (Default env__)`

---

### Task 6: `viewer/loaders.ts` — Node-Indizes an Object3D annotieren

**Files:**
- Modify: `src/viewer/loaders.ts`
- Test: `tests/viewer/loaders.test.ts` (neu — erster Test im viewer/-Ordner; GLTFLoader.parse läuft headless für JSON-glTF mit data-URI-Buffer)

**Interfaces:**
- Produces: geladene glTF-Szenen tragen an jedem Node-Objekt `userData.tdcbNodeIndex: number` (der JSON-Node-Index). Konsumiert von `EditRig` (Task 7).

- [ ] **Step 1: Failing Test**

```ts
// tests/viewer/loaders.test.ts
import { describe, expect, it } from "vitest";
import type { Object3D } from "three";
import { loadModel } from "../../src/viewer/loaders";
import { contractGltfText } from "../helpers/contract-gltf";

describe("loadModel (gltf)", () => {
  it("annotiert jeden Node mit seinem JSON-Index (tdcbNodeIndex)", async () => {
    const bytes = new TextEncoder().encode(contractGltfText()).buffer as ArrayBuffer;
    const scene = (await loadModel(bytes, "gltf", "#888888")) as Object3D;

    const indexOf = (name: string) => {
      let found: number | undefined;
      scene.traverse((child) => {
        if (child.name === name) found = child.userData.tdcbNodeIndex as number;
      });
      return found;
    };

    expect(indexOf("privat-herd")).toBe(0);
    expect(indexOf("privat-herd__dome")).toBe(1);
    expect(indexOf("env__gelaende")).toBe(3);
  });
});
```

Hinweis für den Ausführenden: Schlägt der Test an der three-Namens-Sanitisierung fehl (three ersetzt u. a. Leerzeichen), NICHT über `child.name` mappen — genau deshalb existiert die Index-Annotation. Die Fixture-Namen enthalten nur `a-z_-`, bleiben also erhalten.

- [ ] **Step 2: fehlschlagen sehen · Step 3: Implementierung** — in `loadGltf` vor dem `resolve(gltf.scene)`:

```ts
// Zuordnung Szene ↔ JSON-Node fuer den Editor: three sanitisiert `name` beim Laden,
// der JSON-Index aus `parser.associations` ist die verlaessliche Identitaet.
const associations = (gltf as unknown as {
  parser?: { associations?: Map<object, { nodes?: number }> };
}).parser?.associations;
if (associations) {
  for (const [object, assoc] of associations) {
    if (assoc?.nodes !== undefined) {
      (object as Object3D).userData.tdcbNodeIndex = assoc.nodes;
    }
  }
}
```

(`Object3D` ist in loaders.ts bereits importiert.)

- [ ] **Step 4: Tests grün · Step 5: Commit** — `feat(edit): GLTFLoader-associations → tdcbNodeIndex am Object3D`

---

### Task 7: `viewer/edit-controls.ts` — EditRig (Gizmo + Picking)

**Files:**
- Create: `src/viewer/edit-controls.ts`
- Test: `tests/viewer/edit-controls.test.ts` (nur die headless-testbaren Helfer; TransformControls-Eventfluss ist DOM-gebunden und wird im GUI-Smoke geprüft)

**Interfaces:**
- Consumes: `EditRigLike`, `NodeTrs` (core/edit-session, core/gltf-patch); three (`TransformControls`, `Raycaster`).
- Produces: `class EditRig implements EditRigLike`, `interface EditRigContext { scene: Scene; camera: Camera; domElement: HTMLElement; modelRoot: Object3D; setOrbitEnabled(on: boolean): void; requestRender(): void }`, `interface EditRigCallbacks { isSelectable(index: number): boolean; onSelect(index: number | null): void; onTransformEnd(index: number, trs: NodeTrs): void; onInteract(): void }`. Pure Helfer: `topLevelIndex(root: Object3D, hit: Object3D): number | null`, `findByIndex(root: Object3D, index: number): Object3D | null`, `objectTrs(object: Object3D): NodeTrs`.

- [ ] **Step 1: Failing Tests für die Helfer**

```ts
// tests/viewer/edit-controls.test.ts
import { describe, expect, it } from "vitest";
import { Group, Object3D } from "three";
import { findByIndex, objectTrs, topLevelIndex } from "../../src/viewer/edit-controls";

function tree() {
  const root = new Group();
  const room = new Object3D();
  room.userData.tdcbNodeIndex = 0;
  const dome = new Object3D();
  dome.userData.tdcbNodeIndex = 1;
  room.add(dome);
  root.add(room);
  return { root, room, dome };
}

describe("topLevelIndex", () => {
  it("loest einen Treffer im Kind auf den Top-Level-Vorfahren auf", () => {
    const { root, dome } = tree();
    expect(topLevelIndex(root, dome)).toBe(0);
  });

  it("liefert null fuer Objekte ausserhalb des Modells", () => {
    const { root } = tree();
    expect(topLevelIndex(root, new Object3D())).toBeNull();
  });
});

describe("findByIndex / objectTrs", () => {
  it("findet den Top-Level-Node zum Index und liest seine TRS", () => {
    const { root, room } = tree();
    room.position.set(4, 0, 2);
    room.scale.set(2, 1, 1);
    const found = findByIndex(root, 0);
    expect(found).toBe(room);
    expect(objectTrs(room)).toEqual({ translation: [4, 0, 2], scale: [2, 1, 1] });
  });

  it("liefert null fuer unbekannte Indizes", () => {
    const { root } = tree();
    expect(findByIndex(root, 7)).toBeNull();
  });
});
```

- [ ] **Step 2: fehlschlagen sehen · Step 3: Implementierung**

```ts
// src/viewer/edit-controls.ts
// Gizmo + Picking fuer den Edit-Modus. Kennt Obsidian nicht.
//
// Nur translate/scale — der rotate-Modus wird nie aktiviert (Kontrakt-Soll: das
// outpost-Datenmodell sind achsenparallele Boxen, Rotationen sind nicht abbildbar).
import { type Camera, type Object3D, Raycaster, type Scene, Vector2 } from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { EditRigLike } from "../core/edit-session";
import type { NodeTrs } from "../core/gltf-patch";

export interface EditRigContext {
  scene: Scene;
  camera: Camera;
  domElement: HTMLElement;
  modelRoot: Object3D;
  setOrbitEnabled(on: boolean): void;
  requestRender(): void;
}

export interface EditRigCallbacks {
  isSelectable(index: number): boolean;
  onSelect(index: number | null): void;
  onTransformEnd(index: number, trs: NodeTrs): void;
  onInteract(): void;
}

/** Treffer im Baum → Index des Top-Level-Vorfahren (Kind eines `root`-Kindes zaehlt zum Kind). */
export function topLevelIndex(root: Object3D, hit: Object3D): number | null {
  let node: Object3D | null = hit;
  while (node && node.parent !== root) node = node.parent;
  const index = node?.userData.tdcbNodeIndex;
  return typeof index === "number" ? index : null;
}

export function findByIndex(root: Object3D, index: number): Object3D | null {
  return root.children.find((child) => child.userData.tdcbNodeIndex === index) ?? null;
}

export function objectTrs(object: Object3D): NodeTrs {
  return {
    translation: [object.position.x, object.position.y, object.position.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

/** Klick-vs-Drag-Schwelle in Pixeln — ein Orbit-Drag darf nicht als Auswahl enden. */
const CLICK_TOLERANCE_PX = 5;

export class EditRig implements EditRigLike {
  private readonly controls: TransformControls;
  private readonly raycaster = new Raycaster();
  private selected: Object3D | null = null;
  private downAt: { x: number; y: number } | null = null;

  constructor(
    private readonly ctx: EditRigContext,
    private readonly cb: EditRigCallbacks,
  ) {
    this.controls = new TransformControls(ctx.camera, ctx.domElement);
    this.controls.setMode("translate");
    // three <r169: das Control selbst ist ein Object3D; ab r169 liefert getHelper()
    // das anzuzeigende Objekt. Feature-Detection statt Versionspin.
    const helper =
      (this.controls as unknown as { getHelper?: () => Object3D }).getHelper?.() ??
      (this.controls as unknown as Object3D);
    ctx.scene.add(helper);

    this.controls.addEventListener("dragging-changed", (event) => {
      const dragging = event.value === true;
      ctx.setOrbitEnabled(!dragging);
      if (dragging) this.cb.onInteract();
      if (!dragging && this.selected) {
        const index = this.selected.userData.tdcbNodeIndex as number;
        this.cb.onTransformEnd(index, objectTrs(this.selected));
      }
    });
    this.controls.addEventListener("objectChange", () => ctx.requestRender());

    ctx.domElement.addEventListener("pointerdown", this.handlePointerDown);
    ctx.domElement.addEventListener("pointerup", this.handlePointerUp);
  }

  setMode(mode: "translate" | "scale"): void {
    this.controls.setMode(mode);
    this.ctx.requestRender();
  }

  select(index: number | null): void {
    const target = index === null ? null : findByIndex(this.ctx.modelRoot, index);
    this.selected = target;
    if (target) this.controls.attach(target);
    else this.controls.detach();
    this.ctx.requestRender();
  }

  applyTrs(index: number, trs: NodeTrs): void {
    const target = findByIndex(this.ctx.modelRoot, index);
    if (!target) return;
    target.position.set(...trs.translation);
    target.scale.set(...trs.scale);
    this.ctx.requestRender();
  }

  dispose(): void {
    this.ctx.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.ctx.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.detach();
    const helper =
      (this.controls as unknown as { getHelper?: () => Object3D }).getHelper?.() ??
      (this.controls as unknown as Object3D);
    this.ctx.scene.remove(helper);
    this.controls.dispose();
    this.ctx.setOrbitEnabled(true);
    this.ctx.requestRender();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.downAt = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const down = this.downAt;
    this.downAt = null;
    if (!down) return;
    if (Math.abs(event.clientX - down.x) > CLICK_TOLERANCE_PX) return;
    if (Math.abs(event.clientY - down.y) > CLICK_TOLERANCE_PX) return;
    if ((this.controls as unknown as { dragging?: boolean }).dragging) return;

    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hits = this.raycaster.intersectObject(this.ctx.modelRoot, true);
    const first = hits[0]?.object ?? null;
    const index = first ? topLevelIndex(this.ctx.modelRoot, first) : null;
    this.cb.onSelect(index !== null && this.cb.isSelectable(index) ? index : null);
  };
}
```

- [ ] **Step 4: Tests grün, `npm run build` fehlerfrei (TransformControls-Import bündelt) · Step 5: Commit** — `feat(edit): EditRig — TransformControls (translate/scale) + Raycast-Picking`

---

### Task 8: `Viewport.createEditRig` + Host-Pin

**Files:**
- Modify: `src/viewer/viewport.ts`
- Modify: `src/obsidian/viewer-host.ts`
- Test: `tests/obsidian/viewer-host.test.ts` (erweitern)

**Interfaces:**
- Consumes: `EditRig`, `EditRigCallbacks` (Task 7), `EditRigLike` (Task 4).
- Produces: `Viewport.createEditRig(cb: EditRigCallbacks): EditRig | null`; `ViewportLike.createEditRig?(cb: EditRigCallbacks): EditRigLike | null`; `ViewerHost.createEditRig(cb): EditRigLike | null`; `ViewerHost.pin(on: boolean): void`.

- [ ] **Step 1: Failing Host-Tests** (an `tests/obsidian/viewer-host.test.ts` anhängen; `makeVp` um `createEditRig: vi.fn(() => fakeRig)` erweitern, `fakeRig = { setMode: vi.fn(), select: vi.fn(), applyTrs: vi.fn(), dispose: vi.fn() }`)

```ts
describe("ViewerHost edit support", () => {
  it("delegiert createEditRig an den Viewport", async () => {
    const { host, created } = makeHost();
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    const cb = { isSelectable: () => true, onSelect: vi.fn(), onTransformEnd: vi.fn(), onInteract: vi.fn() };
    expect(host.createEditRig(cb)).not.toBeNull();
    expect(created[0].createEditRig).toHaveBeenCalledWith(cb);
  });

  it("liefert null ohne Viewport (Poster/Fehler)", () => {
    const { host } = makeHost();
    expect(host.createEditRig({ isSelectable: () => true, onSelect: vi.fn(), onTransformEnd: vi.fn(), onInteract: vi.fn() })).toBeNull();
  });

  it("pinned: Budget-Eviction degradiert NICHT zum Poster", async () => {
    const { host, budget, created } = makeHost();
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    host.pin(true);
    const release = budget.register.mock.calls[0][1] as () => void;
    release(); // LRU wirft uns raus — im Edit-Modus ignorieren
    expect(created[0].disposed).toBe(0);
  });

  it("pinned: on-click-Modus startet nach Reload trotzdem live (Regeneration im Edit)", async () => {
    const { host, created } = makeHost({ settings: () => ({ ...DEFAULT_SETTINGS, viewMode: "on-click" as const }) });
    host.pin(true);
    await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
    // Ohne Pin wuerde on-click ohne Aktivierung sofort degradieren (kein zweiter Viewport-Zustand):
    expect(created[0].disposed).toBe(0);
  });
});
```

- [ ] **Step 2: fehlschlagen sehen · Step 3: Implementierung**

In `viewport.ts` (Import `EditRig`, `EditRigCallbacks` aus `./edit-controls`):

```ts
/** Rig fuer den Edit-Modus — `null`, solange kein Modell geladen ist. */
createEditRig(cb: EditRigCallbacks): EditRig | null {
  if (this.disposed || !this.model) return null;
  return new EditRig(
    {
      scene: this.scene,
      camera: this.camera,
      domElement: this.renderer.domElement,
      modelRoot: this.model,
      setOrbitEnabled: (on) => {
        this.controls.enabled = on;
      },
      requestRender: () => this.requestRender(),
    },
    cb,
  );
}
```

In `viewer-host.ts`: `ViewportLike` um `createEditRig?(cb: EditRigCallbacks): EditRigLike | null;` erweitern (Typen aus `../core/edit-session` bzw. `../viewer/edit-controls` — nur Typ-Importe, kein three-Code in der obsidian-Schicht). `ViewerHost`:

```ts
private pinned = false;

/** Im Edit-Modus: Poster-Degradierung aussetzen (LRU-Eviction UND on-click-Erststart). */
pin(on: boolean): void {
  this.pinned = on;
}

createEditRig(cb: EditRigCallbacks): EditRigLike | null {
  return this.viewport?.createEditRig?.(cb) ?? null;
}
```

In `degradeToPoster()` als erste Zeile `if (this.pinned) return;`. In `mount()` die on-click-Bedingung erweitern: `if (settings.viewMode === "on-click" && !this.activated && !this.pinned)`.

- [ ] **Step 4: Alle Tests grün (auch die bestehenden on-click-Tests!) · Step 5: Commit** — `feat(edit): Host-Pin + createEditRig-Durchgriff`

---

### Task 9: `obsidian/edit-mode.ts` — EditCoordinator + EditIo + Confirm-Modal

**Files:**
- Create: `src/obsidian/edit-mode.ts`
- Create: `src/obsidian/confirm.ts`
- Modify: `tests/__mocks__/obsidian.ts` (minimalen `Modal`-Stub ergänzen: `app`, `contentEl = makeFakeEl()`, `open()`, `close()`)
- Test: `tests/obsidian/edit-mode.test.ts`

**Interfaces:**
- Consumes: alles aus Tasks 1–4 (`analyzeTopLevelNodes`, `extractTrsByName`, `patchGltfJson`, `patchGlbContainer`, `glbJsonText`, `editTargetPath`, `editFormatFor`, `EditSession`, `EditRigLike`, `EditUiModel`), `parseLockedPrefixes` (Task 5).
- Produces:

```ts
export interface EditIo {
  exists(path: string): boolean;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeText(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}
export function vaultEditIo(app: App): EditIo;
export interface EditHostLike {
  createEditRig(cb: EditRigCallbacks): EditRigLike | null;
  pin(on: boolean): void;
}
export interface EditModeDeps {
  io: EditIo;
  filePath: () => string | null;
  host: () => EditHostLike | null;
  lockedPrefixes: () => string[];
  notice: (message: string) => void;
  confirmDiscard: () => Promise<boolean>;
  onChange: () => void;
}
export class EditCoordinator {
  readonly active: boolean; // getter
  availability(): { ok: boolean; reason: string | null };
  uiModel(): EditUiModel;
  enter(): Promise<void>;
  save(): Promise<void>;
  discard(): Promise<void>;
  reapplyAfterReload(): Promise<void>;
  exitSilently(): void;
}
export const EDIT_UNAVAILABLE_FORMAT = "Editing requires a glTF or GLB file";
export const EDIT_UNAVAILABLE_LOADING = "The model is still loading";
```

- Aus `confirm.ts`: `confirmDiscardEdits(app: App): Promise<boolean>` (Modal: Text `Discard unsaved edits?`, Buttons `Discard` (cta) / `Keep editing`).

- [ ] **Step 1: Failing Tests**

```ts
// tests/obsidian/edit-mode.test.ts
import { describe, expect, it, vi } from "vitest";
import { EditCoordinator, type EditIo } from "../../src/obsidian/edit-mode";
import { contractGltfText } from "../helpers/contract-gltf";
import type { NodeTrs } from "../../src/core/gltf-patch";

function makeIo(files: Record<string, string>): EditIo & { files: Record<string, string> } {
  return {
    files,
    exists: (path) => path in files,
    readText: (path) => Promise.resolve(files[path]),
    readBinary: () => Promise.reject(new Error("binary unused in these tests")),
    writeText: (path, text) => {
      files[path] = text;
      return Promise.resolve();
    },
    writeBinary: () => Promise.reject(new Error("binary unused in these tests")),
  };
}

function makeRig() {
  return { setMode: vi.fn(), select: vi.fn(), applyTrs: vi.fn(), dispose: vi.fn() };
}

function makeCoordinator(files: Record<string, string>, over: Record<string, unknown> = {}) {
  const io = makeIo(files);
  const rig = makeRig();
  const host = { createEditRig: vi.fn(() => rig), pin: vi.fn() };
  const notices: string[] = [];
  const confirm = vi.fn().mockResolvedValue(true);
  const coordinator = new EditCoordinator({
    io,
    filePath: () => "3d/eg.gltf",
    host: () => host,
    lockedPrefixes: () => ["env__"],
    notice: (m) => notices.push(m),
    confirmDiscard: confirm,
    onChange: vi.fn(),
    ...over,
  });
  return { coordinator, io, rig, host, notices, confirm };
}

const moved: NodeTrs = { translation: [4, 0, 2], scale: [1, 1, 1] };

describe("EditCoordinator", () => {
  it("enter: pinnt den Host, baut das Rig, ohne Edit-Datei kein Overlay", async () => {
    const { coordinator, host, notices } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    expect(coordinator.active).toBe(true);
    expect(host.pin).toHaveBeenCalledWith(true);
    expect(host.createEditRig).toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it("enter mit vorhandener Edit-Datei: Overlay per Name, dirty, Notice mit Zahl", async () => {
    const editJson = JSON.parse(contractGltfText());
    editJson.nodes[0].translation = [7, 0, 2];
    const { coordinator, rig, notices } = makeCoordinator({
      "3d/eg.gltf": contractGltfText(),
      "3d/eg.edit.gltf": JSON.stringify(editJson),
    });
    await coordinator.enter();
    expect(coordinator.uiModel().dirty).toBe(true);
    expect(rig.applyTrs).toHaveBeenCalledWith(0, { translation: [7, 0, 2], scale: [1, 1, 1] });
    expect(notices.join(" ")).toContain("1");
  });

  it("enter mit unlesbarer Edit-Datei: Notice, Start ohne Overlay", async () => {
    const { coordinator, notices } = makeCoordinator({
      "3d/eg.gltf": contractGltfText(),
      "3d/eg.edit.gltf": "kein json {",
    });
    await coordinator.enter();
    expect(coordinator.active).toBe(true);
    expect(coordinator.uiModel().dirty).toBe(false);
    expect(notices.some((n) => n.includes("Could not read"))).toBe(true);
  });

  it("save: patcht frisch gelesenes Original in die Nachbar-Datei; dirty faellt", async () => {
    const { coordinator, io } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    coordinator.uiModel(); // Selektion simulieren:
    // onSelect(0) kommt normalerweise vom Rig — hier direkt ueber das UI-Modell:
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.save();
    const written = JSON.parse(io.files["3d/eg.edit.gltf"]);
    expect(written.nodes[0].translation).toEqual([4, 0, 2]);
    expect(coordinator.uiModel().dirty).toBe(false);
  });

  it("save auf einer .edit.-Quelle schreibt in-place", async () => {
    const { coordinator, io } = makeCoordinator(
      { "3d/eg.edit.gltf": contractGltfText() },
      { filePath: () => "3d/eg.edit.gltf" },
    );
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.save();
    expect(JSON.parse(io.files["3d/eg.edit.gltf"]).nodes[0].translation).toEqual([4, 0, 2]);
    expect(Object.keys(io.files)).toEqual(["3d/eg.edit.gltf"]);
  });

  it("discard bei dirty fragt nach; Ablehnung bleibt im Modus", async () => {
    const { coordinator, confirm } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    confirm.mockResolvedValue(false);
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.discard();
    expect(coordinator.active).toBe(true);
  });

  it("discard setzt TRS am Rig zurueck, entpinnt, verlaesst den Modus", async () => {
    const { coordinator, rig, host } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.discard();
    expect(coordinator.active).toBe(false);
    expect(rig.applyTrs).toHaveBeenLastCalledWith(0, { translation: [1, 0, 2], scale: [1, 1, 1] });
    expect(rig.dispose).toHaveBeenCalled();
    expect(host.pin).toHaveBeenLastCalledWith(false);
  });

  it("reapplyAfterReload: Session ueberlebt die Regeneration per Name", async () => {
    const { coordinator, host } = makeCoordinator({ "3d/eg.gltf": contractGltfText() });
    await coordinator.enter();
    coordinatorSelect(coordinator, 0);
    coordinator.uiModel().applyTrs(moved);
    await coordinator.reapplyAfterReload(); // neuer Viewport nach Datei-Watcher-Reload
    expect(coordinator.active).toBe(true);
    expect(coordinator.uiModel().dirty).toBe(true);
    expect(host.createEditRig).toHaveBeenCalledTimes(2);
  });

  it("availability: STL-Pfad meldet den Format-Grund", () => {
    const { coordinator } = makeCoordinator({}, { filePath: () => "teil.stl" });
    expect(coordinator.availability().ok).toBe(false);
    expect(coordinator.availability().reason).toContain("glTF");
  });
});

/** Auswahl herstellen wie es das Rig taete: ueber den onSelect-Callback. */
function coordinatorSelect(coordinator: EditCoordinator, index: number): void {
  (coordinator as unknown as { handleSelect(index: number | null): void }).handleSelect(index);
}
```

- [ ] **Step 2: fehlschlagen sehen · Step 3: Implementierung**

```ts
// src/obsidian/edit-mode.ts
// Orchestriert den Edit-Modus: Betreten (mit Overlay), Speichern (Patch aufs frisch
// gelesene Original), Verwerfen, Reload-Ueberleben. I/O und Host sind injiziert —
// die Klasse ist ohne Obsidian und ohne three testbar.
import { TFile, type App } from "obsidian";
import { editFormatFor, editTargetPath } from "../core/edit-target";
import { EditSession, type EditRigLike, type EditUiModel } from "../core/edit-session";
import {
  analyzeTopLevelNodes,
  extractTrsByName,
  patchGlbContainer,
  patchGltfJson,
  type NodeTrs,
} from "../core/gltf-patch";
import { glbJsonText } from "../core/gltf-inspect";
import type { EditRigCallbacks } from "../viewer/edit-controls";

export const EDIT_UNAVAILABLE_FORMAT = "Editing requires a glTF or GLB file";
export const EDIT_UNAVAILABLE_LOADING = "The model is still loading";

export interface EditIo {
  exists(path: string): boolean;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeText(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

export function vaultEditIo(app: App): EditIo {
  const fileAt = (path: string): TFile | null => {
    const found = app.vault.getAbstractFileByPath(path);
    return found instanceof TFile ? found : null;
  };
  return {
    exists: (path) => fileAt(path) !== null,
    readText: async (path) => {
      const file = fileAt(path);
      if (!file) throw new Error(`File not found: ${path}`);
      return app.vault.read(file);
    },
    readBinary: async (path) => {
      const file = fileAt(path);
      if (!file) throw new Error(`File not found: ${path}`);
      return app.vault.readBinary(file);
    },
    writeText: async (path, text) => {
      const file = fileAt(path);
      if (file) await app.vault.modify(file, text);
      else await app.vault.create(path, text);
    },
    writeBinary: async (path, data) => {
      const file = fileAt(path);
      if (file) await app.vault.modifyBinary(file, data);
      else await app.vault.createBinary(path, data);
    },
  };
}

export interface EditHostLike {
  createEditRig(cb: EditRigCallbacks): EditRigLike | null;
  pin(on: boolean): void;
}

export interface EditModeDeps {
  io: EditIo;
  filePath: () => string | null;
  host: () => EditHostLike | null;
  lockedPrefixes: () => string[];
  notice: (message: string) => void;
  confirmDiscard: () => Promise<boolean>;
  onChange: () => void;
}

export class EditCoordinator {
  private session: EditSession | null = null;
  private rig: EditRigLike | null = null;
  private selected: number | null = null;
  private mode: "translate" | "scale" = "translate";

  constructor(private readonly deps: EditModeDeps) {}

  get active(): boolean {
    return this.session !== null;
  }

  availability(): { ok: boolean; reason: string | null } {
    const path = this.deps.filePath();
    if (path === null || editFormatFor(path) === null) {
      return { ok: false, reason: EDIT_UNAVAILABLE_FORMAT };
    }
    if (this.deps.host() === null) return { ok: false, reason: EDIT_UNAVAILABLE_LOADING };
    return { ok: true, reason: null };
  }

  uiModel(): EditUiModel {
    const session = this.session;
    const availability = this.availability();
    const selection =
      session && this.selected !== null
        ? {
            name: session.list().find((n) => n.index === this.selected)?.name ?? `#${this.selected}`,
            trs: session.current(this.selected) ?? { translation: [0, 0, 0], scale: [1, 1, 1] },
          }
        : null;
    return {
      active: this.active,
      disabledReason: availability.reason,
      mode: this.mode,
      dirty: session?.dirty ?? false,
      selection,
      enter: () => void this.enter(),
      save: () => void this.save(),
      discard: () => void this.discard(),
      setMode: (mode) => this.setMode(mode),
      reset: () => this.resetSelected(),
      applyTrs: (trs) => this.applyFieldEdit(trs),
    };
  }

  async enter(): Promise<void> {
    if (this.active) return;
    const availability = this.availability();
    if (!availability.ok) {
      this.deps.notice(availability.reason ?? EDIT_UNAVAILABLE_FORMAT);
      return;
    }
    const path = this.deps.filePath();
    const host = this.deps.host();
    if (path === null || host === null) return;

    let json: unknown;
    try {
      json = JSON.parse(await this.readOriginalText(path));
    } catch (error) {
      this.deps.notice(`Could not read model: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const session = new EditSession(analyzeTopLevelNodes(json, this.deps.lockedPrefixes()));
    this.session = session;

    const target = editTargetPath(path);
    if (target && !target.inPlace && this.deps.io.exists(target.path)) {
      await this.applyEditFileOverlay(target.path, session);
    }

    this.rig = host.createEditRig(this.rigCallbacks());
    for (const edit of session.changes()) this.rig?.applyTrs(edit.index, {
      translation: edit.translation,
      scale: edit.scale,
    });
    host.pin(true);
    this.deps.onChange();
  }

  async save(): Promise<void> {
    const session = this.session;
    const path = this.deps.filePath();
    if (!session || path === null) return;
    const target = editTargetPath(path);
    if (!target) return;

    try {
      const format = editFormatFor(path);
      if (format === "gltf-json") {
        const original = await this.deps.io.readText(path);
        await this.deps.io.writeText(target.path, patchGltfJson(original, session.changes()));
      } else {
        const original = await this.deps.io.readBinary(path);
        await this.deps.io.writeBinary(target.path, patchGlbContainer(original, session.changes()));
      }
      session.markSaved();
      this.deps.notice(`Edits saved to ${target.path}`);
    } catch (error) {
      // Modus und Session bleiben erhalten — kein Datenverlust (Spec §5).
      this.deps.notice(`Could not save edits: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.deps.onChange();
  }

  async discard(): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (session.dirty && !(await this.deps.confirmDiscard())) return;
    for (const edit of session.changes()) {
      session.resetNode(edit.index);
      const base = session.current(edit.index);
      if (base) this.rig?.applyTrs(edit.index, base);
    }
    this.exitSilently();
  }

  /** Nach Regenerierung + Viewer-Reload: Session per Name auf den neuen Stand legen. */
  async reapplyAfterReload(): Promise<void> {
    const old = this.session;
    const path = this.deps.filePath();
    const host = this.deps.host();
    if (!old || path === null || host === null) return;

    const byName = old.editsByName();
    this.rig?.dispose();
    this.rig = null;

    let json: unknown;
    try {
      json = JSON.parse(await this.readOriginalText(path));
    } catch {
      this.deps.notice("Could not re-read model after reload — edit mode closed");
      this.exitSilently();
      return;
    }
    const session = new EditSession(analyzeTopLevelNodes(json, this.deps.lockedPrefixes()));
    const { lost } = session.applyOverlay(byName);
    if (lost.length > 0) this.deps.notice(`${lost.length} edited node(s) no longer exist: ${lost.join(", ")}`);
    this.session = session;
    this.selected = null;

    this.rig = host.createEditRig(this.rigCallbacks());
    for (const edit of session.changes()) this.rig?.applyTrs(edit.index, {
      translation: edit.translation,
      scale: edit.scale,
    });
    host.pin(true);
    this.deps.onChange();
  }

  /** Beim Unload — bewusst ohne Confirm (Edits sind fluechtig, Spec §4). */
  exitSilently(): void {
    this.rig?.dispose();
    this.rig = null;
    this.session = null;
    this.selected = null;
    this.deps.host()?.pin(false);
    this.deps.onChange();
  }

  private setMode(mode: "translate" | "scale"): void {
    this.mode = mode;
    this.rig?.setMode(mode);
    this.deps.onChange();
  }

  private resetSelected(): void {
    const session = this.session;
    if (!session || this.selected === null) return;
    session.resetNode(this.selected);
    const base = session.current(this.selected);
    if (base) this.rig?.applyTrs(this.selected, base);
    this.deps.onChange();
  }

  private applyFieldEdit(trs: NodeTrs): void {
    const session = this.session;
    if (!session || this.selected === null) return;
    session.set(this.selected, trs);
    this.rig?.applyTrs(this.selected, trs);
    this.deps.onChange();
  }

  private handleSelect(index: number | null): void {
    this.selected = index;
    this.rig?.select(index);
    this.deps.onChange();
  }

  private rigCallbacks(): EditRigCallbacks {
    return {
      isSelectable: (index) => this.session?.isSelectable(index) ?? false,
      onSelect: (index) => this.handleSelect(index),
      onTransformEnd: (index, trs) => {
        this.session?.set(index, trs);
        this.deps.onChange();
      },
      onInteract: () => {},
    };
  }

  private async readOriginalText(path: string): Promise<string> {
    if (editFormatFor(path) === "gltf-json") return this.deps.io.readText(path);
    const text = glbJsonText(await this.deps.io.readBinary(path));
    if (text === null) throw new Error("not a valid GLB container");
    return text;
  }

  private async applyEditFileOverlay(editPath: string, session: EditSession): Promise<void> {
    try {
      const text =
        editFormatFor(editPath) === "gltf-json"
          ? await this.deps.io.readText(editPath)
          : (glbJsonText(await this.deps.io.readBinary(editPath)) ?? "null");
      const overlay = extractTrsByName(JSON.parse(text));
      const { applied, lost } = session.applyOverlay(overlay);
      const lostSuffix = lost.length > 0 ? ` — ${lost.length} no longer match` : "";
      if (applied > 0 || lost.length > 0) {
        this.deps.notice(`Loaded existing edits for ${applied} node(s)${lostSuffix}`);
      }
    } catch {
      this.deps.notice(`Could not read ${editPath} — starting from the original`);
    }
  }
}
```

Und `src/obsidian/confirm.ts`:

```ts
// Bestaetigungsdialog als Promise — Obsidian-Modal, minimal.
import { Modal, type App } from "obsidian";

export function confirmDiscardEdits(app: App): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private answered = false;
      onOpen(): void {
        this.contentEl.createEl("p", { text: "Discard unsaved edits?" });
        const row = this.contentEl.createDiv({ cls: "modal-button-container" });
        const discard = row.createEl("button", { text: "Discard", cls: "mod-warning" });
        discard.addEventListener("click", () => {
          this.answered = true;
          resolve(true);
          this.close();
        });
        const keep = row.createEl("button", { text: "Keep editing" });
        keep.addEventListener("click", () => this.close());
      }
      onClose(): void {
        if (!this.answered) resolve(false);
      }
    })(app);
    modal.open();
  });
}
```

Mock-Ergänzung in `tests/__mocks__/obsidian.ts`:

```ts
export class Modal {
  contentEl = makeFakeEl();
  constructor(public app: any) {}
  open() {
    (this as any).onOpen?.();
  }
  close() {
    (this as any).onClose?.();
  }
}
```

- [ ] **Step 4: Tests grün · Step 5: Commit** — `feat(edit): EditCoordinator — enter/save/discard/reload, EditIo, Confirm-Modal`

---

### Task 10: Toolbar-Edit-Zustand + Block-Verdrahtung

**Files:**
- Modify: `src/obsidian/viewport-toolbar.ts`
- Modify: `src/obsidian/block-child.ts`
- Modify: `src/main.ts` (BlockDeps um `editIo`/`confirmDiscard` erweitern — `vaultEditIo(this.app)` und `() => confirmDiscardEdits(this.app)`)
- Modify: `styles.css`
- Test: `tests/obsidian/viewport-toolbar.test.ts`, `tests/obsidian/block-child.test.ts` (erweitern)

**Interfaces:**
- Consumes: `EditUiModel` (Task 4), `EditCoordinator`, `vaultEditIo` (Task 9), `confirmDiscardEdits`.
- Produces: `buildToolbar(parent: HTMLElement, controller: ViewportController, edit?: EditUiModel | null): HTMLElement` (dritter Parameter optional — bestehende Aufrufer/Tests bleiben gültig). `BlockDeps` + `editIo: EditIo; confirmDiscard: () => Promise<boolean>`.

- [ ] **Step 1: Failing Toolbar-Tests** (an `tests/obsidian/viewport-toolbar.test.ts` anhängen; Controller-Fake wie in den bestehenden Tests der Datei)

```ts
import type { EditUiModel } from "../../src/core/edit-session";

function makeEditModel(over: Partial<EditUiModel> = {}): EditUiModel {
  return {
    active: false,
    disabledReason: null,
    mode: "translate",
    dirty: false,
    selection: null,
    enter: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    setMode: vi.fn(),
    reset: vi.fn(),
    applyTrs: vi.fn(),
    ...over,
  };
}

const labels = (bar: any) => bar.children.map((b: any) => b.getAttribute("aria-label"));

describe("buildToolbar im Edit-Kontext", () => {
  it("inaktiv: View-Buttons + Edit-Button", () => {
    const bar = buildToolbar(makeFakeEl(), controllerFake(), makeEditModel());
    expect(labels(bar)).toContain("Edit model");
  });

  it("Edit-Button traegt den Sperrgrund als Tooltip und ist deaktiviert", () => {
    const bar = buildToolbar(makeFakeEl(), controllerFake(), makeEditModel({ disabledReason: "Editing requires a glTF or GLB file" }));
    const edit = bar.children.find((b: any) => b.getAttribute("aria-label") === "Edit model");
    expect(edit.disabled).toBe(true);
    expect(edit.title).toContain("glTF");
  });

  it("aktiv: Move/Scale/Reset/Save/Discard statt der View-Buttons; Save folgt dirty", () => {
    const model = makeEditModel({ active: true, dirty: false, selection: null });
    const bar = buildToolbar(makeFakeEl(), controllerFake(), model);
    expect(labels(bar)).toEqual(["Move", "Scale", "Reset node", "Save edits", "Discard edits"]);
    const save = bar.children.find((b: any) => b.getAttribute("aria-label") === "Save edits");
    expect(save.disabled).toBe(true);
    const reset = bar.children.find((b: any) => b.getAttribute("aria-label") === "Reset node");
    expect(reset.disabled).toBe(true); // keine Auswahl
  });

  it("Klicks rufen die Modell-Handler", () => {
    const model = makeEditModel({ active: true, dirty: true, selection: { name: "privat-herd", trs: { translation: [0,0,0], scale: [1,1,1] } } });
    const bar = buildToolbar(makeFakeEl(), controllerFake(), model);
    bar.children.find((b: any) => b.getAttribute("aria-label") === "Scale").click();
    expect(model.setMode).toHaveBeenCalledWith("scale");
    bar.children.find((b: any) => b.getAttribute("aria-label") === "Save edits").click();
    expect(model.save).toHaveBeenCalled();
  });

  it("ohne Edit-Modell (Embed/FileView-Altpfad) unveraendert nur View-Buttons", () => {
    const bar = buildToolbar(makeFakeEl(), controllerFake());
    expect(labels(bar)).toEqual(["Save view", "Clear view", "Fit camera to model"]);
  });
});
```

- [ ] **Step 2: fehlschlagen sehen · Step 3: Toolbar-Implementierung** — `buildToolbar(parent, controller, edit?)`: bei `edit?.active` werden statt `BUTTONS` diese fünf gezeichnet (gleiche Bau-Helfer wie bisher — Icon, `aria-label`, disabled+title, stopPropagation):

| Icon | aria-label | disabled wenn | run |
|---|---|---|---|
| `move` | Move | `mode === "translate"` nie disabled; aktiver Modus bekommt Klasse `is-active` | `edit.setMode("translate")` |
| `scaling` | Scale | — (aktiver Modus: `is-active`) | `edit.setMode("scale")` |
| `rotate-ccw` | Reset node | `edit.selection === null` | `edit.reset()` |
| `save` | Save edits | `!edit.dirty` (`title`: "No changes yet") | `edit.save()` |
| `x` | Discard edits | — | `edit.discard()` |

Bei `edit && !edit.active`: die drei View-Buttons + zusätzlich `pencil`/„Edit model" (disabled mit `edit.disabledReason` als title, sonst `edit.enter()`). Ohne `edit`-Parameter: exakt heutiges Verhalten.

- [ ] **Step 4: Block-Verdrahtung** in `block-child.ts`:
  - `BlockDeps` + `editIo: EditIo; confirmDiscard: () => Promise<boolean>;`
  - In `onload()` nach dem Host-Bau: `this.edit = new EditCoordinator({ io: this.deps.editIo, filePath: () => this.file?.path ?? null, host: () => this.host, lockedPrefixes: () => parseLockedPrefixes(this.deps.settings().lockedNodePrefixes), notice: (m) => new Notice(m), confirmDiscard: this.deps.confirmDiscard, onChange: () => { this.syncToolbar(true); this.deps.active.notify(); } });` (`notify` kommt in Task 11 — bis dahin diese Zeile als `this.syncToolbar(true)` allein, Task 11 ergänzt den Aufruf.)
  - `syncToolbar`: `this.toolbar = buildToolbar(this.parts.viewport, this, this.edit?.uiModel() ?? null);` und der Viewport-Wrapper bekommt `this.parts.viewport.toggleClass("tdcb-editing", this.edit?.active ?? false);`
  - `onunload()`: vor dem Host-Dispose `this.edit?.exitSilently();` (Reihenfolge: Coordinator vor Host, damit das Rig auf lebendem Viewport disposed).
  - Ende von `loadNow()`: `if (this.edit?.active) await this.edit.reapplyAfterReload();` (nach `syncToolbar(true)`).
  - `ViewportController`-Anbindung ans Panel folgt in Task 11.
  - `main.ts`: beim Bau der `BlockDeps` die zwei neuen Felder mitgeben.
  - `styles.css`: `.tdcb-viewport.tdcb-editing { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }` und `.tdcb-toolbar-button.is-active { color: var(--interactive-accent); }`.
- [ ] **Step 5: Failing Block-Tests ergänzen** (in `tests/obsidian/block-child.test.ts`, nach dem Muster der bestehenden `makeDeps`-Fabrik dort; `editIo` = In-Memory-Fake aus Task 9-Test, `confirmDiscard: () => Promise.resolve(true)`): (a) Toolbar zeigt „Edit model" nach `loadNow()` mit `.gltf`-Datei; (b) bei `.stl`-Datei ist „Edit model" deaktiviert mit Format-Grund; (c) `onunload()` im aktiven Edit wirft nicht und entpinnt (Coordinator-Spy).
- [ ] **Step 6: Alle Tests grün, `npm run build` · Step 7: Commit** — `feat(edit): Toolbar-Edit-Zustand + Block-Verdrahtung (Betreten/Reload/Unload)`

---

### Task 11: Sidebar-Panel — Edit-Sektion + `ActiveViewport.notify`

**Files:**
- Modify: `src/core/active-viewport.ts`
- Modify: `src/obsidian/control-panel.ts`
- Modify: `src/obsidian/block-child.ts` (Controller liefert `editPanel`; `onChange` ruft `active.notify()`)
- Test: `tests/core/active-viewport.test.ts`, `tests/obsidian/control-panel.test.ts` (erweitern)

**Interfaces:**
- Produces: `ActiveViewport.notify(): void` (feuert alle Listener mit dem aktuellen Controller erneut); `ViewportController.editPanel?: () => EditUiModel | null`.

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/active-viewport.test.ts — anhaengen:
it("notify feuert die Listener mit dem aktuellen Controller erneut", () => {
  const active = new ActiveViewport();
  const seen: unknown[] = [];
  active.subscribe((c) => seen.push(c));
  const controller = fakeController(); // bestehende Fabrik der Datei
  active.set(controller);
  active.notify();
  expect(seen).toEqual([controller, controller]);
});
```

```ts
// tests/obsidian/control-panel.test.ts — anhaengen. Fabriken der Datei wiederverwenden;
// `makeEditModel` ist der Helfer aus Task 10 (viewport-toolbar.test.ts) — hier lokal
// identisch definieren, Testdateien teilen keine Helfer über Dateigrenzen.
describe("Edit-Sektion", () => {
  it("zeigt den Edit-Button, wenn der Controller editPanel anbietet", () => {
    const controller = { ...fakeController(), editPanel: () => makeEditModel() };
    // ... panel zeichnen wie in den bestehenden Tests ...
    expect(JSON.stringify(view.contentEl.children)).toContain("Edit model");
  });

  it("aktiv: zeigt Auswahlname und sechs Zahlenfelder, applyTrs bei Aenderung", () => {
    const model = makeEditModel({
      active: true,
      selection: { name: "privat-herd", trs: { translation: [1, 0, 2], scale: [1, 1, 1] } },
    });
    const controller = { ...fakeController(), editPanel: () => model };
    // ... zeichnen ...
    const inputs = collectInputs(view.contentEl); // Helfer: alle tagName INPUT im Baum
    expect(inputs).toHaveLength(6);
    inputs[0].value = "4";
    inputs[0].handlers.change?.forEach((fn: any) => fn());
    expect(model.applyTrs).toHaveBeenCalledWith({ translation: [4, 0, 2], scale: [1, 1, 1] });
  });

  it("aktiv ohne Auswahl: Hinweis statt Felder", () => {
    const model = makeEditModel({ active: true, selection: null });
    // ... zeichnen ...
    expect(JSON.stringify(view.contentEl.children)).toContain("Click a part of the model");
  });

  it("ohne editPanel am Controller (alte Wege) keine Edit-Sektion", () => {
    // ... bestehenden fakeController ohne editPanel zeichnen ...
    expect(JSON.stringify(view.contentEl.children)).not.toContain("Edit model");
  });
});
```

- [ ] **Step 2: fehlschlagen sehen · Step 3: Implementierung**
  - `active-viewport.ts`: `notify()` — identische Listener-Schleife wie in `set()` (in privaten Helfer `emit()` ziehen), plus `editPanel?: () => EditUiModel | null;` am `ViewportController`-Interface (Typ-Import aus `./edit-session`).
  - `control-panel.ts` `draw()`: nach den Actions, wenn `controller.editPanel` existiert → `const edit = controller.editPanel()`; Sektion `tdcb-panel-edit`:
    - `!edit.active`: Button „Edit model" (`disabled` + `title` aus `disabledReason`, Klick → `edit.enter()`).
    - `edit.active`: Modus-Buttons „Move"/„Scale" (aktiver mit `mod-cta`), bei `selection`: Label mit Namen + zwei Zeilen à drei `input[type=number]` (Position x/y/z, Scale x/y/z; `change`-Handler bauen aus den sechs aktuellen Feldwerten das `NodeTrs` und rufen `edit.applyTrs`), Buttons „Reset node", „Save edits" (`disabled` bei `!dirty`, `mod-cta`), „Discard edits". Ohne Auswahl: Text „Click a part of the model to select it."
    - Der Mock kennt `input`-Werte nicht nativ: Inputs über `createEl("input")` + `value`-Property setzen; im Test über `handlers.change` feuern (Mock-`addEventListener` zeichnet auf).
  - `block-child.ts`: `editPanel = (): EditUiModel | null => this.edit?.uiModel() ?? null;` als Klassen-Property (erfüllt das Interface), und im Coordinator-`onChange` zusätzlich `this.deps.active.notify();`.
  - styles.css: `.tdcb-panel-edit input[type="number"] { width: 5em; }` und Zeilen-Layout über `display: flex; gap: var(--size-4-1);`.

- [ ] **Step 4: Tests grün · Step 5: Commit** — `feat(edit): Sidebar-Edit-Sektion mit Zahlenfeldern + ActiveViewport.notify`

---

### Task 12: Embed + FileView anschließen

**Files:**
- Modify: `src/obsidian/read-only-controller.ts` (optionaler `editPanel`-Durchgriff)
- Modify: `src/obsidian/embed.ts`, `src/obsidian/file-view.ts`, `src/main.ts` (Deps erweitern)
- Test: `tests/obsidian/embed.test.ts`, `tests/obsidian/file-view.test.ts` (erweitern)

**Interfaces:**
- Consumes: `EditCoordinator`, `EditIo`, `EditUiModel`.
- Produces: `readOnlyController(host, label, editPanel?: () => EditUiModel | null): ViewportController` (dritter Parameter optional); `EmbedDeps`/`FileViewDeps` + `editIo: EditIo; confirmDiscard: () => Promise<boolean>`.

- [ ] **Step 1: Failing Tests** — je Weg (Muster der bestehenden Tests der Dateien nutzen): (a) Controller bietet `editPanel` an, sobald die Datei `.gltf`/`.glb` ist; (b) bei `.stl` liefert `editPanel().disabledReason` den Format-Grund; (c) Embed: `onFileModified` im aktiven Edit ruft `reapplyAfterReload` (Coordinator-Spy über `editPanel().active`); (d) FileView: `onUnloadFile` beendet den Edit still.
- [ ] **Step 2: fehlschlagen sehen · Step 3: Implementierung**
  - `read-only-controller.ts`: Signatur `readOnlyController(host, label, editPanel?)`; im Rückgabeobjekt `...(editPanel ? { editPanel } : {})`.
  - `embed.ts`: Coordinator im Konstruktor anlegen (`filePath: () => this.file.path`, `host: () => this.host`, Rest aus Deps wie in Task 10); `readOnlyController(() => this.host, () => this.file.path, () => this.edit.uiModel())`; in `onFileModified` nach `render()`: `if (this.edit.active) await this.edit.reapplyAfterReload();`; in `onunload` vor dem Host-Dispose `this.edit.exitSilently();`. `onChange` = `this.deps.active.notify()` (Embeds haben keine Toolbar).
  - `file-view.ts`: analog; Coordinator pro View, `filePath: () => this.file?.path ?? null`; `onUnloadFile` → `this.edit.exitSilently()` vor `teardown()`. Beachte: `onLoadFile` baut Host neu — Coordinator vorher still beenden (Dateiwechsel im Pane ist kein Reload desselben Modells).
  - `main.ts`: `editIo`/`confirmDiscard` in `EmbedDeps`/`FileViewDeps` mitgeben.
- [ ] **Step 4: Tests grün, `npm run build` · Step 5: Commit** — `feat(edit): Embed und FileView editieren ueber die Sidebar`

---

### Task 13: Doku, SMOKE, REGISTRY

**Files:**
- Modify: `README.md` (Abschnitt „Edit mode": was es tut, `.edit.`-Namensregel, Locked-Präfix-Setting, Grenzen: nur TRS/Top-Level, kein Undo, STL nicht)
- Modify: `docs/SMOKE.md` (neue Punkte, s. u.)
- Modify: `../REGISTRY.md` (Dach-Repo `obsidian-plugins`, ein Eintrag)
- Kein Test — reine Doku.

- [ ] **Step 1: README-Abschnitt schreiben** (englisch, im Ton der bestehenden Abschnitte; ausdrücklich: „Originals are never modified — edits are saved to a `<name>.edit.gltf` next to the file").
- [ ] **Step 2: SMOKE.md ergänzen** — Punkte im Stil der bestehenden Liste:
  1. `eg.gltf`-Block → Edit betreten → Raum anklicken → Gizmo erscheint, Rahmen sichtbar.
  2. Raum verschieben → Save → `eg.edit.gltf` existiert; Original-mtime unverändert.
  3. Edit erneut betreten → Notice „Loaded existing edits", Verschiebung sitzt auf frischem Original.
  4. `env__`-Node anklicken → keine Auswahl.
  5. Dirty + Discard → Confirm-Dialog; „Keep editing" bleibt im Modus.
  6. Abnahme-Test (Kontrakt §Abnahme): im outpost-Repo `uv run python scripts/outpost_floorplan.py --diff weltmodell/3d/eg.edit.gltf` → Prosa-Zeile + Zielwerte.
  7. Regeneration im Edit-Modus (outpost-Skript laufen lassen) → Edits bleiben, Notice bei verlorenen Namen.
- [ ] **Step 3: REGISTRY-Eintrag** — Zeile in der 3D-/Muster-Sektion: „**glTF byte-schonend patchen (TRS-Editor)**: Analyse (`analyzeTopLevelNodes`), Patch nur `translation`/`scale` (`patchGltfJson`/`patchGlbContainer`), Overlay per Name — Kontrakt-Regeln als Struktureigenschaft. Erst-Exemplar 2026-07, `3d-codeblocks/src/core/gltf-patch.ts`".
- [ ] **Step 4: Commit** — `docs(edit): README-Abschnitt, Smoke-Punkte, REGISTRY-Eintrag`

---

## Self-Review-Protokoll (beim Planschreiben gelaufen)

- **Spec-Abdeckung:** §1 Entscheidungen → Tasks 1–5 (pure Kerne), §2 UI → Tasks 10/11, §3 Module/Index-Zuordnung → Tasks 6–8, §4 Lebenszyklus → Task 9 (+ Wiring 10/12), §5 Fehlerfälle → Tests in Tasks 1, 9, 10; §6 Kontrakt-Tabelle → Tests Task 1/2 gegen die Kontrakt-Fixture; §7 Testing → durchgängig TDD + SMOKE (Task 13); §8 Seeds → nur Doku (json-editor-Seed liegt in der Spec, nicht hier).
- **Bewusste Abweichung von der Spec-Formulierung:** UI-Copy englisch statt der deutschen Spec-Formulierungen (Store-Plugin; Bestand ist englisch). Inhalt unverändert.
- **Offene bekannte Risiken für den Ausführenden:** (a) `GLTFLoader.parse` headless in Task 6 — falls die three-Version im Repo dort Browser-APIs zieht, den Test auf einen extrahierten, pure `annotateNodeIndices(associations)`-Helfer umstellen und den Loader-Aufruf ungetestet lassen; (b) `TransformControls`-Helper-Handling ist versionsabhängig (`getHelper()` ab r169) — Feature-Detection ist eingebaut, im Zweifel `node_modules/three/package.json` prüfen; (c) `vault.modifyBinary`/`createBinary` müssen im Obsidian-Mock ggf. ergänzt werden (lazy-add-on-demand).
