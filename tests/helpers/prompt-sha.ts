// Prompt-Fingerabdruck (Test-/Lab-Seite; src bleibt frei von Node-APIs).
// Regel: promptSha(task) = Kit-`promptFingerprint` (code-kit measured-quality): die ersten 16 Hex-Zeichen von
// SHA-256 über System-Prompt + NUL + Nutzer-Nachricht, die Nutzer-Nachricht aus der echten build*Messages-Funktion
// für eine FESTE Eingabe. Bis Welle 33 ohne Trenner aneinandergehängt; der NUL-Trenner trennt "ab"+"c" von "a"+"bc". Ändert sich ein Wort des Prompts oder der Vorlage, ändert sich der Wert, und jede
// Messtabellenzeile mit dem alten Wert ist nicht mehr gedeckt (quality.test.ts).
import { createHash } from "node:crypto";
import { buildCreateMessages, buildRefineMessages } from "../../src/core/shapes/protocol";
import { promptFingerprint } from "../../src/vendor/kit/measured-quality";
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
  return promptFingerprint(m[0].content, m[1].content);
}
