# Ansicht merken — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der gewählte Blickwinkel eines 3D-Modells wird als `view:`-Key in den Codeblock geschrieben und beim nächsten Öffnen wiederhergestellt.

**Architecture:** Die gesamte Rechenlogik (Format parsen, Winkel↔Kamera, Blocktext umbauen, Platzierungs-Entscheidung) liegt pur in `src/core/` und ist ohne Obsidian und ohne WebGL testbar. `src/obsidian/` enthält nur dünne Adapter: eine Sidebar-`ItemView`, eine Hover-Toolbar und einen zweigleisigen Schreiber (Editor-API wenn die Notiz offen ist, sonst `vault.process`). Sidebar und Toolbar sprechen ausschließlich gegen das schmale Interface `ViewportController` und sehen three.js nie.

**Tech Stack:** TypeScript, esbuild, Obsidian Plugin API, three.js (bereits gebündelt), vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-view-memory-design.md`

## Global Constraints

- **`src/core/` darf weder `obsidian` noch `three` importieren** — bewacht von `npm run check:pure`.
- **Keine neue Laufzeit-Abhängigkeit.** Das Bundle bleibt bei ~586 KB; `minAppVersion` bleibt `1.5.0`.
- **Die Oberfläche ist englisch**, ohne i18n — wie der gesamte Bestand („View mode", „Default height").
- **DOM ausschließlich über `createEl` / `createDiv` / `createSpan` / `empty()`** — nie `innerHTML` (UI-STANDARD §2).
- **Icons über `setIcon(el, name)`** aus dem Lucide-Set; jeder Icon-Button trägt ein `aria-label`.
- **CSS nur mit Obsidian-Theme-Variablen**, kein `!important`, alle Klassen mit Präfix `tdcb-`.
- **Tests mit vitest**; der Obsidian-Mock liegt in `tests/__mocks__/obsidian.ts` und wird per vitest-Alias eingehängt (nie über `tsconfig.json`).
- **Prüfbefehle:** `npm test` · `npm run typecheck` · `npm run check:pure` · `npm run lint`.
- **Commits** im Conventional-Commit-Stil mit deutscher Beschreibung (wie die bestehende History).
- **Branch:** `feat/view-memory` (existiert bereits, enthält die Spec).

---

### Task 1: `view-spec.ts` — Format parsen und formatieren

**Files:**
- Create: `src/core/view-spec.ts`
- Test: `tests/core/view-spec.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `ViewSpec { azimuth: number; elevation: number; distance: number }`, `NAMED_VIEWS: Record<string, ViewSpec>`, `parseView(text: string): ViewSpec | null`, `formatView(spec: ViewSpec): string`.

- [ ] **Step 1: Write the failing test**

`tests/core/view-spec.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { NAMED_VIEWS, formatView, parseView } from "../../src/core/view-spec";

describe("parseView", () => {
  it("reads a named view", () => {
    expect(parseView("iso")).toEqual({ azimuth: 45, elevation: 30, distance: 1 });
  });

  it("ignores case and surrounding space", () => {
    expect(parseView("  TOP ")).toEqual(NAMED_VIEWS.top);
  });

  it("reads three numbers", () => {
    expect(parseView("45,30,1.2")).toEqual({ azimuth: 45, elevation: 30, distance: 1.2 });
  });

  it("tolerates spaces between the numbers", () => {
    expect(parseView("45, 30, 1.2")).toEqual({ azimuth: 45, elevation: 30, distance: 1.2 });
  });

  it("wraps the azimuth into 0..359", () => {
    expect(parseView("370,0,1")?.azimuth).toBe(10);
    expect(parseView("-90,0,1")?.azimuth).toBe(270);
  });

  it("clamps the elevation to the gimbal limit", () => {
    expect(parseView("0,90,1")?.elevation).toBe(89);
    expect(parseView("0,-120,1")?.elevation).toBe(-89);
  });

  it("rejects a non-positive distance", () => {
    expect(parseView("0,0,0")).toBeNull();
    expect(parseView("0,0,-2")).toBeNull();
  });

  it("rejects unknown names and malformed input", () => {
    expect(parseView("schräg-von-oben")).toBeNull();
    expect(parseView("45,30")).toBeNull();
    expect(parseView("45,30,1,2")).toBeNull();
    expect(parseView("")).toBeNull();
  });
});

describe("formatView", () => {
  it("writes the name when the view is close enough", () => {
    expect(formatView({ azimuth: 44, elevation: 31, distance: 1.03 })).toBe("iso");
  });

  it("writes numbers when no name is close enough", () => {
    expect(formatView({ azimuth: 20, elevation: 10, distance: 1 })).toBe("20,10,1");
  });

  it("does not use a name when the distance differs too much", () => {
    expect(formatView({ azimuth: 45, elevation: 30, distance: 2 })).toBe("45,30,2");
  });

  it("rounds angles to whole degrees and distance to two decimals", () => {
    expect(formatView({ azimuth: 20.4, elevation: 9.6, distance: 1.234 })).toBe("20,10,1.23");
  });

  it("round-trips through parseView", () => {
    const spec = { azimuth: 123, elevation: -45, distance: 0.75 };
    expect(parseView(formatView(spec))).toEqual(spec);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/view-spec.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/view-spec"`

- [ ] **Step 3: Write the implementation**

`src/core/view-spec.ts`:

```typescript
// Die gespeicherte Ansicht eines Modells. Pure: kein obsidian-, kein three-Import.
//
// Bewusst orbit-relativ statt in Weltkoordinaten: `distance` ist ein Vielfaches der
// automatischen Einpass-Distanz, deshalb bleibt eine gespeicherte Ansicht sinnvoll,
// wenn dasselbe Modell in anderer Groesse neu generiert wird.

export interface ViewSpec {
  /** Drehung um die Hochachse, 0..359. 0 = von vorn (+Z), wachsend nach rechts. */
  azimuth: number;
  /** Hoehe in Grad, -89..89. 0 = auf Augenhoehe, 89 = von oben. */
  elevation: number;
  /** Vielfaches der Einpass-Distanz. 1 = wie ohne `view:`. */
  distance: number;
}

/** Bei exakt 90 Grad kippt der Aufwaertsvektor von OrbitControls um. */
export const MAX_ELEVATION = 89;

export const NAMED_VIEWS: Record<string, ViewSpec> = {
  front: { azimuth: 0, elevation: 0, distance: 1 },
  back: { azimuth: 180, elevation: 0, distance: 1 },
  left: { azimuth: 270, elevation: 0, distance: 1 },
  right: { azimuth: 90, elevation: 0, distance: 1 },
  top: { azimuth: 0, elevation: MAX_ELEVATION, distance: 1 },
  bottom: { azimuth: 0, elevation: -MAX_ELEVATION, distance: 1 },
  iso: { azimuth: 45, elevation: 30, distance: 1 },
};

export const VIEW_NAMES = Object.keys(NAMED_VIEWS).join(", ");

/** Toleranz, innerhalb derer `formatView` lieber den Namen als Zahlen schreibt. */
const NAME_ANGLE_TOLERANCE = 2;
const NAME_DISTANCE_TOLERANCE = 0.05;

function wrapAzimuth(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function clampElevation(value: number): number {
  return Math.min(MAX_ELEVATION, Math.max(-MAX_ELEVATION, Math.round(value)));
}

/** `null` = unlesbar; der Aufrufer macht daraus eine Warnung, keinen Fehler. */
export function parseView(text: string): ViewSpec | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "") return null;

  const named = NAMED_VIEWS[trimmed];
  if (named) return { ...named };

  const parts = trimmed.split(",").map((part) => part.trim());
  if (parts.length !== 3) return null;

  const numbers = parts.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) return null;

  const [azimuth, elevation, distance] = numbers;
  if (distance <= 0) return null;

  return {
    azimuth: wrapAzimuth(azimuth),
    elevation: clampElevation(elevation),
    distance: round2(distance),
  };
}

/** Kuerzeste lesbare Schreibweise — Name, wenn er nah genug passt, sonst drei Zahlen. */
export function formatView(spec: ViewSpec): string {
  const azimuth = wrapAzimuth(spec.azimuth);
  const elevation = clampElevation(spec.elevation);
  const distance = round2(spec.distance);

  for (const [name, candidate] of Object.entries(NAMED_VIEWS)) {
    const azimuthOff = Math.abs(angleDelta(azimuth, candidate.azimuth));
    const elevationOff = Math.abs(elevation - candidate.elevation);
    const distanceOff = Math.abs(distance - candidate.distance);
    if (
      azimuthOff <= NAME_ANGLE_TOLERANCE &&
      elevationOff <= NAME_ANGLE_TOLERANCE &&
      distanceOff <= NAME_DISTANCE_TOLERANCE
    ) {
      return name;
    }
  }

  return `${azimuth},${elevation},${distance}`;
}

/** Kuerzester Weg zwischen zwei Winkeln — sonst gaelten 359 und 1 als 358 Grad entfernt. */
function angleDelta(a: number, b: number): number {
  const diff = ((a - b + 540) % 360) - 180;
  return diff;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/view-spec.test.ts`
Expected: PASS (alle 14 Fälle)

- [ ] **Step 5: Verify purity and types**

Run: `npm run check:pure && npm run typecheck`
Expected: beide ohne Ausgabe/Fehler

- [ ] **Step 6: Commit**

```bash
git add src/core/view-spec.ts tests/core/view-spec.test.ts
git commit -m "feat(core): ViewSpec mit parseView/formatView (Namen + drei Zahlen)"
```

---

### Task 2: `view-spec.ts` — Kamera-Umrechnung, `iso` als Auto-Blick

**Files:**
- Modify: `src/core/camera-fit.ts` (Rückgabe um `distance`/`radius` erweitern, Richtung aus Winkeln)
- Modify: `src/core/view-spec.ts` (zwei Funktionen anhängen)
- Test: `tests/core/view-spec.test.ts` (Block anhängen), `tests/core/camera-fit.test.ts` (ein Fall anhängen)

**Interfaces:**
- Consumes: `ViewSpec`, `NAMED_VIEWS` aus Task 1; `fitCamera`, `Vec3`, `CameraFit` aus `camera-fit.ts`.
- Produces: `directionFromAngles(azimuth, elevation): Vec3` (in `camera-fit.ts`), `CameraFit` zusätzlich mit `distance: number` und `radius: number`, sowie in `view-spec.ts`: `viewToCamera(spec, min, max, fovDeg, aspect): CameraFit` und `cameraToView(position, target, baseDistance): ViewSpec`.

- [ ] **Step 1: Write the failing tests**

An `tests/core/view-spec.test.ts` anhängen:

