// Bundle-Groessenschranke. three.js ist gross und gewollt (Spec §2) — die Schranke
// faengt versehentliche Zusatz-Deps ab, nicht three selbst.
import { readFileSync, statSync } from "node:fs";

const LIMIT_KB = 1200;
const sizeKb = statSync("main.js").size / 1024;

if (sizeKb > LIMIT_KB) {
  console.error(`main.js ist ${sizeKb.toFixed(0)} KB — Schranke ${LIMIT_KB} KB.`);
  console.error("Neue Dependency dazugekommen? Sonst Schranke bewusst anheben.");
  process.exit(1);
}
console.log(`main.js: ${sizeKb.toFixed(0)} KB (Schranke ${LIMIT_KB} KB)`);

// CodeMirror gehoert Obsidian: das Bundle muss es per require holen und darf keine eigene Kopie tragen
// (zwei EditorView-Klassen kennen die Erweiterungen des jeweils anderen nicht).
const needle = 'require("@codemirror/view")';
const forbidden = "class EditorView";
const bundle = readFileSync("main.js", "utf8");
if (!bundle.includes(needle)) {
  console.error(`main.js enthaelt ${needle} nicht — CodeMirror wird nicht von Obsidian geholt (external vergessen?).`);
  process.exit(1);
}
if (bundle.includes(forbidden)) {
  console.error(`main.js enthaelt "${forbidden}" — eine eigene CodeMirror-Kopie ist im Bundle gelandet (external pruefen).`);
  process.exit(1);
}
console.log("main.js: CodeMirror extern (require vorhanden, keine eigene EditorView-Klasse)");
