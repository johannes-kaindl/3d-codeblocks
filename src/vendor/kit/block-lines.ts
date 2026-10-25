// vendored from code-kit@0.37.5, src/ts/pure/block-lines.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Reads the lines of a fenced code block that holds `key: value` settings — the part every plugin with such a block
 *  wrote the same way, and nothing of what the keys mean.
 *
 *  Origin: health-vitals `src/core/block-spec.ts` (`parseBlockSpec`) and 3d-codeblocks `src/core/block-config.ts`
 *  (`parseBlockConfig`) and `src/core/shapes/parse.ts`; the key pattern stood three times, `stripQuotes` twice, the line
 *  loop twice. The rules, identical in both readers:
 *
 *  - the source is split at `\n`, every line trimmed (so `\r\n` sources read like `\n` ones);
 *  - an empty line and a line that **starts** with `#` are skipped (a `#` inside a value is a value: `color: #ff0000`);
 *  - a line is `key: value` if it matches `^[A-Za-z][A-Za-z0-9_-]*\s*:` — the first colon splits, the value keeps any further
 *    colons; the key is lowercased (`rawKey` keeps it as written, for a warning that names the key as the user typed it);
 *  - the value loses one pair of matching `"…"` or `'…'` and is trimmed again ({@link unquote}).
 *
 *  A line ends at `\n` only. A lone `\r` or U+2028 INSIDE a line is part of it, and `.` in the key pattern does not match them, so
 *  `key: a\rb` is no `key: value` line (it comes back in `loose`) — as in both plugins. 3d-codeblocks `block-edit.ts` and
 *  `shapes-convert.ts` test the key with a pattern that stops at the colon, so they call that line a key line: moving them here
 *  changes that.
 *
 *  What differs between the plugins and therefore stays out: a line that is no `key: value` — health-vitals reports it as an
 *  error (`block.badLine`), 3d-codeblocks reads it as the path shorthand for `file:` (so `some folder/odd:name.glb` survives).
 *  Such lines come back in `loose`, trimmed, with their line number; what to do with them, which keys exist, what a value
 *  must look like and what blocks rendering is the plugin's. Duplicate keys are all returned, in source order.
 *
 *  Pure, no I/O; linear in the source (the key pattern is anchored and matched once per line; tested at 1 000 / 10 000 /
 *  50 000 for a long key, a key and many spaces, many lines, many quotes). */

export interface BlockEntry {
  /** Lowercased. */
  key: string;
  /** As written. */
  rawKey: string;
  /** Quotes removed, trimmed. */
  value: string;
  /** Trimmed, quotes untouched (3d-codeblocks `shapes` reads its header values like that). */
  rawValue: string;
  /** 1-based, counting skipped lines. */
  line: number;
}

export interface BlockLooseLine {
  /** The trimmed line, quotes untouched. */
  text: string;
  /** 1-based. */
  line: number;
}

export interface BlockLines { entries: BlockEntry[]; loose: BlockLooseLine[] }

const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(.*)$/;

/** One pair of matching double or single quotes around the value goes, what is inside is trimmed again; anything else
 *  (an unbalanced quote, a lone quote) stays as it is. */
export function unquote(value: string): string {
  const v = value.trim();
  const quoted = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
  return quoted && v.length >= 2 ? v.slice(1, -1).trim() : v;
}

export function parseBlockLines(source: string): BlockLines {
  const entries: BlockEntry[] = [];
  const loose: BlockLooseLine[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = KEY_LINE.exec(line);
    if (!m) { loose.push({ text: line, line: i + 1 }); continue; }
    const rawKey = m[1] ?? "";
    const rawValue = (m[2] ?? "").trim();
    entries.push({ key: rawKey.toLowerCase(), rawKey, value: unquote(rawValue), rawValue, line: i + 1 });
  }
  return { entries, loose };
}
