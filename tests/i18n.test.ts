import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import ThreeDCodeblocksPlugin from "../src/main";
import { qualityLine } from "../src/core/shapes/quality";
import { capList, convertShapesText } from "../src/core/shapes/convert";
import { applyChanges } from "../src/core/shapes/changes";
import { parseShapes } from "../src/core/shapes/parse";
import { DE } from "../src/i18n/texts-de";
import { EN } from "../src/i18n/texts-en";
import { ACCEPT_STRINGS, helpTexts, modelBarStrings, PANEL_TEXTS } from "../src/i18n/strings";
import { getLang, pickLang, setLang, t } from "../src/i18n/t";
import { makeFakeApp, setMockLanguage } from "./__mocks__/obsidian";

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();

afterEach(() => {
  setLang("en");
  setMockLanguage("en");
});

describe("Wörterbücher EN/DE", () => {
  it("haben dieselben Schlüssel", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort());
  });

  it("tragen in beiden Sprachen dieselben Platzhalter ({0}, {1} …)", () => {
    const broken = Object.keys(EN).filter((key) => placeholders(EN[key]).join() !== placeholders(DE[key] ?? "").join());
    expect(broken).toEqual([]);
  });

  it("haben keinen leeren Text", () => {
    expect(Object.entries(EN).filter(([, v]) => v.trim() === "").map(([k]) => k)).toEqual([]);
    expect(Object.entries(DE).filter(([, v]) => v.trim() === "").map(([k]) => k)).toEqual([]);
  });

  it("lassen nur diese Texte unübersetzt (gleich in beiden Sprachen, aus gutem Grund)", () => {
    // „Prompt“ und „Text“ heißen auch auf Deutsch so (Obsidian-Oberfläche, UI-STANDARD).
    expect(Object.keys(EN).filter((k) => EN[k] === DE[k]).sort()).toEqual(["panel.modelLabel", "panel.tabPrompt", "sv.text"]);
  });

  it("jeder im Quelltext benutzte Schlüssel steht im Wörterbuch", () => {
    const used = new Set<string>();
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "vendor") walk(path);
        } else if (name.endsWith(".ts") && !name.startsWith("texts-")) {
          for (const m of readFileSync(path, "utf8").matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(m[1]);
        }
      }
    };
    walk(join(__dirname, "..", "src"));
    expect(used.size).toBeGreaterThan(150); // Gegenprobe: der Suchlauf findet etwas (CORE-TEST-16)
    expect([...used].filter((k) => !(k in EN))).toEqual([]);
  });

  it("jeder Schlüssel der Familien, die per Vorlage gebildet werden, ist da", () => {
    const families = [
      ...["missing", "external-blocked", "outside-vault", "scheme"].map((r) => `core.res.${r}`),
      ...["create", "refine"].flatMap((tk) => [`quality.${tk}.measured`, `quality.${tk}.plural`]),
      ...["model", "text", "split"].map((m) => `sv.${m}`),
      ...["list", "quote", "indent", "inline", "table", "continuation", "markdown-embed"].map((r) => `conv.reason.${r}`),
      ...["after-block-at-selection", "after-block-at-cursor", "after-frontmatter", "after-selection", "at-cursor"].map((w) => `accept.where.${w}`),
      ...["reading", "note-changed", "no-note"].map((w) => `accept.noRef.${w}`),
    ];
    expect(families.filter((k) => !(k in EN) || !(k in DE))).toEqual([]);
  });
});

