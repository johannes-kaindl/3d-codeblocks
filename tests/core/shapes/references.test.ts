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
      { notePath: "b.md", kind: "embed", from: 1, to: 1, text: "Siehe ![[tisch.shapes|200]] oben.", alone: false },
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
