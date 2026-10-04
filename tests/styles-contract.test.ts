// Layout-Vertraege der styles.css, die kein Browser-Smoke im Gate pruefen kann (jsdom hat kein Layout).
// Jede Regel hier ist eine Ursache, die am Code belegt ist; faellt sie weg, kommt der Fehler zurueck.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Alle Deklarationen aller Regeln, deren Selektorliste genau `selector` enthaelt. */
function declarations(selector: string): string {
  let out = "";
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) out += `${m[2]};`;
  }
  return out;
}
const has = (selector: string, decl: RegExp): boolean => decl.test(declarations(selector));

describe("file view geometry (model sat too low and was cut off)", () => {
  it("the canvas of a filling stage is positioned absolutely, so its pixel buffer never sizes the stage", () => {
    expect(has(".tdcb-block.tdcb-fill .tdcb-stage canvas", /position:\s*absolute/)).toBe(true);
    expect(has(".tdcb-block.tdcb-fill .tdcb-stage", /position:\s*relative/)).toBe(true);
  });
  it("the flex chain down to the stage may shrink (min-height: 0)", () => {
    expect(has(".tdcb-block.tdcb-fill .tdcb-viewport", /min-height:\s*0/)).toBe(true);
    expect(has(".tdcb-block.tdcb-fill .tdcb-stage", /min-height:\s*0/)).toBe(true);
  });
});

describe("text and split view have a visible end", () => {
  it("the editor is a bordered field with its own background", () => {
    expect(has(".tdcb-shapes-text .cm-editor", /border:\s*var\(--border-width\)/)).toBe(true);
    expect(has(".tdcb-shapes-text .cm-editor", /background:\s*var\(--background-primary\)/)).toBe(true);
  });
  it("the whole body ends in a line and clips its children", () => {
    expect(has(".tdcb-shapes-body", /border-bottom:\s*var\(--divider-width\)/)).toBe(true);
    expect(has(".tdcb-shapes-body", /overflow:\s*hidden/)).toBe(true);
  });
  it("split: a divider line between editor and model, both halves bounded by the body height", () => {
    expect(has(".tdcb-shapes-body.is-split .tdcb-shapes-text", /border-right:\s*var\(--divider-width\)\s+solid\s+var\(--divider-color\)/)).toBe(true);
    expect(has(".tdcb-shapes-body.is-split .tdcb-shapes-text", /max-height:\s*100%/)).toBe(true);
    expect(has(".tdcb-shapes-body.is-split .tdcb-shapes-model", /max-height:\s*100%/)).toBe(true);
  });
  it("the line-count bounds (b) exist as variables but are not wired yet", () => {
    expect(declarations(".tdcb-shapes-text")).toMatch(/--tdcb-editor-min-lines:\s*6/);
    expect(css).not.toMatch(/var\(--tdcb-editor-(min|max)-lines\)/);
  });
});
