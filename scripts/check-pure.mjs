// `src/core/` muss frei von obsidian-, three- UND @codemirror-Importen bleiben — das ist die
// Zusicherung, dass die Rechenlogik ohne Obsidian und ohne WebGL testbar ist.
//
// Bewusst ein Script statt eines grep-Einzeilers in package.json: der Einzeiler
// hatte nur `from '…'` mit einfachen Anfuehrungszeichen erfasst und war damit
// gegen den eigenen Code (doppelte Anfuehrungszeichen) wirkungslos.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/core";
const FORBIDDEN = /(?:from|import)\s*\(?\s*["'](obsidian|three|@codemirror\/[^"']*)(\/[^"']*)?["']/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const offenders = walk(ROOT)
  .filter((file) => file.endsWith(".ts"))
  .filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")));

if (offenders.length > 0) {
  console.error("src/core darf weder obsidian, three noch @codemirror importieren:");
  for (const file of offenders) console.error(`  ${file}`);
  process.exit(1);
}

console.log(`check:pure: ${ROOT} ist frei von obsidian/three/@codemirror`);