```typescript
import { cameraToView, viewToCamera } from "../../src/core/view-spec";
import { fitCamera } from "../../src/core/camera-fit";

const v = (x: number, y: number, z: number) => ({ x, y, z });
const MIN = v(-1, -1, -1);
const MAX = v(1, 1, 1);
const len = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("viewToCamera", () => {
  it("puts the camera in front of the model for `front`", () => {
    const cam = viewToCamera(NAMED_VIEWS.front, MIN, MAX, 50, 1.5);
    expect(cam.position.z).toBeGreaterThan(cam.target.z);
    expect(cam.position.x).toBeCloseTo(cam.target.x, 6);
    expect(cam.position.y).toBeCloseTo(cam.target.y, 6);
  });

  it("puts the camera to the right for `right`", () => {
    const cam = viewToCamera(NAMED_VIEWS.right, MIN, MAX, 50, 1.5);
    expect(cam.position.x).toBeGreaterThan(cam.target.x);
    expect(cam.position.z).toBeCloseTo(cam.target.z, 6);
  });

  it("puts the camera to the left for `left`", () => {
    const cam = viewToCamera(NAMED_VIEWS.left, MIN, MAX, 50, 1.5);
    expect(cam.position.x).toBeLessThan(cam.target.x);
  });

  it("puts the camera above for `top`", () => {
    const cam = viewToCamera(NAMED_VIEWS.top, MIN, MAX, 50, 1.5);
    expect(cam.position.y).toBeGreaterThan(cam.target.y);
    expect(len(cam.position, cam.target)).toBeGreaterThan(0);
  });

  it("scales the distance by the factor", () => {
    const base = viewToCamera(NAMED_VIEWS.iso, MIN, MAX, 50, 1.5);
    const far = viewToCamera({ ...NAMED_VIEWS.iso, distance: 2 }, MIN, MAX, 50, 1.5);
    expect(len(far.position, far.target)).toBeCloseTo(len(base.position, base.target) * 2, 6);
  });

  it("keeps near/far usable at an extreme distance factor", () => {
    const cam = viewToCamera({ ...NAMED_VIEWS.iso, distance: 10 }, MIN, MAX, 50, 1.5);
    expect(cam.near).toBeGreaterThan(0);
    expect(cam.far).toBeGreaterThan(len(cam.position, cam.target));
  });

  it("matches the automatic fit for `iso` — one truth for the default look", () => {
    const auto = fitCamera(MIN, MAX, 50, 1.5);
    const iso = viewToCamera(NAMED_VIEWS.iso, MIN, MAX, 50, 1.5);
    expect(iso.position.x).toBeCloseTo(auto.position.x, 6);
    expect(iso.position.y).toBeCloseTo(auto.position.y, 6);
    expect(iso.position.z).toBeCloseTo(auto.position.z, 6);
  });
});

describe("cameraToView", () => {
  it("round-trips every named view", () => {
    for (const [name, spec] of Object.entries(NAMED_VIEWS)) {
      const cam = viewToCamera(spec, MIN, MAX, 50, 1.5);
      const base = fitCamera(MIN, MAX, 50, 1.5).distance;
      expect(formatView(cameraToView(cam.position, cam.target, base)), name).toBe(name);
    }
  });

  it("reports a distance factor above 1 when the camera is further out", () => {
    const base = fitCamera(MIN, MAX, 50, 1.5).distance;
    const cam = viewToCamera({ ...NAMED_VIEWS.front, distance: 2 }, MIN, MAX, 50, 1.5);
    expect(cameraToView(cam.position, cam.target, base).distance).toBeCloseTo(2, 2);
  });

  it("survives a camera sitting exactly on the target", () => {
    const spec = cameraToView(v(0, 0, 0), v(0, 0, 0), 5);
    expect(Number.isFinite(spec.azimuth)).toBe(true);
    expect(Number.isFinite(spec.elevation)).toBe(true);
    expect(spec.distance).toBeGreaterThan(0);
  });
});
```

An `tests/core/camera-fit.test.ts` anhängen:

```typescript
it("reports the distance and radius it used", () => {
  const f = fitCamera(v(-1, -1, -1), v(1, 1, 1), 50, 1.5);
  expect(f.distance).toBeCloseTo(dist(f), 6);
  expect(f.radius).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/view-spec.test.ts tests/core/camera-fit.test.ts`
Expected: FAIL — `viewToCamera is not a function` bzw. `f.distance` ist `undefined`

- [ ] **Step 3: Extend `camera-fit.ts`**

In `src/core/camera-fit.ts` das Interface erweitern und die Richtung aus Winkeln ableiten. Die alte Konstante `DIRECTION = { x: 1, y: 0.8, z: 1 }` entfällt:

```typescript
export interface CameraFit {
  position: Vec3;
  target: Vec3;
  near: number;
  far: number;
  /** Abstand Kamera→Ziel dieses Einpassens — Bezugsgroesse fuer `ViewSpec.distance`. */
  distance: number;
  /** Halbe Raumdiagonale der Bounding-Box. */
  radius: number;
}

/**
 * Einheitsvektor aus Azimut/Hoehe (Grad, Y-up).
 * Azimut 0 = +Z (von vorn), 90 = +X (von rechts); Hoehe 90 = +Y (von oben).
 */
export function directionFromAngles(azimuthDeg: number, elevationDeg: number): Vec3 {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const elevation = (elevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return {
    x: horizontal * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: horizontal * Math.cos(azimuth),
  };
}

/**
 * Blick leicht von oben-vorn, damit Grundrisse lesbar sind — identisch mit
 * `NAMED_VIEWS.iso` in `view-spec.ts`. Die Gleichheit sichert ein Test ab
 * ("matches the automatic fit for `iso`"); die Zahlen stehen hier erneut, weil
 * ein Import aus `view-spec.ts` einen Zirkel erzeugen wuerde.
 */
const ISO_AZIMUTH = 45;
const ISO_ELEVATION = 30;
const DIRECTION: Vec3 = directionFromAngles(ISO_AZIMUTH, ISO_ELEVATION);
```

Am Ende von `fitCamera` die beiden neuen Felder zurückgeben (`dirLength` ist jetzt 1, die Normierung bleibt trotzdem stehen, damit die Funktion gegen eine andere Richtung robust bleibt):

```typescript
  return {
    position,
    target,
    near: Math.max(distance / 1000, MIN_EXTENT),
    far: distance + radius * 10,
    distance,
    radius,
  };
```

- [ ] **Step 4: Append to `view-spec.ts`**

```typescript
import { directionFromAngles, fitCamera, type CameraFit, type Vec3 } from "./camera-fit";

/** ViewSpec → Kameraposition. Ziel und Basisdistanz kommen aus dem Einpassen. */
export function viewToCamera(
  spec: ViewSpec,
  min: Vec3,
  max: Vec3,
  fovDeg: number,
  aspect: number,
): CameraFit {
  const fit = fitCamera(min, max, fovDeg, aspect);
  const distance = fit.distance * spec.distance;
  const dir = directionFromAngles(spec.azimuth, spec.elevation);

  return {
    position: {
      x: fit.target.x + dir.x * distance,
      y: fit.target.y + dir.y * distance,
      z: fit.target.z + dir.z * distance,
    },
    target: fit.target,
    near: Math.max(distance / 1000, 1e-3),
    far: distance + fit.radius * 10,
    distance,
    radius: fit.radius,
  };
}

/** Ist-Kamera → ViewSpec. `baseDistance` ist `fitCamera(...).distance` desselben Modells. */
export function cameraToView(position: Vec3, target: Vec3, baseDistance: number): ViewSpec {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const length = Math.hypot(dx, dy, dz);

  // Kamera exakt auf dem Ziel: keine Richtung ableitbar → Auto-Blick zurueckgeben.
  if (length < 1e-6 || baseDistance <= 0) return { ...NAMED_VIEWS.iso };

  const azimuth = (Math.atan2(dx, dz) * 180) / Math.PI;
  const elevation = (Math.asin(dy / length) * 180) / Math.PI;

  return {
    azimuth: wrapAzimuth(azimuth),
    elevation: clampElevation(elevation),
    distance: Math.max(round2(length / baseDistance), 0.01),
  };
}
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS — inklusive der bestehenden `camera-fit`-Tests, die durch die additiven Felder unberührt bleiben

- [ ] **Step 6: Verify purity and types**

Run: `npm run check:pure && npm run typecheck`
Expected: keine Fehler

- [ ] **Step 7: Commit**

```bash
git add src/core/view-spec.ts src/core/camera-fit.ts tests/core/view-spec.test.ts tests/core/camera-fit.test.ts
git commit -m "feat(core): Winkel↔Kamera-Umrechnung, iso wird zur einen Wahrheit des Auto-Blicks"
```

---

### Task 3: `block-config.ts` — den `view:`-Key lesen

**Files:**
- Modify: `src/core/block-config.ts`
- Test: `tests/core/block-config.test.ts`

**Interfaces:**
- Consumes: `parseView`, `VIEW_NAMES`, `ViewSpec` aus Task 1.
- Produces: `BlockConfig` zusätzlich mit `view?: ViewSpec`.

- [ ] **Step 1: Write the failing test**

An `tests/core/block-config.test.ts` anhängen:

```typescript
import { NAMED_VIEWS } from "../../src/core/view-spec";

