import { describe, expect, it } from "vitest";
import { listFences } from "../../../src/core/shapes/fence";
import { findModelReferences, referenceBlock, shapesBlock } from "../../../src/core/shapes/references";

const TARGET = "Modelle/tisch.shapes";
// Auflösung wie ein Wikilink, hier vereinfacht: Basisname → voller Pfad.
const resolve = (link: string) => (link.replace(/^\[\[|\]\]$/g, "").trim().endsWith("tisch.shapes") ? TARGET : null);

describe("findModelReferences", () => {
  it("finds 3d blocks and embeds, and says whether an embed stands alone", () => {
    const refs = findModelReferences(
      [
        { path: "a.md", text: "# A\n```3d\nfile: tisch.shapes\ntitle: T\n```" },
        { path: "b.md", text: "![[tisch.shapes]]\nSiehe ![[tisch.shapes|200]] oben." },
        { path: "c.md", text: "```3d\nfile: anderes.glb\n```\n```shapes\n![[tisch.shapes]]\n```" },
      ],
      TARGET,
      resolve,
    );
    expect(refs).toEqual([
      { notePath: "a.md", kind: "block", from: 1, to: 4, text: "```3d\nfile: tisch.shapes\ntitle: T\n```" },
      { notePath: "b.md", kind: "embed", from: 0, to: 0, text: "![[tisch.shapes]]", alone: true },
      { notePath: "b.md", kind: "embed", from: 1, to: 1, text: "Siehe ![[tisch.shapes|200]] oben.", alone: false, aloneReason: "inline" },
    ]);
  });

  it("returns BOTH references when one note uses the file via 3d block and another via embed (review focus 1)", () => {
    const refs = findModelReferences(
      [
        { path: "n1.md", text: "```3d\nfile: tisch.shapes\n```" },
        { path: "n2.md", text: "![[tisch.shapes]]" },
      ],
      TARGET,
      resolve,
    );
    expect(refs.map((r) => [r.notePath, r.kind])).toEqual([
      ["n1.md", "block"],
      ["n2.md", "embed"],
    ]);
  });

  it("marks a mid-sentence embed as not alone (review focus 3)", () => {
    const [r] = findModelReferences([{ path: "a.md", text: "Siehe ![[tisch.shapes]] oben." }], TARGET, resolve);
    expect(r).toMatchObject({ kind: "embed", alone: false });
  });

  it("alone: whitespace, alias and size are fine; list items, blockquotes, deep indent and two embeds are not", () => {
    const alone = (line: string) => {
      const [r] = findModelReferences([{ path: "a.md", text: line }], TARGET, resolve);
      return r && r.kind === "embed" ? r.alone : "none";
    };
    expect(alone("  ![[tisch.shapes]]  ")).toBe(true);
    expect(alone("![[tisch.shapes|300]]")).toBe(true);
    expect(alone("![[tisch.shapes#Kopf]]")).toBe(true);
    expect(alone("- ![[tisch.shapes]]")).toBe(false);
    expect(alone("1. ![[tisch.shapes]]")).toBe(false);
    expect(alone("> ![[tisch.shapes]]")).toBe(false);
    expect(alone("    ![[tisch.shapes]]")).toBe(false);
    expect(alone("\t![[tisch.shapes]]")).toBe(false);
    expect(alone("![[tisch.shapes]] ![[tisch.shapes]]")).toBe(false);
  });

  it("ignores references inside a fenced block of another language, ~~~ and unclosed ones too", () => {
    const run = (text: string) => findModelReferences([{ path: "c.md", text }], TARGET, resolve);
    expect(run("```markdown\n![[tisch.shapes]]\n```")).toEqual([]);
    expect(run("~~~md\n![[tisch.shapes]]\n~~~")).toEqual([]);
    expect(run("```md\n![[tisch.shapes]]")).toEqual([]);
    expect(run("```md\nx\n```\n![[tisch.shapes]]")).toHaveLength(1);
  });

  it("handles heading/block anchors and folder paths, resolve decides", () => {
    const seen: string[] = [];
    const strict = (link: string) => {
      seen.push(link);
      return link === "Modelle/tisch.shapes" || link === "tisch.shapes" ? TARGET : "Anderswo/tisch.shapes";
    };
    const refs = findModelReferences(
      [{ path: "a.md", text: "![[tisch.shapes#Kopf]]\n![[Modelle/tisch.shapes]]\n![[tisch.shapes^abc]]\n![[Anderswo/tisch.shapes]]" }],
      TARGET,
      strict,
    );
    expect(refs.map((r) => r.from)).toEqual([0, 1, 2]);
    expect(seen).toEqual(["tisch.shapes", "Modelle/tisch.shapes", "tisch.shapes", "Anderswo/tisch.shapes"]);
  });

  it("same basename in two folders: only what resolve maps to the target counts", () => {
    const byNote = (link: string, source: string) => (link === "tisch.shapes" ? (source === "x/a.md" ? TARGET : "Archiv/tisch.shapes") : null);
    const refs = findModelReferences(
      [
        { path: "x/a.md", text: "![[tisch.shapes]]" },
        { path: "y/b.md", text: "![[tisch.shapes]]" },
      ],
      TARGET,
      byNote,
    );
    expect(refs.map((r) => r.notePath)).toEqual(["x/a.md"]);
  });

  it("compares the resolved path exactly (no case folding, no suffix match)", () => {
    const refs = (resolved: string) => findModelReferences([{ path: "a.md", text: "![[tisch.shapes]]" }], TARGET, () => resolved);
    expect(refs("modelle/tisch.shapes")).toEqual([]);
    expect(refs("Alt/Modelle/tisch.shapes")).toEqual([]);
    expect(refs("tisch.shapes")).toEqual([]);
    expect(refs(TARGET)).toHaveLength(1);
  });

  it("a 3d block counts only with a file: that resolves to the target", () => {
    const run = (text: string) => findModelReferences([{ path: "a.md", text }], TARGET, resolve);
    expect(run("```3d\nfile: ding.glb\n```")).toEqual([]);
    expect(run("```3d\ntitle: nur Titel\n```")).toEqual([]);
    expect(run("```3d\n```")).toEqual([]);
    expect(run("```gltf\nfile: tisch.shapes\n```")).toEqual([]);
  });

  it("a 3d block covers exactly its fence lines", () => {
    const [r] = findModelReferences([{ path: "a.md", text: "x\ny\n```3d\nfile: tisch.shapes\n```\nz" }], TARGET, resolve);
    expect(r).toEqual({ notePath: "a.md", kind: "block", from: 2, to: 4, text: "```3d\nfile: tisch.shapes\n```" });
  });

  it("copes with CRLF notes", () => {
    const refs = findModelReferences([{ path: "a.md", text: "```3d\r\nfile: tisch.shapes\r\n```\r\n![[tisch.shapes]]\r\n" }], TARGET, resolve);
    expect(refs).toEqual([
      { notePath: "a.md", kind: "block", from: 0, to: 2, text: "```3d\nfile: tisch.shapes\n```" },
      { notePath: "a.md", kind: "embed", from: 3, to: 3, text: "![[tisch.shapes]]", alone: true },
    ]);
  });
});

