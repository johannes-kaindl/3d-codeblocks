// Die Übersetzungsfunktion des Plugins. Die Engine ist code-kit `i18n` (EN kanonisch, Fallback en → Schlüssel); die Wörterbücher werden hier beim Laden
// des Moduls registriert, damit jeder Aufrufer (auch ein Test ohne `onload`) Englisch bekommt. Die Sprache setzt `main.ts` einmal im `onload` (`setLang`).
import { defineStrings, getLang, pickLang, setLang, t, type Lang } from "../vendor/kit/i18n";
import { DE } from "./texts-de";
import { EN } from "./texts-en";

export const STRINGS: Record<Lang, Record<string, string>> = { en: EN, de: DE };
defineStrings(STRINGS);

export { getLang, pickLang, setLang, t, type Lang };