describe("view key", () => {
  it("reads a named view", () => {
    const result = parseBlockConfig("file: a.glb\nview: top");
    expect(result.config?.view).toEqual(NAMED_VIEWS.top);
    expect(result.warnings).toEqual([]);
  });

  it("reads three numbers", () => {
    const result = parseBlockConfig("file: a.glb\nview: 45, 30, 1.2");
    expect(result.config?.view).toEqual({ azimuth: 45, elevation: 30, distance: 1.2 });
  });

  it("warns about an unreadable value but still renders", () => {
    const result = parseBlockConfig("file: a.glb\nview: schräg-von-oben");
    expect(result.config).not.toBeNull();
    expect(result.config?.view).toBeUndefined();
    expect(result.warnings[0]).toContain("`view`");
    expect(result.errors).toEqual([]);
  });

  it("leaves view undefined when the key is absent", () => {
    expect(parseBlockConfig("file: a.glb").config?.view).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/block-config.test.ts`
Expected: FAIL — `view` ist kein bekannter Key, `result.config?.view` ist `undefined` und es entsteht die generische „Unknown key"-Warnung

- [ ] **Step 3: Extend `block-config.ts`**

```typescript
import { VIEW_NAMES, parseView, type ViewSpec } from "./view-spec";

export interface BlockConfig {
  file: string;
  height?: number;
  title?: string;
  view?: ViewSpec;
}

const KNOWN_KEYS = ["file", "height", "title", "view"] as const;
```

In `parseBlockConfig` neben `let title` ein `let view: ViewSpec | undefined;` ergänzen, den Zweig einhängen und `view` mit zurückgeben:

```typescript
    if (key === "file") {
      file = value;
      fileSeen += 1;
    } else if (key === "title") {
      title = value;
    } else if (key === "view") {
      const parsed = parseView(value);
      if (parsed === null) {
        warnings.push(
          `\`view\`: unknown view \`${value}\` — use ${VIEW_NAMES} or three numbers (azimuth,elevation,distance)`,
        );
      } else {
        view = parsed;
      }
    } else {
```

```typescript
  return { config: { file, height, title, view }, errors: [], warnings };
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/block-config.ts tests/core/block-config.test.ts
git commit -m "feat(core): block-config liest view:-Key, unlesbarer Wert warnt nur"
```

---

### Task 4: `block-edit.ts` — die `view:`-Zeile im Blocktext setzen

**Files:**
- Create: `src/core/block-edit.ts`
- Test: `tests/core/block-edit.test.ts`

**Interfaces:**
- Consumes: `ViewSpec`, `formatView` aus Task 1.
- Produces: `applyViewKey(source: string, spec: ViewSpec | null): string`.

- [ ] **Step 1: Write the failing test**

`tests/core/block-edit.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { applyViewKey } from "../../src/core/block-edit";
import { NAMED_VIEWS } from "../../src/core/view-spec";

const TOP = NAMED_VIEWS.top;

describe("applyViewKey", () => {
  it("adds the key right after file:", () => {
    expect(applyViewKey("file: a.glb\nheight: 300", TOP)).toBe("file: a.glb\nview: top\nheight: 300");
  });

  it("adds the key after a bare path short form", () => {
    expect(applyViewKey("models/a.glb", TOP)).toBe("models/a.glb\nview: top");
  });

  it("replaces an existing key in place", () => {
    expect(applyViewKey("file: a.glb\nview: front\ntitle: X", TOP)).toBe(
      "file: a.glb\nview: top\ntitle: X",
    );
  });

  it("removes the key when given null", () => {
    expect(applyViewKey("file: a.glb\nview: top\ntitle: X", null)).toBe("file: a.glb\ntitle: X");
  });

  it("keeps only the first of several view lines", () => {
    expect(applyViewKey("file: a.glb\nview: front\nview: back", TOP)).toBe("file: a.glb\nview: top");
  });

  it("keeps comments, blank lines and unknown keys untouched", () => {
    const source = "# my house\nfile: a.glb\n\nwobble: 3";
    expect(applyViewKey(source, TOP)).toBe("# my house\nfile: a.glb\nview: top\n\nwobble: 3");
  });

  it("appends at the end when there is no file line at all", () => {
    expect(applyViewKey("height: 300", TOP)).toBe("height: 300\nview: top");
  });

  it("returns the source unchanged when removing a key that is not there", () => {
    expect(applyViewKey("file: a.glb", null)).toBe("file: a.glb");
  });

  it("preserves a trailing newline", () => {
    expect(applyViewKey("file: a.glb\n", TOP)).toBe("file: a.glb\nview: top\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/block-edit.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/block-edit"`

- [ ] **Step 3: Write the implementation**

`src/core/block-edit.ts`:

```typescript
// Blockquelltext → Blockquelltext mit gesetztem/entferntem `view:`. Pure.
//
// Alles ausser der `view:`-Zeile bleibt buchstabengetreu erhalten: Kommentare,
// Leerzeilen, Reihenfolge, unbekannte Keys, abschliessender Zeilenumbruch.
import { formatView, type ViewSpec } from "./view-spec";

const VIEW_LINE = /^\s*view\s*:/i;
const FILE_LINE = /^\s*file\s*:/i;
const KEY_LINE = /^\s*[A-Za-z][A-Za-z0-9_-]*\s*:/;

export function applyViewKey(source: string, spec: ViewSpec | null): string {
  const hadTrailingNewline = source.endsWith("\n");
  const body = hadTrailingNewline ? source.slice(0, -1) : source;
  const lines = body.split("\n");

  const kept = lines.filter((line) => !VIEW_LINE.test(line));
  const result = spec === null ? kept : insert(kept, `view: ${formatView(spec)}`);

  return hadTrailingNewline ? `${result.join("\n")}\n` : result.join("\n");
}

/** Hinter `file:`, sonst hinter der Pfad-Kurzform, sonst ans Ende. */
function insert(lines: string[], viewLine: string): string[] {
  let anchor = lines.findIndex((line) => FILE_LINE.test(line));

  if (anchor === -1) {
    anchor = lines.findIndex(
      (line) => line.trim() !== "" && !line.trim().startsWith("#") && !KEY_LINE.test(line),
    );
  }

  if (anchor === -1) return [...lines, viewLine];
  return [...lines.slice(0, anchor + 1), viewLine, ...lines.slice(anchor + 1)];
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/core/block-edit.test.ts`
Expected: PASS (9 Fälle)

- [ ] **Step 5: Verify purity**

Run: `npm run check:pure && npm run typecheck`
Expected: keine Fehler

- [ ] **Step 6: Commit**

```bash
git add src/core/block-edit.ts tests/core/block-edit.test.ts
git commit -m "feat(core): applyViewKey setzt/entfernt die view:-Zeile buchstabengetreu"
```

---

### Task 5: `panel-target.ts` + Setting `panelPlacement`

**Files:**
- Create: `src/core/panel-target.ts`
- Modify: `src/core/settings-types.ts`
- Test: `tests/core/panel-target.test.ts`, `tests/core/settings-types.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `PanelPlacement = "sidebar" | "toolbar" | "auto"`, `PanelTarget = "panel" | "toolbar" | "none"`, `resolvePanelTarget(placement, panelVisible): PanelTarget`; `PluginSettings` zusätzlich mit `panelPlacement: PanelPlacement` (Default `"auto"`).

- [ ] **Step 1: Write the failing tests**

`tests/core/panel-target.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolvePanelTarget } from "../../src/core/panel-target";

describe("resolvePanelTarget", () => {
  it("uses the panel and nothing else when set to sidebar", () => {
    expect(resolvePanelTarget("sidebar", true)).toBe("panel");
    expect(resolvePanelTarget("sidebar", false)).toBe("none");
  });

  it("always uses the toolbar when set to toolbar", () => {
    expect(resolvePanelTarget("toolbar", true)).toBe("toolbar");
    expect(resolvePanelTarget("toolbar", false)).toBe("toolbar");
  });

  it("falls back from panel to toolbar when set to auto", () => {
    expect(resolvePanelTarget("auto", true)).toBe("panel");
    expect(resolvePanelTarget("auto", false)).toBe("toolbar");
  });
});
```

An `tests/core/settings-types.test.ts` anhängen:

```typescript
describe("panelPlacement", () => {
  it("defaults to auto", () => {
    expect(mergeSettings({}).panelPlacement).toBe("auto");
  });

  it("keeps a valid value", () => {
    expect(mergeSettings({ panelPlacement: "toolbar" }).panelPlacement).toBe("toolbar");
  });

  it("falls back to the default for garbage", () => {
    expect(mergeSettings({ panelPlacement: "somewhere" }).panelPlacement).toBe("auto");
    expect(mergeSettings({ panelPlacement: 7 }).panelPlacement).toBe("auto");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/panel-target.test.ts tests/core/settings-types.test.ts`
Expected: FAIL — Modul fehlt bzw. `panelPlacement` ist `undefined`

- [ ] **Step 3: Write `panel-target.ts`**

```typescript
// Wo die Bedienung erscheint. Pure.
//
// Uebernommen von `vim-dojo/src/hudPlacement.ts` (resolveHudTarget) — dort entschied
// dieselbe Frage zwischen Sidebar-Pane und schwebender Box. Ein `dismissed`-Zustand
// fehlt hier bewusst: vim-dojos Box schwebt ueber fremdem Editortext und muss
// wegklickbar sein, unsere Leiste liegt im eigenen Kasten und verdeckt nichts.

/** Nutzer-Einstellung. */
export type PanelPlacement = "sidebar" | "toolbar" | "auto";

/** Die Flaeche, auf der die Bedienung im aktuellen Zustand tatsaechlich erscheint. */
export type PanelTarget = "panel" | "toolbar" | "none";

export function resolvePanelTarget(
  placement: PanelPlacement,
  panelVisible: boolean,
): PanelTarget {
  if (placement === "sidebar") return panelVisible ? "panel" : "none";
  if (placement === "toolbar") return "toolbar";
  return panelVisible ? "panel" : "toolbar";
}
```

- [ ] **Step 4: Extend `settings-types.ts`**

```typescript
import type { PanelPlacement } from "./panel-target";
```

In `PluginSettings` `panelPlacement: PanelPlacement;` ergänzen, in `DEFAULT_SETTINGS` `panelPlacement: "auto",` und in `mergeSettings` — nach dem bestehenden Einzelfeld-Muster, kein Spread:

```typescript
    panelPlacement:
      raw.panelPlacement === "sidebar" ||
      raw.panelPlacement === "toolbar" ||
      raw.panelPlacement === "auto"
        ? raw.panelPlacement
        : DEFAULT_SETTINGS.panelPlacement,
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/panel-target.ts src/core/settings-types.ts tests/core/panel-target.test.ts tests/core/settings-types.test.ts
git commit -m "feat(core): resolvePanelTarget + Setting panelPlacement (Muster aus vim-dojo)"
```

---

### Task 6: `active-viewport.ts` — Controller-Interface und Registry

**Files:**
- Create: `src/core/active-viewport.ts`
- Test: `tests/core/active-viewport.test.ts`

**Interfaces:**
- Consumes: `ViewSpec` aus Task 1.
- Produces: `ViewportController` (Methoden `getView(): ViewSpec | null`, `applyView(spec: ViewSpec | null): void`, `canSave(): boolean`, `save(spec: ViewSpec | null): Promise<void>`, `label(): string`) und `class ActiveViewport` mit `set(c)`, `get()`, `clearIf(c)`, `subscribe(fn): () => void`.

- [ ] **Step 1: Write the failing test**

`tests/core/active-viewport.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { ActiveViewport, type ViewportController } from "../../src/core/active-viewport";

function makeController(name: string): ViewportController {
  return {
    getView: () => null,
    applyView: vi.fn(),
    canSave: () => true,
    save: vi.fn(async () => {}),
    label: () => name,
  };
}

describe("ActiveViewport", () => {
  it("starts with nothing active", () => {
    expect(new ActiveViewport().get()).toBeNull();
  });

  it("remembers the last one set", () => {
    const active = new ActiveViewport();
    const a = makeController("a");
    const b = makeController("b");
    active.set(a);
    active.set(b);
    expect(active.get()).toBe(b);
  });

  it("notifies subscribers on change", () => {
    const active = new ActiveViewport();
    const seen: (string | null)[] = [];
    active.subscribe((c) => seen.push(c?.label() ?? null));
    active.set(makeController("a"));
    expect(seen).toEqual(["a"]);
  });

  it("does not notify when the same controller is set again", () => {
    const active = new ActiveViewport();
    const a = makeController("a");
    active.set(a);
    const listener = vi.fn();
    active.subscribe(listener);
    active.set(a);
    expect(listener).not.toHaveBeenCalled();
  });

  it("clearIf only clears the one that is actually active", () => {
    const active = new ActiveViewport();
    const a = makeController("a");
    const b = makeController("b");
    active.set(a);
    active.clearIf(b);
    expect(active.get()).toBe(a);
    active.clearIf(a);
    expect(active.get()).toBeNull();
  });

  it("stops notifying after unsubscribe", () => {
    const active = new ActiveViewport();
    const listener = vi.fn();
    const off = active.subscribe(listener);
    off();
    active.set(makeController("a"));
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/active-viewport.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/active-viewport"`

- [ ] **Step 3: Write the implementation**

`src/core/active-viewport.ts`:

```typescript
// Welcher Viewport wird gerade bedient? Pure — kein obsidian, kein three.
//
// Eine Notiz kann mehrere Modelle zeigen (fuenf Etagen). Aktiv ist der zuletzt
// benutzte; gespeist wird das aus `onInteract`, das schon heute jede echte
// Nutzerinteraktion meldet (Autorotate zaehlt bewusst nicht).
import type { ViewSpec } from "./view-spec";

/**
 * Begruendung, wenn `canSave()` false ist. Steht hier, damit Sidebar, Toolbar,
 * Block und die Wege ohne Codeblock denselben Satz zeigen.
 */
export const NO_BLOCK_REASON = "The view can only be saved in a `3d` code block";

/** Was Sidebar und Toolbar von einem Viewport brauchen — three.js sehen sie nie. */
export interface ViewportController {
  /** Aktuelle Kamera als Spec, oder `null`, wenn (noch) kein Modell geladen ist. */
  getView(): ViewSpec | null;
  /** Kamera setzen; `null` = automatisch einpassen. */
  applyView(spec: ViewSpec | null): void;
  /** Gibt es einen Codeblock, in den geschrieben werden kann? */
  canSave(): boolean;
  /** In den Block schreiben; `null` entfernt den Key. */
  save(spec: ViewSpec | null): Promise<void>;
  /** Anzeigename fuer die Sidebar (Titel oder Dateipfad). */
  label(): string;
}

type Listener = (controller: ViewportController | null) => void;

export class ActiveViewport {
  private current: ViewportController | null = null;
  private readonly listeners = new Set<Listener>();

  get(): ViewportController | null {
    return this.current;
  }

  set(controller: ViewportController | null): void {
    if (this.current === controller) return;
    this.current = controller;
    for (const listener of this.listeners) listener(controller);
  }

  /** Beim Entladen eines Blocks — raeumt nur auf, wenn er auch der aktive war. */
  clearIf(controller: ViewportController): void {
    if (this.current === controller) this.set(null);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Verify purity**

Run: `npm run check:pure`
Expected: keine Ausgabe

- [ ] **Step 6: Commit**

```bash
git add src/core/active-viewport.ts tests/core/active-viewport.test.ts
git commit -m "feat(core): ViewportController-Interface + ActiveViewport-Registry"
```

---

### Task 7: `block-writer.ts` — der zweigleisige Schreiber

**Files:**
- Create: `src/obsidian/block-writer.ts`
- Test: `tests/obsidian/block-writer.test.ts`

**Interfaces:**
- Consumes: nichts aus früheren Tasks (arbeitet auf reinem Text).
- Produces: `BlockLocation { path: string; lineStart: number; lineEnd: number }`, `EditorPort { editorFor(path: string): EditorHandle | null }`, `EditorHandle { getValue(): string; replaceRange(text: string, from: {line: number; ch: number}, to: {line: number; ch: number}): void }`, `VaultPort { read(path): Promise<string>; process(path, fn: (text: string) => string): Promise<void> }`, `BlockChangedError`, `writeBlockBody(ports, loc, expectedBody, nextBody): Promise<void>`.

**Warum Ports:** Der Schreiber ist die gefährlichste Stelle des Vorhabens und muss ohne echtes Obsidian testbar sein. Die beiden Ports sind so schmal, dass die Obsidian-Umsetzung in Task 9 trivial bleibt.

- [ ] **Step 1: Write the failing test**

`tests/obsidian/block-writer.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  BlockChangedError,
  writeBlockBody,
  type BlockLocation,
} from "../../src/obsidian/block-writer";

const NOTE = ["# Note", "", "```3d", "file: a.glb", "```", "", "text below"].join("\n");
const LOC: BlockLocation = { path: "note.md", lineStart: 2, lineEnd: 4 };

function makePorts(content = NOTE, withEditor = false) {
  const state = { content };
  const editor = {
    getValue: () => state.content,
    replaceRange: vi.fn((text: string, from: any, to: any) => {
      const lines = state.content.split("\n");
      const before = lines.slice(0, from.line);
      const after = lines.slice(to.line + 1);
      state.content = [...before, ...text.split("\n"), ...after].join("\n");
    }),
  };
  return {
    state,
    editor,
    ports: {
      editorFor: (path: string) => (withEditor && path === "note.md" ? editor : null),
      vault: {
        read: async () => state.content,
        process: async (_path: string, fn: (text: string) => string) => {
          state.content = fn(state.content);
        },
      },
    },
  };
}

describe("writeBlockBody", () => {
  it("replaces the block body through the vault when no editor is open", async () => {
    const { state, ports } = makePorts();
    await writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top");
    expect(state.content).toContain("```3d\nfile: a.glb\nview: top\n```");
    expect(state.content).toContain("text below");
  });

  it("uses the editor when the note is open, so undo works", async () => {
    const { state, editor, ports } = makePorts(NOTE, true);
    await writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top");
    expect(editor.replaceRange).toHaveBeenCalled();
    expect(state.content).toContain("view: top");
  });

  it("refuses to write when the note changed underneath", async () => {
    const changed = NOTE.replace("file: a.glb", "file: SOMETHING-ELSE.glb");
    const { state, ports } = makePorts(changed);
    await expect(
      writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top"),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(state.content).toBe(changed);
  });

  it("refuses to write when the block moved out of the file", async () => {
    const { state, ports } = makePorts("short file");
    await expect(
      writeBlockBody(ports, LOC, "file: a.glb", "file: a.glb\nview: top"),
    ).rejects.toBeInstanceOf(BlockChangedError);
    expect(state.content).toBe("short file");
  });

  it("handles a multi-line body", async () => {
    const note = ["```3d", "file: a.glb", "view: front", "title: X", "```"].join("\n");
    const { state, ports } = makePorts(note);
    await writeBlockBody(
      ports,
      { path: "note.md", lineStart: 0, lineEnd: 4 },
      "file: a.glb\nview: front\ntitle: X",
      "file: a.glb\nview: top\ntitle: X",
    );
    expect(state.content).toBe(["```3d", "file: a.glb", "view: top", "title: X", "```"].join("\n"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/block-writer.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/obsidian/block-writer"`

- [ ] **Step 3: Write the implementation**

`src/obsidian/block-writer.ts`:

```typescript
// Schreibt den Rumpf eines Codeblocks zurueck in die Notiz — zweigleisig.
//
// 1. Notiz in einem sichtbaren Editor offen → `replaceRange`, damit Strg+Z wirkt.
// 2. Sonst → `vault.process` (atomar, funktioniert auch im Lesemodus).
//
// Beide Wege pruefen VOR dem Schreiben, ob an der gemerkten Stelle noch der Block
// steht, den wir gerendert haben. `getSectionInfo` kann veraltet sein, wenn
// zwischenzeitlich getippt wurde — ohne diese Pruefung wuerden fremde Zeilen
// ueberschrieben. Das ist der gefaehrlichste Fehler dieses Features und wird
// durch Vergleich statt durch Vertrauen ausgeschlossen.

/** Zeilen des Blocks: `lineStart` ist die ```-Zeile, `lineEnd` die schliessende. */
export interface BlockLocation {
  path: string;
  lineStart: number;
  lineEnd: number;
}

export interface EditorHandle {
  getValue(): string;
  replaceRange(
    text: string,
    from: { line: number; ch: number },
    to: { line: number; ch: number },
  ): void;
}

export interface VaultPort {
  read(path: string): Promise<string>;
  process(path: string, fn: (text: string) => string): Promise<void>;
}

export interface WritePorts {
  /** Editor der Datei, wenn sie in einem sichtbaren Blatt offen ist — sonst `null`. */
  editorFor(path: string): EditorHandle | null;
  vault: VaultPort;
}

export class BlockChangedError extends Error {
  constructor() {
    super("Note changed — view not saved");
    this.name = "BlockChangedError";
  }
}

/** Zeilen zwischen den Fences, oder `null`, wenn die Stelle nicht mehr passt. */
function bodyAt(content: string, loc: BlockLocation): string | null {
  const lines = content.split("\n");
  if (loc.lineEnd >= lines.length || loc.lineStart >= loc.lineEnd) return null;
  return lines.slice(loc.lineStart + 1, loc.lineEnd).join("\n");
}

function replaceBody(content: string, loc: BlockLocation, nextBody: string): string {
  const lines = content.split("\n");
  return [
    ...lines.slice(0, loc.lineStart + 1),
    ...nextBody.split("\n"),
    ...lines.slice(loc.lineEnd),
  ].join("\n");
}

export async function writeBlockBody(
  ports: WritePorts,
  loc: BlockLocation,
  expectedBody: string,
  nextBody: string,
): Promise<void> {
  const editor = ports.editorFor(loc.path);

  if (editor) {
    const content = editor.getValue();
    if (bodyAt(content, loc) !== expectedBody) throw new BlockChangedError();

    const lines = content.split("\n");
    const lastBodyLine = loc.lineEnd - 1;
    editor.replaceRange(
      nextBody,
      { line: loc.lineStart + 1, ch: 0 },
      { line: lastBodyLine, ch: lines[lastBodyLine].length },
    );
    return;
  }

  const content = await ports.vault.read(loc.path);
  if (bodyAt(content, loc) !== expectedBody) throw new BlockChangedError();

  await ports.vault.process(loc.path, (current) => {
    // Zwischen `read` und `process` kann sich die Datei geaendert haben — erneut pruefen.
    if (bodyAt(current, loc) !== expectedBody) throw new BlockChangedError();
    return replaceBody(current, loc, nextBody);
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/obsidian/block-writer.test.ts`
Expected: PASS (5 Fälle)

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/obsidian/block-writer.ts tests/obsidian/block-writer.test.ts
git commit -m "feat(obsidian): zweigleisiger Block-Schreiber mit Abgleich vor dem Schreiben"
```

---

### Task 8: `viewport.ts` — Ansicht setzen und auslesen

**Files:**
- Modify: `src/viewer/viewport.ts`
- Modify: `src/obsidian/viewer-host.ts` (Interface `ViewportLike` erweitern, Ansicht nach `setModel` anwenden)
- Test: `tests/obsidian/viewer-host.test.ts`

**Interfaces:**
- Consumes: `ViewSpec`, `viewToCamera`, `cameraToView` aus Task 1/2; `fitCamera` aus `camera-fit.ts`.
- Produces: `Viewport.setView(spec: ViewSpec | null): void`, `Viewport.getView(): ViewSpec | null`; `ViewportLike` um dieselben zwei Methoden erweitert; `RenderSource` um `view?: ViewSpec`.

**Hinweis zur Testbarkeit:** `viewport.ts` bindet three.js und WebGL und hat deshalb wie schon bisher keinen Unit-Test — abgesichert wird es über `npm run typecheck` und den GUI-Smoke (Task 12). Die Rechenlogik dahinter ist in Task 1/2 vollständig getestet. Getestet wird hier, dass `ViewerHost` die Ansicht **weiterreicht**.

- [ ] **Step 1: Write the failing test**

In `tests/obsidian/viewer-host.test.ts` zuerst den vorhandenen Fake-Viewport `makeVp()` um die zwei neuen Methoden ergänzen (er muss `ViewportLike` weiter erfüllen):

```typescript
function makeVp() {
  return {
    disposed: 0,
    setModel: vi.fn(),
    setView: vi.fn(),
    getView: vi.fn(() => null),
    setColors: vi.fn(),
    resize: vi.fn(),
    resetCamera: vi.fn(),
    capturePoster: () => "data:image/png;base64,AAA",
    dispose() {
      this.disposed += 1;
    },
  };
}
```

Dann die zwei neuen Fälle anhängen — sie nutzen die schon vorhandenen Hilfen `makeHost()` und `bytes`:

```typescript
import { NAMED_VIEWS } from "../../src/core/view-spec";

it("applies the block's view after loading the model", async () => {
  const { host, created } = makeHost();
  await host.render({
    provideBytes: bytes,
    format: "gltf",
    inspectContainer: false,
    label: "x",
    view: NAMED_VIEWS.top,
  });
  expect(created[0].setView).toHaveBeenCalledWith(NAMED_VIEWS.top);
});

it("fits automatically when the block has no view", async () => {
  const { host, created } = makeHost();
  await host.render({ provideBytes: bytes, format: "gltf", inspectContainer: false, label: "x" });
  expect(created[0].setView).toHaveBeenCalledWith(null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/viewer-host.test.ts`
Expected: FAIL — `created[0].setView` ist nie aufgerufen worden

- [ ] **Step 3: Extend `viewport.ts`**

Import ergänzen und die Basisdistanz beim Setzen des Modells merken:

```typescript
import { fitCamera } from "../core/camera-fit";
import { cameraToView, viewToCamera, type ViewSpec } from "../core/view-spec";
```

Feld ergänzen: `private baseDistance = 0;`

In `setModel` nach dem Setzen von `this.bounds` merken und die Wunschansicht anwenden statt blind einzupassen:

```typescript
    this.baseDistance = fitCamera(box.min, box.max, FOV_DEG, this.aspect()).distance;
    this.updateGrid();
    this.setView(this.pendingView);
```

Feld dafür: `private pendingView: ViewSpec | null = null;` — gesetzt von `setView`, bevor ein Modell da ist.

Neue Methoden:

```typescript
  /** Kamera auf die Ansicht setzen; `null` = automatisch einpassen. */
  setView(spec: ViewSpec | null): void {
    this.pendingView = spec;
    if (this.disposed || !this.bounds) return;

    const fit =
      spec === null
        ? fitCamera(this.bounds.min, this.bounds.max, FOV_DEG, this.aspect())
        : viewToCamera(spec, this.bounds.min, this.bounds.max, FOV_DEG, this.aspect());

    this.camera.position.set(fit.position.x, fit.position.y, fit.position.z);
    this.camera.near = fit.near;
    this.camera.far = fit.far;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(fit.target.x, fit.target.y, fit.target.z);
    this.controls.update();
    this.requestRender();
  }

  /** Aktuelle Kamera als Spec — `null`, solange kein Modell geladen ist. */
  getView(): ViewSpec | null {
    if (this.disposed || !this.bounds || this.baseDistance <= 0) return null;
    return cameraToView(this.camera.position, this.controls.target, this.baseDistance);
  }
```

`resetCamera()` wird zum Einzeiler, damit es nur eine Kamera-Setz-Stelle gibt:

```typescript
  resetCamera(): void {
    this.setView(null);
  }
```

Der Doppelklick-Handler bleibt unverändert und ruft weiterhin `resetCamera()`.

- [ ] **Step 4: Extend `viewer-host.ts`**

`ViewportLike` um die zwei Methoden erweitern:

```typescript
export interface ViewportLike {
  setModel(object: unknown): void;
  setView(spec: ViewSpec | null): void;
  getView(): ViewSpec | null;
  setColors(colors: SceneColors): void;
  resize(): void;
  resetCamera(): void;
  capturePoster(): string | null;
  dispose(): void;
}
```

`RenderSource` um `view?: ViewSpec` erweitern und in `mount` direkt nach `viewport.setModel(object)` anwenden:

```typescript
      viewport.setModel(object);
      viewport.setView(source.view ?? null);
```

Zusätzlich zwei Durchreichen für den Controller in Task 9:

```typescript
  currentView(): ViewSpec | null {
    return this.viewport?.getView() ?? null;
  }

  applyView(spec: ViewSpec | null): void {
    this.viewport?.setView(spec);
  }
```

- [ ] **Step 5: Pass the view through the block**

In `src/obsidian/block-child.ts` in `loadNow()` das Feld mitgeben:

```typescript
      inspectContainer: needsContainerInspection(file.path),
      label: this.config.title ?? file.path,
      view: this.config.view,
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — bestehende Tests von `block-child`/`file-view`/`embed` müssen ebenfalls grün bleiben; wo Fake-Viewports das Interface erfüllen müssen, `setView`/`getView` ergänzen

- [ ] **Step 7: Commit**

```bash
git add src/viewer/viewport.ts src/obsidian/viewer-host.ts src/obsidian/block-child.ts tests/obsidian/viewer-host.test.ts
git commit -m "feat(viewer): setView/getView, Block-Ansicht wird nach dem Laden angewendet"
```

---

### Task 9: `ModelBlock` wird zum `ViewportController`

**Files:**
- Modify: `src/obsidian/block-child.ts`
- Modify: `src/main.ts` (Kontext durchreichen, `ActiveViewport` anlegen)
- Test: `tests/obsidian/block-child.test.ts`

**Interfaces:**
- Consumes: `ViewportController`, `ActiveViewport` (Task 6); `writeBlockBody`, `BlockLocation`, `BlockChangedError`, `WritePorts` (Task 7); `applyViewKey` (Task 4); `ViewerHost.currentView/applyView` (Task 8).
- Produces: `ModelBlock` implementiert `ViewportController`; `BlockDeps` zusätzlich mit `active: ActiveViewport`, `writePorts: WritePorts`, `sectionInfo: () => { lineStart: number; lineEnd: number } | null`.

- [ ] **Step 1: Write the failing test**

An `tests/obsidian/block-child.test.ts` anhängen. Der Helfer setzt auf die dort bereits
vorhandenen `makeDeps`, `makeFakeEl` und `glbFile` auf:

```typescript
import { ActiveViewport } from "../../src/core/active-viewport";
import { NAMED_VIEWS } from "../../src/core/view-spec";

/** Ein geladener Block mit aktiver Registry und mitschreibenden Schreib-Ports. */
async function loadedBlock(
  source = "file: model.glb",
  overrides: Record<string, unknown> = {},
) {
  const written: string[] = [];
  const active = new ActiveViewport();
  const writePorts = {
    editorFor: () => null,
    vault: {
      read: async () => ["```3d", source, "```"].join("\n"),
      process: async (_path: string, fn: (text: string) => string) => {
        const next = fn(["```3d", source, "```"].join("\n"));
        written.push(next.split("\n").slice(1, -1).join("\n"));
      },
    },
  };

  const { deps, created, app } = makeDeps({
    active,
    writePorts,
    sectionInfo: () => ({ lineStart: 0, lineEnd: source.split("\n").length + 1 }),
    panelVisible: () => false,
    ...overrides,
  });
  app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(glbFile("model.glb"));

  const block = new ModelBlock(makeFakeEl(), source, "note.md", deps);
  block.onload();
  await block.loadNow();

  return { block, created, active, written };
}

describe("as a ViewportController", () => {
  it("becomes the active viewport when the user interacts", async () => {
    const { block, created, active } = await loadedBlock();
    created[0].opts.onInteract();
    expect(active.get()).toBe(block);
  });

  it("clears itself from the registry on unload", async () => {
    const { block, created, active } = await loadedBlock();
    created[0].opts.onInteract();
    block.onunload();
    expect(active.get()).toBeNull();
  });

  it("leaves another block active when a different one unloads", async () => {
    const first = await loadedBlock();
    first.created[0].opts.onInteract();
    const other = await loadedBlock();
    other.block.onunload();
    expect(first.active.get()).toBe(first.block);
  });

  it("can save when the section info is known", async () => {
    const { block } = await loadedBlock();
    expect(block.canSave()).toBe(true);
  });

  it("cannot save when the section info is missing", async () => {
    const { block } = await loadedBlock("file: model.glb", { sectionInfo: () => null });
    expect(block.canSave()).toBe(false);
  });

  it("writes the view key into the block body", async () => {
    const { block, written } = await loadedBlock();
    await block.save(NAMED_VIEWS.top);
    expect(written[0]).toBe("file: model.glb\nview: top");
  });

  it("removes the view key when saving null", async () => {
    const { block, written } = await loadedBlock("file: model.glb\nview: top");
    await block.save(null);
    expect(written[0]).toBe("file: model.glb");
  });

  it("writes nothing when the value would not change", async () => {
    const { block, written } = await loadedBlock("file: model.glb\nview: top");
    await block.save(NAMED_VIEWS.top);
    expect(written).toEqual([]);
  });
});
```

**Hinweis:** In der ersten Registry-Prüfung steckt der Grund für `clearIf` statt `set(null)` —
entlädt ein *anderer* Block, darf der aktive nicht mitgelöscht werden.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/block-child.test.ts`
Expected: FAIL — `block.canSave is not a function`

- [ ] **Step 3: Extend `block-child.ts`**

Imports und `BlockDeps`:

```typescript
import { Notice } from "obsidian";
import {
  NO_BLOCK_REASON,
  type ActiveViewport,
  type ViewportController,
} from "../core/active-viewport";
import { applyViewKey } from "../core/block-edit";
import type { ViewSpec } from "../core/view-spec";
import { BlockChangedError, writeBlockBody, type WritePorts } from "./block-writer";
// Fehlertext-Hilfe aus dem Host mitbenutzen statt sie zu spiegeln — dort wird
// `describe` dafuer zu `export function describeError` umbenannt.
import { describeError } from "./viewer-host";

export interface BlockDeps {
  app: App;
  settings: () => PluginSettings;
  factory: ViewportFactory;
  budget: ContextBudget;
  loadModel(buffer: ArrayBuffer, format: ModelFormat, materialColor: string): Promise<unknown>;
  readColors(el: HTMLElement): SceneColors;
  active: ActiveViewport;
  writePorts: WritePorts;
  /** Zeilen dieses Blocks — `null`, wenn Obsidian sie nicht kennt (Popover, Export). */
  sectionInfo: () => { lineStart: number; lineEnd: number } | null;
}
```

Klassendeklaration: `export class ModelBlock extends MarkdownRenderChild implements ViewportController`.

Der `onInteract`-Hook wird beim Bauen des Hosts überschrieben — der Host reicht ihn bereits ans Budget weiter, hier kommt die Registrierung dazu:

```typescript
    this.host = new ViewerHost(this.parts.stage, this.parts.message, {
      ...this.deps,
      managed: true,
      budget: {
        register: (id, release) => this.deps.budget.register(id, release),
        unregister: (id) => this.deps.budget.unregister(id),
        touch: (id) => {
          this.deps.active.set(this);
          this.containerEl.addClass("tdcb-active");
          this.deps.budget.touch(id);
        },
      },
    });
```

In `onunload()` vor dem Dispose aufräumen:

```typescript
    this.deps.active.clearIf(this);
```

Die vier Controller-Methoden:

```typescript
  label(): string {
    return this.config?.title ?? this.config?.file ?? "3D model";
  }

  getView(): ViewSpec | null {
    return this.host?.currentView() ?? null;
  }

  applyView(spec: ViewSpec | null): void {
    this.host?.applyView(spec);
  }

  canSave(): boolean {
    return this.deps.sectionInfo() !== null;
  }

  async save(spec: ViewSpec | null): Promise<void> {
    const info = this.deps.sectionInfo();
    if (info === null) {
      new Notice(NO_BLOCK_REASON);
      return;
    }

    const next = applyViewKey(this.source, spec);
    if (next === this.source) return;

    try {
      await writeBlockBody(
        this.deps.writePorts,
        { path: this.sourcePath, lineStart: info.lineStart, lineEnd: info.lineEnd },
        this.source,
        next,
      );
      new Notice(spec === null ? "View cleared" : "View saved");
    } catch (error) {
      new Notice(
        error instanceof BlockChangedError
          ? error.message
          : `Could not save view: ${describeError(error)}`,
      );
    }
  }
```

In `src/obsidian/viewer-host.ts` dafür die private Hilfe umbenennen und exportieren (die drei
vorhandenen Aufrufstellen in derselben Datei mitziehen):

```typescript
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Wire it up in `main.ts`**

Feld anlegen und die neuen Deps beim Erzeugen des Blocks übergeben — `ctx` liefert die Zeilen:

```typescript
import { ActiveViewport } from "./core/active-viewport";
import { obsidianWritePorts } from "./obsidian/write-ports";

  readonly active = new ActiveViewport();
```

```typescript
    this.registerMarkdownCodeBlockProcessor(
      "3d",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const block = new ModelBlock(el, source, ctx.sourcePath, {
          ...hostDeps,
          app: this.app,
          active: this.active,
          writePorts: obsidianWritePorts(this.app),
          sectionInfo: () => {
            const info = ctx.getSectionInfo(el);
            return info ? { lineStart: info.lineStart, lineEnd: info.lineEnd } : null;
          },
        });
        this.track(block);
        ctx.addChild(block);
      },
    );
```

- [ ] **Step 5: Create the Obsidian implementation of the ports**

`src/obsidian/write-ports.ts`:

```typescript
// Die Obsidian-Seite der Schreib-Ports aus `block-writer.ts`. Bewusst winzig:
// alle Entscheidungen liegen im testbaren Schreiber, hier ist nur der Zugriff.
import { MarkdownView, TFile, type App } from "obsidian";
import type { EditorHandle, WritePorts } from "./block-writer";

export function obsidianWritePorts(app: App): WritePorts {
  return {
    editorFor(path: string): EditorHandle | null {
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file?.path === path) return view.editor;
      }
      return null;
    },
    vault: {
      async read(path: string): Promise<string> {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
        return app.vault.read(file);
      },
      async process(path: string, fn: (text: string) => string): Promise<void> {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
        await app.vault.process(file, fn);
      },
    },
  };
}
```

- [ ] **Step 6: Run tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS — bestehende `block-child`-Tests brauchen die neuen Deps; ein kleiner Fake genügt (`active: new ActiveViewport()`, `sectionInfo: () => ({ lineStart: 0, lineEnd: 2 })`, Fake-`writePorts`)

- [ ] **Step 7: Commit**

```bash
git add src/obsidian/block-child.ts src/obsidian/write-ports.ts src/main.ts tests/obsidian/block-child.test.ts
git commit -m "feat(obsidian): ModelBlock ist ViewportController, schreibt view: in den Block"
```

---

### Task 10: Sidebar-View

**Files:**
- Create: `src/obsidian/control-panel.ts`
- Modify: `tests/__mocks__/obsidian.ts` (`ItemView`, `setIcon`, `ButtonComponent`-freie Minimalstubs)
- Modify: `src/main.ts` (View registrieren, Ribbon-Befehl)
- Test: `tests/obsidian/control-panel.test.ts`

**Interfaces:**
- Consumes: `ActiveViewport`, `ViewportController` (Task 6); `NAMED_VIEWS`, `ViewSpec` (Task 1).
- Produces: `VIEW_TYPE_3D_CONTROLS = "three-d-controls"`, `class ControlPanelView extends ItemView`, sowie die pure Hilfe `panelModel(controller: ViewportController | null): PanelModel` mit `PanelModel { empty: boolean; label: string; canSave: boolean; saveDisabledReason: string | null }`.

- [ ] **Step 1: Write the failing test**

`tests/obsidian/control-panel.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { panelModel } from "../../src/obsidian/control-panel";
import type { ViewportController } from "../../src/core/active-viewport";

function controller(overrides: Partial<ViewportController> = {}): ViewportController {
  return {
    getView: () => null,
    applyView: vi.fn(),
    canSave: () => true,
    save: vi.fn(async () => {}),
    label: () => "eg.glb",
    ...overrides,
  };
}

describe("panelModel", () => {
  it("is empty without a controller", () => {
    const model = panelModel(null);
    expect(model.empty).toBe(true);
    expect(model.label).toBe("Click a 3D model to control it here.");
  });

  it("shows the model label when one is active", () => {
    const model = panelModel(controller());
    expect(model.empty).toBe(false);
    expect(model.label).toBe("eg.glb");
    expect(model.canSave).toBe(true);
    expect(model.saveDisabledReason).toBeNull();
  });

  it("explains why saving is impossible", () => {
    const model = panelModel(controller({ canSave: () => false }));
    expect(model.canSave).toBe(false);
    expect(model.saveDisabledReason).toBe("The view can only be saved in a `3d` code block");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/control-panel.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/obsidian/control-panel"`

- [ ] **Step 3: Extend the Obsidian mock**

An `tests/__mocks__/obsidian.ts` anhängen:

```typescript
export class ItemView {
  containerEl: any = makeFakeEl();
  contentEl: any = makeFakeEl();
  constructor(public leaf: any) {}
  register(): void {}
  registerEvent(): void {}
  onload(): void {}
  onunload(): void {}
}

export function setIcon(el: any, name: string): void {
  el.dataset = el.dataset ?? {};
  el.dataset.icon = name;
}
```

- [ ] **Step 4: Write `control-panel.ts`**

```typescript
// Bedienung des aktiven Viewports in der rechten Leiste.
//
// Die Ansichts-Entscheidungen stecken in `panelModel` (pur, testbar); diese Klasse
// zeichnet nur — UI-STANDARD §6. DOM ausschliesslich ueber createEl/createDiv.
import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import {
  NO_BLOCK_REASON,
  type ActiveViewport,
  type ViewportController,
} from "../core/active-viewport";
import { NAMED_VIEWS, type ViewSpec } from "../core/view-spec";

export const VIEW_TYPE_3D_CONTROLS = "three-d-controls";

export interface PanelModel {
  empty: boolean;
  label: string;
  canSave: boolean;
  saveDisabledReason: string | null;
}

export function panelModel(controller: ViewportController | null): PanelModel {
  if (controller === null) {
    return {
      empty: true,
      label: "Click a 3D model to control it here.",
      canSave: false,
      saveDisabledReason: null,
    };
  }

  const canSave = controller.canSave();
  return {
    empty: false,
    label: controller.label(),
    canSave,
    saveDisabledReason: canSave ? null : NO_BLOCK_REASON,
  };
}

export class ControlPanelView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly active: ActiveViewport,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_3D_CONTROLS;
  }

  getDisplayText(): string {
    return "3D view";
  }

  getIcon(): string {
    return "box";
  }

  onload(): void {
    this.register(this.active.subscribe(() => this.draw()));
    this.draw();
  }

  private draw(): void {
    const controller = this.active.get();
    const model = panelModel(controller);
    const root = this.contentEl;
    root.empty();
    root.addClass("tdcb-panel");

    if (model.empty || controller === null) {
      root.createDiv({ cls: "tdcb-empty", text: model.label });
      return;
    }

    root.createDiv({ cls: "tdcb-panel-label", text: model.label });

    const presets = root.createDiv({ cls: "tdcb-panel-presets" });
    for (const name of Object.keys(NAMED_VIEWS)) {
      const button = presets.createEl("button", { text: name });
      button.addEventListener("click", () => controller.applyView(NAMED_VIEWS[name]));
    }

    const actions = root.createDiv({ cls: "tdcb-panel-actions" });

    const save = actions.createEl("button", { cls: "mod-cta", text: "Save view" });
    save.disabled = !model.canSave;
    if (model.saveDisabledReason) save.title = model.saveDisabledReason;
    save.addEventListener("click", () => void this.saveCurrent(controller));

    const clear = actions.createEl("button", { text: "Clear view" });
    clear.disabled = !model.canSave;
    if (model.saveDisabledReason) clear.title = model.saveDisabledReason;
    clear.addEventListener("click", () => void controller.save(null));

    const fit = actions.createEl("button", { text: "Fit" });
    fit.addEventListener("click", () => controller.applyView(null));
    setIcon(fit.createSpan({ cls: "tdcb-icon" }), "maximize");
  }

  private async saveCurrent(controller: ViewportController): Promise<void> {
    const spec: ViewSpec | null = controller.getView();
    if (spec === null) return;
    await controller.save(spec);
  }
}
```

- [ ] **Step 5: Register the view in `main.ts`**

```typescript
import { ControlPanelView, VIEW_TYPE_3D_CONTROLS } from "./obsidian/control-panel";

    this.registerView(
      VIEW_TYPE_3D_CONTROLS,
      (leaf: WorkspaceLeaf) => new ControlPanelView(leaf, this.active),
    );

    this.addCommand({
      id: "open-controls",
      name: "Open 3D view controls",
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_CONTROLS);
        if (existing.length > 0) {
          await this.app.workspace.revealLeaf(existing[0]);
          return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        await leaf?.setViewState({ type: VIEW_TYPE_3D_CONTROLS, active: true });
      },
    });
```

- [ ] **Step 6: Run tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/obsidian/control-panel.ts src/main.ts tests/__mocks__/obsidian.ts tests/obsidian/control-panel.test.ts
git commit -m "feat(obsidian): Sidebar-View mit Presets, Save/Clear/Fit für den aktiven Viewport"
```

---

### Task 11: Hover-Toolbar im Viewport

**Files:**
- Create: `src/obsidian/viewport-toolbar.ts`
- Modify: `src/obsidian/block-child.ts` (Toolbar bauen, auf Placement reagieren)
- Modify: `styles.css`
- Test: `tests/obsidian/viewport-toolbar.test.ts`

**Interfaces:**
- Consumes: `resolvePanelTarget`, `PanelPlacement` (Task 5); `ViewportController` (Task 6).
- Produces: `buildToolbar(parent: HTMLElement, controller: ViewportController): HTMLElement`, `toolbarVisible(placement: PanelPlacement, panelVisible: boolean): boolean`.

- [ ] **Step 1: Teach the DOM fake to click**

`makeFakeEl()` registriert Handler heute nur als `vi.fn()` und kann sie nicht auslösen; außerdem fehlen `disabled`, `title` und `remove`. In `tests/__mocks__/obsidian.ts` ergänzen — `addEventListener` bleibt ein `vi.fn()` (mit Implementierung behält es `.mock.calls`, bestehende Tests bleiben grün):

```typescript
export function makeFakeEl(): any {
  const children: any[] = [];
  const attrs: Record<string, string> = {};
  const handlers: Record<string, ((event?: any) => void)[]> = {};
  const el: any = {
    children,
    className: "",
    textContent: "",
    style: {},
    dataset: {},
    disabled: false,
    title: "",
    // … alle bisherigen Felder unveraendert …
    addEventListener: vi.fn((type: string, fn: (event?: any) => void) => {
      (handlers[type] ??= []).push(fn);
    }),
    click: () => {
      for (const fn of handlers.click ?? []) fn({ stopPropagation: () => {} });
    },
    remove: () => {
      el.removed = true;
    },
  };
  return el;
}
```

- [ ] **Step 2: Write the failing test**

`tests/obsidian/viewport-toolbar.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { makeFakeEl } from "../__mocks__/obsidian";
import { buildToolbar, toolbarVisible } from "../../src/obsidian/viewport-toolbar";
import { NAMED_VIEWS } from "../../src/core/view-spec";
import type { ViewportController } from "../../src/core/active-viewport";

function controller(overrides: Partial<ViewportController> = {}): ViewportController {
  return {
    getView: () => NAMED_VIEWS.top,
    applyView: vi.fn(),
    canSave: () => true,
    save: vi.fn(async () => {}),
    label: () => "eg.glb",
    ...overrides,
  };
}

describe("toolbarVisible", () => {
  it("shows only when resolvePanelTarget picks the toolbar", () => {
    expect(toolbarVisible("auto", false)).toBe(true);
    expect(toolbarVisible("auto", true)).toBe(false);
    expect(toolbarVisible("toolbar", true)).toBe(true);
    expect(toolbarVisible("sidebar", false)).toBe(false);
  });
});

describe("buildToolbar", () => {
  it("gives every icon button an accessible label", () => {
    const parent = makeFakeEl();
    const bar = buildToolbar(parent, controller());
    for (const button of bar.children) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("saves the current view when the save button is clicked", () => {
    const c = controller();
    const bar = buildToolbar(makeFakeEl(), c);
    bar.children[0].click();
    expect(c.save).toHaveBeenCalledWith(NAMED_VIEWS.top);
  });

  it("fits the camera when the fit button is clicked", () => {
    const c = controller();
    const bar = buildToolbar(makeFakeEl(), c);
    bar.children[2].click();
    expect(c.applyView).toHaveBeenCalledWith(null);
  });

  it("disables saving when the block cannot be written", () => {
    const bar = buildToolbar(makeFakeEl(), controller({ canSave: () => false }));
    expect(bar.children[0].disabled).toBe(true);
    expect(bar.children[1].disabled).toBe(true);
    expect(bar.children[2].disabled).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/viewport-toolbar.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/obsidian/viewport-toolbar"`

- [ ] **Step 4: Write `viewport-toolbar.ts`**

```typescript
// Kleine Icon-Leiste oben rechts im Viewport — der Ersatz fuer die Sidebar,
// wenn sie geschlossen ist. Sichtbarkeit steuert CSS (hover/focus-within),
// die Entscheidung "gibt es sie ueberhaupt" trifft `resolvePanelTarget`.
import { setIcon } from "obsidian";
import type { ViewportController } from "../core/active-viewport";
import { resolvePanelTarget, type PanelPlacement } from "../core/panel-target";

export function toolbarVisible(placement: PanelPlacement, panelVisible: boolean): boolean {
  return resolvePanelTarget(placement, panelVisible) === "toolbar";
}

interface ToolbarButton {
  icon: string;
  label: string;
  needsBlock: boolean;
  run: (controller: ViewportController) => void;
}

const BUTTONS: ToolbarButton[] = [
  {
    icon: "pin",
    label: "Save view",
    needsBlock: true,
    run: (controller) => {
      const spec = controller.getView();
      if (spec !== null) void controller.save(spec);
    },
  },
  {
    icon: "pin-off",
    label: "Clear view",
    needsBlock: true,
    run: (controller) => void controller.save(null),
  },
  {
    icon: "maximize",
    label: "Fit camera to model",
    needsBlock: false,
    run: (controller) => controller.applyView(null),
  },
];

export function buildToolbar(parent: HTMLElement, controller: ViewportController): HTMLElement {
  const bar = parent.createDiv({ cls: "tdcb-toolbar" });
  const canSave = controller.canSave();

  for (const spec of BUTTONS) {
    const button = bar.createEl("button", { cls: "tdcb-toolbar-button" });
    setIcon(button, spec.icon);
    // Icon-only-Buttons brauchen ein zugaengliches Label (UI-STANDARD §2).
    button.setAttribute("aria-label", spec.label);
    button.title = spec.label;
    button.disabled = spec.needsBlock && !canSave;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      spec.run(controller);
    });
  }

  return bar;
}
```

- [ ] **Step 5: Mount it from `block-child.ts`**

In `onload()`, nachdem `this.parts` und `this.host` stehen:

```typescript
    this.syncToolbar();
```

Neue Methode plus Aufruf bei Settings-/Layout-Änderungen (der Aufruf von außen kommt in Task 12 über `main.ts`):

```typescript
  /** Leiste an- oder abhaengen, je nach Einstellung und Sichtbarkeit der Sidebar. */
  syncToolbar(): void {
    if (!this.parts || this.unloaded) return;

    this.toolbar?.remove();
    this.toolbar = null;

    const { panelPlacement } = this.deps.settings();
    if (!toolbarVisible(panelPlacement, this.deps.panelVisible())) return;

    this.toolbar = buildToolbar(this.parts.root, this);
  }
```

Feld: `private toolbar: HTMLElement | null = null;` · `BlockDeps` erhält zusätzlich `panelVisible: () => boolean`.

Damit `BlockDeps` erfüllt bleibt, liefert `main.ts` die neue Dep sofort mit; das Nachziehen bei Layout-Wechseln kommt in Task 13:

```typescript
  panelVisible(): boolean {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_CONTROLS).length > 0;
  }
```

```typescript
          sectionInfo: () => { /* … wie in Task 9 … */ },
          panelVisible: () => this.panelVisible(),
```

- [ ] **Step 6: Add the styles**

An `styles.css` anhängen — nur Theme-Variablen, kein `!important`:

```css
.tdcb-block {
  position: relative;
}

.tdcb-block.tdcb-active .tdcb-stage {
  box-shadow: 0 0 0 2px var(--interactive-accent);
}

.tdcb-toolbar {
  position: absolute;
  top: var(--size-4-2);
  right: var(--size-4-2);
  display: flex;
  gap: var(--size-4-1);
  padding: var(--size-4-1);
  border-radius: var(--radius-s);
  background-color: var(--background-secondary);
  opacity: 0;
  transition: opacity 120ms ease-in-out;
}

.tdcb-block:hover .tdcb-toolbar,
.tdcb-toolbar:focus-within {
  opacity: 1;
}

/* Ohne Hover (Touch) bliebe die Leiste sonst unerreichbar. */
@media (hover: none) {
  .tdcb-toolbar {
    opacity: 1;
  }
}

.tdcb-toolbar-button {
  display: flex;
  align-items: center;
  padding: var(--size-4-1);
}

.tdcb-panel-presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
  margin-bottom: var(--size-4-3);
}

.tdcb-panel-actions {
  display: flex;
  gap: var(--size-4-2);
}

.tdcb-panel-label {
  margin-bottom: var(--size-4-2);
  color: var(--text-muted);
}
```

- [ ] **Step 7: Run tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/obsidian/viewport-toolbar.ts src/obsidian/block-child.ts src/main.ts styles.css tests/obsidian/viewport-toolbar.test.ts tests/__mocks__/obsidian.ts
git commit -m "feat(obsidian): Hover-Toolbar im Viewport als Sidebar-Ersatz"
```

---

### Task 12: Embed und FileView als Controller ohne Speichern

**Files:**
- Create: `src/obsidian/read-only-controller.ts`
- Modify: `src/obsidian/embed.ts`
- Modify: `src/obsidian/file-view.ts`
- Test: `tests/obsidian/read-only-controller.test.ts`, `tests/obsidian/embed.test.ts`, `tests/obsidian/file-view.test.ts`

**Interfaces:**
- Consumes: `ViewportController`, `ActiveViewport`, `NO_BLOCK_REASON` (Task 6); `ViewerHost.currentView/applyView` (Task 8).
- Produces: `readOnlyController(host: () => ViewerHost | null, label: () => string): ViewportController` — eine Fabrik, die Embed und FileView **teilen**, statt fünf identische Methoden zweimal zu schreiben. Beide Klassen halten das Ergebnis als Feld `controller` und melden es an die Registry.

**Warum eigene Task:** Ohne sie wäre die Sidebar bei einem `![[haus.glb]]`-Embed oder in der FileView schlicht leer — Spec §2.5 verlangt aber ausdrücklich, dass „Fit" dort funktioniert und nur das Speichern mit Begründung gesperrt ist. Es ist die kleine, ehrliche Auflösung der Asymmetrie der vier Wege.

- [ ] **Step 1: Write the failing test for the shared factory**

`tests/obsidian/read-only-controller.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { readOnlyController } from "../../src/obsidian/read-only-controller";
import { NAMED_VIEWS } from "../../src/core/view-spec";

function fakeHost() {
  return { currentView: vi.fn(() => NAMED_VIEWS.top), applyView: vi.fn() };
}

describe("readOnlyController", () => {
  it("never allows saving — there is no code block behind it", () => {
    expect(readOnlyController(() => fakeHost() as any, () => "a.glb").canSave()).toBe(false);
  });

  it("reads the current view through the host", () => {
    const host = fakeHost();
    expect(readOnlyController(() => host as any, () => "a.glb").getView()).toEqual(NAMED_VIEWS.top);
  });

  it("applies a view through the host, so Fit works", () => {
    const host = fakeHost();
    readOnlyController(() => host as any, () => "a.glb").applyView(null);
    expect(host.applyView).toHaveBeenCalledWith(null);
  });

  it("survives a missing host", () => {
    const controller = readOnlyController(() => null, () => "a.glb");
    expect(controller.getView()).toBeNull();
    expect(() => controller.applyView(null)).not.toThrow();
  });

  it("reports the label it was given", () => {
    expect(readOnlyController(() => null, () => "haus.glb").label()).toBe("haus.glb");
  });
});
```

An `tests/obsidian/file-view.test.ts` anhängen (analog in `embed.test.ts` mit dem dortigen Aufbau) — hier wird nur noch die *Verdrahtung* geprüft, nicht die Logik:

```typescript
it("registers itself as the active viewport when the user interacts", async () => {
  const { view, created, active } = await makeLoadedFileView();
  created[0].opts.onInteract();
  expect(active.get()).toBe(view.controller);
  expect(active.get()?.canSave()).toBe(false);
});

it("clears itself from the registry on unload", async () => {
  const { view, created, active } = await makeLoadedFileView();
  created[0].opts.onInteract();
  view.onunload();
  expect(active.get()).toBeNull();
});
```

`makeLoadedFileView` folgt dem Muster von `loadedBlock` aus Task 9: vorhandene Test-Hilfen der Datei plus `active: new ActiveViewport()` in den Deps.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/obsidian/read-only-controller.test.ts tests/obsidian/file-view.test.ts tests/obsidian/embed.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/obsidian/read-only-controller"`

- [ ] **Step 3: Write the shared factory**

`src/obsidian/read-only-controller.ts`:

```typescript
// Controller fuer die Wege ohne Codeblock (Embed, FileView): steuerbar, aber
// nicht speicherbar. Bewusst eine geteilte Fabrik statt zweier gleicher
// Methodensaetze — der Unterschied zwischen den beiden Wegen ist nur, woher
// Host und Label kommen.
import { Notice } from "obsidian";
import { NO_BLOCK_REASON, type ViewportController } from "../core/active-viewport";
import type { ViewSpec } from "../core/view-spec";

interface HostLike {
  currentView(): ViewSpec | null;
  applyView(spec: ViewSpec | null): void;
}

export function readOnlyController(
  host: () => HostLike | null,
  label: () => string,
): ViewportController {
  return {
    label,
    getView: () => host()?.currentView() ?? null,
    applyView: (spec) => host()?.applyView(spec),
    canSave: () => false,
    async save() {
      new Notice(NO_BLOCK_REASON);
    },
  };
}
```

- [ ] **Step 4: Wire both classes to it**

In `src/obsidian/file-view.ts` und `src/obsidian/embed.ts` je ein Feld anlegen — mehr nicht:

```typescript
  readonly controller = readOnlyController(
    () => this.host,
    () => this.file?.path ?? "3D model",
  );
```

Beide Klassen bekommen `active: ActiveViewport` in ihre Deps, setzen im `onInteract`-Durchgriff (wie `ModelBlock` in Task 9) `active.set(this.controller)` und rufen beim Entladen `active.clearIf(this.controller)`.

- [ ] **Step 5: Wire the dep in `main.ts`**

`hostDeps` um `active: this.active` erweitern, damit Embed-Registrierung und `registerView` sie mitbekommen.

- [ ] **Step 6: Run tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/obsidian/read-only-controller.ts src/obsidian/embed.ts src/obsidian/file-view.ts src/main.ts tests/obsidian/read-only-controller.test.ts tests/obsidian/embed.test.ts tests/obsidian/file-view.test.ts
git commit -m "feat(obsidian): geteilter Nur-Lese-Controller für Embed und FileView"
```

---

### Task 13: Befehle, Setting, Dokumentation und GUI-Smoke

**Files:**
- Modify: `src/main.ts` (drei Befehle, `panelVisible`, `layout-change`-Abo)
- Modify: `src/obsidian/settings.ts` (Dropdown)
- Modify: `README.md`, `CHANGELOG.md`, `docs/SMOKE.md`
- Modify: `/Users/Shared/code/obsidian-plugins/REGISTRY.md`

**Interfaces:**
- Consumes: alles Vorherige.
- Produces: keine neuen Signaturen.

- [ ] **Step 1: Add the commands in `main.ts`**

```typescript
    const withActive = (run: (controller: ViewportController) => void) => () => {
      const controller = this.active.get();
      if (!controller) {
        new Notice("No active 3D model");
        return;
      }
      run(controller);
    };

    this.addCommand({
      id: "save-view",
      name: "Save current view to block",
      callback: withActive((controller) => {
        const spec = controller.getView();
        if (spec !== null) void controller.save(spec);
      }),
    });

    this.addCommand({
      id: "clear-view",
      name: "Clear saved view",
      callback: withActive((controller) => void controller.save(null)),
    });

    this.addCommand({
      id: "fit-view",
      name: "Fit camera to model",
      callback: withActive((controller) => controller.applyView(null)),
    });
```

- [ ] **Step 2: Redraw the toolbars when the sidebar opens or closes**

`panelVisible()` und die Dep existieren seit Task 11. Jetzt fehlt nur noch das Nachziehen bei Layout-Wechseln — sonst bliebe die Hover-Leiste stehen, nachdem die Sidebar geöffnet wurde:

```typescript
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        for (const view of this.views) view.syncToolbar?.();
      }),
    );
```

`TrackedView` in `src/obsidian/tracked-view.ts` um das optionale `syncToolbar?(): void` erweitern.

- [ ] **Step 3: Add the setting**

In `src/obsidian/settings.ts`:

```typescript
    new Setting(containerEl)
      .setName("Controls placement")
      .setDesc("Where the buttons for saving a view appear.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Sidebar when open, toolbar otherwise")
          .addOption("sidebar", "Sidebar only")
          .addOption("toolbar", "Toolbar only")
          .setValue(this.plugin.settings.panelPlacement)
          .onChange(async (value) => {
            await this.persist({ panelPlacement: value });
          }),
      );
```

- [ ] **Step 4: Run the full check**

Run: `npm test && npm run typecheck && npm run check:pure && npm run lint && npm run build`
Expected: alles grün, `main.js` wird erzeugt

- [ ] **Step 5: Document it**

`README.md` — beim `3d`-Block den neuen Key dokumentieren:

````markdown
| Key | Meaning |
|---|---|
| `file:` | Path to the model (`.glb`, `.gltf`, `.stl`) |
| `height:` | Height of the viewer in pixels |
| `title:` | Caption above the viewer |
| `view:` | Saved camera angle — a name (`front`, `back`, `left`, `right`, `top`, `bottom`, `iso`) or three numbers `azimuth,elevation,distance` |

Turn the model to the angle you want, then press **Save view** in the sidebar (or the
pin button that appears when you hover the model). The angle is stored in the code
block, so it travels with your note and shows up in git diffs. The model file is never
modified.
````

`CHANGELOG.md` — Eintrag unter `## [Unreleased]`:

```markdown
### Added
- Saved camera angles: turn a model, press **Save view**, and the angle is written into
  the code block as `view:` (`iso`, `top`, or `azimuth,elevation,distance`).
- Sidebar view with view presets and Save/Clear/Fit, plus a hover toolbar on the model
  when the sidebar is closed. New setting: **Controls placement**.
```

- [ ] **Step 6: Extend the GUI smoke sheet**

An `docs/SMOKE.md` die zehn Punkte aus §8 der Spec anhängen (Ansicht speichern und wiederfinden, Namens-Schreibweise, Undo im Editor, Lesemodus, fünf Etagen mit Aktiv-Rahmen, Sidebar auf/zu, Embed/FileView deaktiviert, `view: quatsch`, Fremdänderung während offener Notiz).

- [ ] **Step 7: Add the REGISTRY entry**

In `/Users/Shared/code/obsidian-plugins/REGISTRY.md` eine Zeile ergänzen — `hudPlacement` steht damit bei n=2:

```markdown
| **Bedienung Sidebar-oder-Overlay entscheiden**: pure Funktion `(placement, paneVisible) → 'panel'|'toolbar'|'none'`; Nutzer-Einstellung `sidebar\|toolbar\|auto`, Fallback aufs Overlay wenn das Pane zu ist | `vim-dojo/src/hudPlacement.ts` (`resolveHudTarget`) · `3d-codeblocks/src/core/panel-target.ts` (`resolvePanelTarget`) | n=2 → **Kit-Kandidat** |
```

- [ ] **Step 8: Run the GUI smoke in the outpost vault**

Run: `OBSIDIAN_PLUGIN_DIR=<pfad zum outpost-Vault>/.obsidian/plugins/three-d-codeblocks npm run deploy`
Dann Obsidian neu laden und die Punkte aus `docs/SMOKE.md` durchgehen. Der wichtigste: **Punkt 10** — Notiz in einem zweiten Fenster ändern, dann speichern; es muss die Meldung „Note changed — view not saved" erscheinen und die Notiz unbeschädigt bleiben.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts src/obsidian/settings.ts src/obsidian/tracked-view.ts README.md CHANGELOG.md docs/SMOKE.md
git commit -m "feat: Befehle, Placement-Setting und Doku für gespeicherte Ansichten"
git -C /Users/Shared/code/obsidian-plugins add REGISTRY.md
git -C /Users/Shared/code/obsidian-plugins commit -m "docs(registry): Sidebar-oder-Overlay-Entscheidung bei n=2 (Kit-Kandidat)"
```

---

## Nach dem Plan

Wenn alle Tasks grün sind: `superpowers:finishing-a-development-branch` für den Merge nach `main`. Der Release (0.2.0) ist bewusst **kein** Teil dieses Plans — v0.1.2 liegt im Store-Review, und ein Release während der Prüfung wäre eine eigene Entscheidung.
