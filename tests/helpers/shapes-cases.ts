// Die zehn Prompts aus Spike A (2026-10-01, wörtlich) mit ihren VORAB festgelegten Grenzen,
// A01 um die Lochprüfung verschärft. Geteilt von Golden-Test und Messlauf, damit beide
// dasselbe messen. Dazu acht Änderungswünsche auf einem festen Tisch für den Verfeinern-Lauf.
import type { ShapeDraft } from "../../src/core/shapes/types";

export const CREATE_CASES: { id: string; prompt: string; minParts: number; dims: [number, number][] }[] = [
  { id: "A01", prompt: "Ein Würfel mit Kantenlänge 1 m, durch dessen Mitte ein quadratisches Loch (0,4 m) in Z-Richtung geht.", minParts: 4, dims: [[0.75, 1.25], [0.75, 1.25], [0.75, 1.25]] },
  { id: "A02", prompt: "Ein Tisch: Platte 1,2 m × 0,7 m × 0,05 m, vier Beine, Gesamthöhe 0,75 m.", minParts: 5, dims: [[1.0, 1.4], [0.6, 0.9], [0.5, 0.9]] },
  { id: "A03", prompt: "Ein runder Turm: Zylinder Durchmesser 2 m, Höhe 6 m, mit vier kleinen Fenstern (dunkle Boxen) rund um den Turm.", minParts: 5, dims: [[1.6, 2.6], [5, 7], [1.6, 2.6]] },
  { id: "A04", prompt: "Eine Treppe mit 5 Stufen: jede Stufe 1 m breit, 0,2 m hoch, 0,3 m tief, jede höher und weiter hinten als die vorige.", minParts: 5, dims: [[0.8, 1.2], [0.8, 1.2], [1.2, 1.8]] },
  { id: "A05", prompt: "Ein Stuhl: Sitzfläche 0,45 m × 0,45 m auf Höhe 0,45 m, vier Beine, eine Rückenlehne bis 0,9 m Gesamthöhe.", minParts: 6, dims: [[0.35, 0.6], [0.8, 1.0], [0.35, 0.6]] },
  { id: "A06", prompt: "Ein Schneemann aus drei übereinander gestapelten Kugeln (Radius 0,5 m unten, 0,35 m Mitte, 0,25 m oben), dazu eine Nase (Kegel) und ein Hut.", minParts: 4, dims: [[0.8, 1.3], [1.6, 2.6], [0.8, 1.6]] },
  { id: "A07", prompt: "Ein Haus: Quader 4 m × 3 m × 4 m (Breite × Höhe × Tiefe), ein Dach oben drauf (Pyramide oder Prisma), eine Tür vorne.", minParts: 3, dims: [[3.5, 4.6], [3.5, 5.5], [3.5, 4.6]] },
  { id: "A08", prompt: "Eine Stehlampe: runder Fuß, dünne Stange, darüber ein kegelförmiger Schirm; Gesamthöhe 1,6 m.", minParts: 3, dims: [[0.2, 0.9], [1.3, 1.9], [0.2, 0.9]] },
  { id: "A09", prompt: "Ein Regal mit drei Fächern: Höhe 1,8 m, Breite 0,8 m, Tiefe 0,3 m; zwei Seitenwände und vier Böden.", minParts: 6, dims: [[0.7, 0.95], [1.6, 2.0], [0.2, 0.45]] },
  { id: "A10", prompt: "Eine Brücke: Fahrbahn 8 m lang und 2 m breit, getragen von zwei Pfeilern (Zylinder) im Abstand von 4 m.", minParts: 3, dims: [[7, 9], [0.5, 4], [1.6, 2.6]] },
];

export const REFINE_BASE = [
  "title: Tisch",
  "box Platte size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b",
  "box Bein-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3",
  "box Bein-2 size 0.05 0.7 0.05 at 0.55 0.35 -0.3",
  "box Bein-3 size 0.05 0.7 0.05 at -0.55 0.35 0.3",
  "box Bein-4 size 0.05 0.7 0.05 at 0.55 0.35 0.3",
].join("\n");

// Für R06: der Ausgangsstand als Teile (aus REFINE_BASE, von Hand gespiegelt, damit der Helfer
// keine Produktionslogik braucht).
const BASE: ShapeDraft[] = [
  { kind: "box", name: "Platte", size: [1.2, 0.05, 0.7], at: [0, 0.725, 0], rot: [0, 0, 0], color: "#8b5a2b" },
  { kind: "box", name: "Bein-1", size: [0.05, 0.7, 0.05], at: [-0.55, 0.35, -0.3], rot: [0, 0, 0], color: null },
  { kind: "box", name: "Bein-2", size: [0.05, 0.7, 0.05], at: [0.55, 0.35, -0.3], rot: [0, 0, 0], color: null },
  { kind: "box", name: "Bein-3", size: [0.05, 0.7, 0.05], at: [-0.55, 0.35, 0.3], rot: [0, 0, 0], color: null },
  { kind: "box", name: "Bein-4", size: [0.05, 0.7, 0.05], at: [0.55, 0.35, 0.3], rot: [0, 0, 0], color: null },
];

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const get = (parts: ShapeDraft[], name: string) => parts.find((p) => p.name === name);
const dark = (hex: string | null) => hex !== null && [1, 3, 5].every((i) => parseInt(hex.slice(i, i + 2), 16) < 0x40);

export const REFINE_CASES: { id: string; instruction: string; check: (parts: ShapeDraft[]) => boolean }[] = [
  { id: "R01", instruction: "Mache die Tischplatte 20 cm höher.", check: (p) => near(get(p, "Platte")?.at[1] ?? 0, 0.925, 0.03) },
  { id: "R02", instruction: "Färbe alle vier Beine schwarz.", check: (p) => ["Bein-1", "Bein-2", "Bein-3", "Bein-4"].every((n) => dark(get(p, n)?.color ?? null)) },
  { id: "R03", instruction: "Entferne Bein-4.", check: (p) => !get(p, "Bein-4") && p.length === 4 },
  { id: "R04", instruction: "Füge unter der Platte vorne mittig eine Schublade hinzu: 0,5 m breit, 0,1 m hoch, 0,5 m tief.", check: (p) => p.length === 6 && p.some((x) => x.kind === "box" && near(x.size[0], 0.5, 0.05) && near(x.size[1], 0.1, 0.02) && x.at[1] > 0.5 && x.at[1] < 0.72) },
  { id: "R05", instruction: "Mache die Platte doppelt so breit (in X-Richtung).", check: (p) => near(get(p, "Platte")?.size[0] ?? 0, 2.4, 0.12) },
  { id: "R06", instruction: "Verschiebe den ganzen Tisch 1 m nach rechts.", check: (p) => p.length === 5 && p.every((x) => near(x.at[0], (get(BASE, x.name)?.at[0] ?? 99) + 1, 0.05)) },
  { id: "R07", instruction: "Ersetze Bein-1 durch einen Zylinder mit Radius 0,03 m und Höhe 0,7 m an derselben Stelle.", check: (p) => get(p, "Bein-1")?.kind === "cylinder" && near(get(p, "Bein-1")?.at[0] ?? 0, -0.55, 0.05) },
  { id: "R08", instruction: "Füge unter jedes Bein eine kleine Kugel als Fuß hinzu, Radius 0,04 m.", check: (p) => p.filter((x) => x.kind === "sphere" && near(x.size[0], 0.04, 0.01) && x.at[1] < 0.08).length === 4 },
];
