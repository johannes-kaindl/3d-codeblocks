// Von Hand verfasste "Modellantworten" für die acht Verfeinern-Fälle: je Fall eine KORREKTE
// Änderungsliste und eine bewusst FALSCHE. Sie beweisen, dass jede Prüffunktion in REFINE_CASES
// stimmt und der Fall mit der Änderungssprache erfüllbar ist — kein Modell beteiligt.
import type { RawChange } from "../../src/core/shapes/protocol";

const legs = [
  ["Bein-1", -0.55, -0.3],
  ["Bein-2", 0.55, -0.3],
  ["Bein-3", -0.55, 0.3],
  ["Bein-4", 0.55, 0.3],
] as const;

export const REFINE_CORRECT: Record<string, RawChange[]> = {
  R01: [{ op: "change", name: "Platte", at: [0, 0.925, 0] }],
  R02: legs.map(([name]) => ({ op: "change", name, color: "#000000" })),
  R03: [{ op: "remove", name: "Bein-4" }],
  R04: [{ op: "add", part: { op: "add", name: "Schublade", shape: "box", position: [0, 0.62, 0.1], size: [0.5, 0.1, 0.5], color: "#6b4423" } }],
  R05: [{ op: "change", name: "Platte", size: [2.4, 0.05, 0.7] }],
  R06: [
    { op: "change", name: "Platte", at: [1, 0.725, 0] },
    ...legs.map(([name, x, z]): RawChange => ({ op: "change", name, at: [x + 1, 0.35, z] })),
  ],
  R07: [
    { op: "remove", name: "Bein-1" },
    { op: "add", part: { op: "add", name: "Bein-1", shape: "cylinder", position: [-0.55, 0.35, -0.3], size: [0.03, 0.7] } },
  ],
  R08: legs.map(([name, x, z], i): RawChange => ({ op: "add", part: { op: "add", name: `Fuss-${i + 1}`, shape: "sphere", position: [x, 0.04, z], size: [0.04] } })),
};

export const REFINE_WRONG: Record<string, RawChange[]> = {
  R01: [{ op: "change", name: "Platte", at: [0, 0.525, 0] }],
  R02: legs.slice(0, 3).map(([name]) => ({ op: "change", name, color: "#000000" })),
  R03: [{ op: "remove", name: "Bein-3" }],
  R04: [{ op: "add", part: { op: "add", name: "Schublade", shape: "box", position: [0, 0.62, 0.1], size: [0.3, 0.1, 0.5] } }],
  R05: [{ op: "change", name: "Platte", size: [0.6, 0.05, 0.7] }],
  R06: [{ op: "change", name: "Platte", at: [1, 0.725, 0] }],
  R07: [{ op: "change", name: "Bein-1", size: [0.08, 0.7, 0.08] }],
  R08: legs.slice(0, 3).map(([name, x, z], i): RawChange => ({ op: "add", part: { op: "add", name: `Fuss-${i + 1}`, shape: "sphere", position: [x, 0.04, z], size: [0.04] } })),
};

/** Die Liste als Modellantwort-Text im Protokollformat (für den Trockenlauf des Messlaufs). */
export function changesAsAnswerText(changes: readonly RawChange[]): string {
  const items = changes.map((c) => {
    if (c.op === "add") return c.part;
    if (c.op === "remove") return { op: "remove", name: c.name };
    return {
      op: "change",
      name: c.name,
      ...(c.at ? { position: c.at } : {}),
      ...(c.size ? { size: c.size } : {}),
      ...(c.rot ? { rotation_deg: c.rot } : {}),
      ...(c.color ? { color: c.color } : {}),
    };
  });
  return JSON.stringify({ changes: items });
}