describe("Sprachwahl", () => {
  it("Obsidian-Sprache de* → Deutsch, alles andere und nichts → Englisch", () => {
    expect(pickLang("de")).toBe("de");
    expect(pickLang("de-AT")).toBe("de");
    expect(pickLang("en")).toBe("en");
    expect(pickLang("fr")).toBe("en");
    expect(pickLang(undefined)).toBe("en");
  });

  it("ohne gesetzte Sprache ist es Englisch (Tests, erster Aufruf)", () => {
    expect(getLang()).toBe("en");
    expect(PANEL_TEXTS.title).toBe("Model by prompt");
  });

  it("der Fallback für einen fehlenden Schlüssel ist der Schlüssel selbst", () => {
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});

describe("Deutsch an den Stellen, die der Nutzer sieht", () => {
  it("Panel- und Übernehmen-Texte folgen der Sprache bei jedem Zugriff", () => {
    expect(PANEL_TEXTS.title).toBe("Model by prompt");
    setLang("de");
    expect(PANEL_TEXTS.title).toBe("Modell per Prompt");
    expect(PANEL_TEXTS.accept).toBe("Übernehmen");
    expect(PANEL_TEXTS.roundChanges(3)).toBe("3 Änderung(en)");
    expect(ACCEPT_STRINGS.appliedTo("Tisch")).toBe("Übernommen in Tisch.");
    expect(ACCEPT_STRINGS.appliedAsBlock("after-frontmatter")).toBe("In der offenen Notiz als Codeblock übernommen, hinter der Frontmatter.");
    expect(ACCEPT_STRINGS.savedFileNoReference("a.shapes", "reading")).toContain("Leseansicht");
    expect(ACCEPT_STRINGS.unclosedFence(true)).toContain("nie geschlossen");
  });

  it("die Kit-Bündel (Hilfe-Zeile, Modellzeile) wechseln mit", () => {
    const en = { help: helpTexts(), bar: modelBarStrings().refresh };
    setLang("de");
    expect(helpTexts()).not.toEqual(en.help);
    expect(modelBarStrings().refresh).not.toBe(en.bar);
  });

  it("Meldungen des Kerns: Parser, Änderungsliste, Messzeile, Zeilenpräfix", () => {
    setLang("de");
    const parsed = parseShapes("box A size 1 bogus\nbox A size 1");
    expect(parsed.warnings.map((w) => w.message)).toEqual(["Unbekanntes Wort `bogus` ignoriert"]);
    expect(parsed.errors.map((e) => e.message)).toEqual(["Doppelter Name `A`"]);
    const converted = convertShapesText("box A size 1 bogus\nbox A size 1");
    expect(converted.ok && converted.notes).toEqual(["Zeile 1: Unbekanntes Wort `bogus` ignoriert", "Zeile 2: Doppelter Name `A`"]);
    expect(capList(["a", "b", "c"], 1)).toEqual(["a", "… und 2 weitere"]);
    expect(qualityLine("unbekannt/modell", "create").text).toContain("nicht gemessen");
  });

  it("eine Änderung auf eine Zeile mit unbekanntem Wort wird auch auf Deutsch erkannt (nicht am Text)", () => {
    setLang("de");
    const r = applyChanges("box A size 1 bogus", [{ op: "change", name: "A", size: [2] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toContain("unbekannte Wörter");
    setLang("en");
    const e = applyChanges("box A size 1 bogus", [{ op: "change", name: "A", size: [2] }]);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.problems.join(" ")).toContain("unrecognised words");
  });
});

describe("onload folgt der Oberflächensprache von Obsidian", () => {
  async function commandNames(language: string): Promise<string[]> {
    setMockLanguage(language);
    const app = makeFakeApp();
    const plugin = new ThreeDCodeblocksPlugin(app, {} as never);
    const names: string[] = [];
    plugin.registerView = vi.fn();
    plugin.registerExtensions = vi.fn();
    plugin.addCommand = vi.fn((c: { name: string }) => { names.push(c.name); return c as never; });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await plugin.onload();
    return names;
  }

  it("Deutsch: Befehle deutsch, Sprache de", async () => {
    const names = await commandNames("de");
    expect(getLang()).toBe("de");
    expect(names).toContain("Prompt-Panel öffnen");
    expect(names).toContain("Kamera auf das Modell einpassen");
    expect(names).not.toContain("Open prompt panel");
  });

  it("Englisch: Befehle englisch, Sprache en", async () => {
    const names = await commandNames("en");
    expect(getLang()).toBe("en");
    expect(names).toContain("Open prompt panel");
  });
});
