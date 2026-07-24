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