describe("replacement texts", () => {
  it("builds a 3d reference block", () => {
    expect(referenceBlock("Modelle/tisch.shapes")).toBe("```3d\nfile: Modelle/tisch.shapes\n```");
  });
  it("builds a shapes block with a safe fence and LF endings", () => {
    expect(shapesBlock("box A size 1\r\n")).toBe("```shapes\nbox A size 1\n```");
    expect(shapesBlock("# ```\nbox A size 1")).toBe("````shapes\n# ```\nbox A size 1\n````");
  });

  // Regel: CRLF → LF, ALLE abschließenden Zeilenumbrüche entfallen, sonst bleibt der Text unberührt.
  const normalise = (t: string) => t.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const roundTrip = (text: string) => {
    const fences = listFences(shapesBlock(text));
    expect(fences).toHaveLength(1);
    expect(fences[0].lang).toBe("shapes");
    expect(fences[0].body).toBe(normalise(text));
  };
  it("round-trips bodies with backticks, tildes, a trailing backtick run and trailing newlines (review focus 4)", () => {
    roundTrip("# ```\nbox A size 1");
    roundTrip("# ````` viel\nbox A size 1");
    roundTrip("~~~\nbox A size 1\n~~~");
    roundTrip("box A size 1\n```");
    roundTrip("box A size 1\n````");
    roundTrip("box A size 1\n\n\n");
    roundTrip("box A size 1\r\nbox B size 2\r\n");
    roundTrip("");
  });
  it("uses a fence longer than every backtick run in the body", () => {
    const out = shapesBlock("a ``` b\n`````\n");
    expect(out.startsWith("``````shapes\n")).toBe(true);
    expect(out.endsWith("\n``````")).toBe(true);
  });
});

