// Prompt-Fingerabdruck (Test-/Lab-Seite; src bleibt frei von Node-APIs).
// Regel: promptSha(task) = die ersten 16 Hex-Zeichen von SHA-256 über System-Prompt + Nutzer-Nachricht,
// beides direkt aneinandergehängt (ohne Trenner), die Nutzer-Nachricht aus der echten build*Messages-Funktion
// für eine FESTE Eingabe. Ändert sich ein Wort des Prompts oder der Vorlage, ändert sich der Wert, und jede
// Messtabellenzeile mit dem alten Wert ist nicht mehr gedeckt (quality.test.ts).
import { createHash } from "node:crypto";
import { buildCreateMessages, buildRefineMessages } from "../../src/core/shapes/protocol";
import { REFINE_BASE } from "./shapes-cases";

export const FIXED_CREATE_INPUT = "FIXED-PROMPT";
export const FIXED_REFINE_INSTRUCTION = "FIXED-INSTRUCTION";

export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** Die Nutzer-Nachricht der Vorlage für die feste Eingabe. */
export function userTemplateOutput(task: "create" | "refine"): string {
  const m = task === "create" ? buildCreateMessages(FIXED_CREATE_INPUT) : buildRefineMessages(REFINE_BASE, FIXED_REFINE_INSTRUCTION);
  return m[1].content;
}

export function promptSha(task: "create" | "refine"): string {
  const m = task === "create" ? buildCreateMessages(FIXED_CREATE_INPUT) : buildRefineMessages(REFINE_BASE, FIXED_REFINE_INSTRUCTION);
  return sha256(m[0].content + m[1].content).slice(0, 16);
}