describe("findModelReferences: fix round 1", () => {
  const run = (text: string, res: (l: string, s: string) => string | null = resolve) => findModelReferences([{ path: "a.md", text }], TARGET, res);
  const only = (text: string) => run(text)[0];

  it("finds a 3d block nested in a callout, flagged nested, covering exactly its lines", () => {
    const r = only("x\n> [!note]\n> ```3d\n> file: tisch.shapes\n> ```\ny");
    expect(r).toEqual({ notePath: "a.md", kind: "block", from: 2, to: 4, text: "> ```3d\n> file: tisch.shapes\n> ```", nested: true });
  });
  it("finds 3d blocks nested in list items (indent >= 4, nested list, marker line)", () => {
    expect(only("1. x\n    ```3d\n    file: tisch.shapes\n    ```")).toMatchObject({ kind: "block", from: 1, to: 3, nested: true });
    expect(only("- a\n  - b\n      ```3d\n      file: tisch.shapes\n      ```")).toMatchObject({ kind: "block", from: 2, to: 4, nested: true });
    expect(only("- ```3d\n  file: tisch.shapes\n  ```")).toMatchObject({ kind: "block", from: 0, to: 2, nested: true });
  });
  it("plain, tilde, uppercase 3D and quote-less blocks are not nested", () => {
    expect(only("```3d\nfile: tisch.shapes\n```")).not.toHaveProperty("nested");
    expect(only("~~~3d\nfile: tisch.shapes\n~~~")).toMatchObject({ kind: "block", from: 0, to: 2 });
    expect(only("```3D\nfile: tisch.shapes\n```")).toMatchObject({ kind: "block" });
    expect(only("   ```3d\n   file: tisch.shapes\n   ```")).not.toHaveProperty("nested");
  });
  it("ignores an embed shown inside a nested fence of another language", () => {
    expect(run("> ```md\n> ![[tisch.shapes]]\n> ```")).toEqual([]);
  });

  it("accepts an escaped pipe in a table and passes the clean link text to resolve", () => {
    const seen: string[] = [];
    const refs = run("| a |\n|---|\n| ![[tisch.shapes\\|200]] |", (l) => (seen.push(l), TARGET));
    expect(seen).toEqual(["tisch.shapes"]);
    expect(refs[0]).toMatchObject({ kind: "embed", alone: false, aloneReason: "table", from: 2 });
  });

  it("counts markdown-link embeds incl. %20 and angle brackets, passing decoded text", () => {
    const seen: string[] = [];
    const refs = run("![alt](tisch.shapes)\n![](Mein%20Ordner/t.shapes)\n![](<my file.shapes>)", (l) => (seen.push(l), TARGET));
    expect(seen).toEqual(["tisch.shapes", "Mein Ordner/t.shapes", "my file.shapes"]);
    expect(refs.map((r) => r.kind)).toEqual(["embed", "embed", "embed"]);
    expect(refs.every((r) => r.kind === "embed" && !r.alone)).toBe(true);
  });

  it("does not call a continuation line alone", () => {
    expect(only("- item\n  ![[tisch.shapes]]")).toMatchObject({ alone: false, aloneReason: "continuation" });
    expect(only("> quote\n![[tisch.shapes]]")).toMatchObject({ alone: false, aloneReason: "continuation" });
    expect(only("- item\n\n  ![[tisch.shapes]]")).toMatchObject({ alone: false, aloneReason: "continuation" });
    expect(only("- item\n![[tisch.shapes]]")).toMatchObject({ alone: false, aloneReason: "continuation" });
  });
  it("calls an embed alone after a paragraph break or another standalone embed", () => {
    expect(only("- item\n\n![[tisch.shapes]]")).toMatchObject({ alone: true });
    expect(only("> quote\n\n![[tisch.shapes]]")).toMatchObject({ alone: true });
    expect(only("# Kopf\n![[tisch.shapes]]")).toMatchObject({ alone: true });
    expect(only("Text\n![[tisch.shapes]]")).toMatchObject({ alone: true });
    expect(only("```js\nx\n```\n![[tisch.shapes]]")).toMatchObject({ alone: true });
  });

  it("reports reasons for refusal", () => {
    const reason = (t: string) => {
      const r = only(t);
      return r && r.kind === "embed" ? r.aloneReason : "none";
    };
    expect(reason("- ![[tisch.shapes]]")).toBe("list");
    expect(reason("> ![[tisch.shapes]]")).toBe("quote");
    expect(reason("    ![[tisch.shapes]]")).toBe("indent");
    expect(reason("Siehe ![[tisch.shapes]] oben")).toBe("inline");
    expect(reason("![[tisch.shapes]]")).toBeUndefined();
  });

  it("counts plain wikilinks as kind link, never inside other fences", () => {
    const refs = run("[[tisch.shapes]]\nSiehe [[tisch.shapes|Tisch]].\n```md\n[[tisch.shapes]]\n```");
    expect(refs).toEqual([
      { notePath: "a.md", kind: "link", from: 0, to: 0, text: "[[tisch.shapes]]" },
      { notePath: "a.md", kind: "link", from: 1, to: 1, text: "Siehe [[tisch.shapes|Tisch]]." },
    ]);
  });

  it("strips a leading BOM in shapesBlock", () => {
    expect(shapesBlock("\uFEFFbox A size 1\n")).toBe("```shapes\nbox A size 1\n```");
  });

  it("form matrix: uppercase extension and trailing space still go through resolve", () => {
    const upper = (l: string) => (l === "TISCH.SHAPES" ? TARGET : null);
    expect(run("![[TISCH.SHAPES]]", upper)[0]).toMatchObject({ kind: "embed", alone: true });
    expect(only("![[tisch.shapes]]   ")).toMatchObject({ alone: true });
    expect(only("![[Modelle/tisch.shapes|300]]")).toMatchObject({ alone: true });
  });
});
