# Modelling with shapes

Write a model as plain text, one part per line, and see it in the note. No Blender, no JSON, no model file to export first: boxes, cylinders, spheres and cones are enough for a table, a shelf, a floor plan or a sketch of an idea.

This guide starts with a tutorial (your first model), then lists every rule as a reference.

## Your first model

Paste this into a note and switch to Reading view or Live Preview:

````markdown
```shapes
title: Table
box Top size 1.2 0.05 0.7 at 0 0.725 0 color #8b5a2b
box Leg-1 size 0.05 0.7 0.05 at -0.55 0.35 -0.3
box Leg-2 size 0.05 0.7 0.05 at 0.55 0.35 -0.3
box Leg-3 size 0.05 0.7 0.05 at -0.55 0.35 0.3
box Leg-4 size 0.05 0.7 0.05 at 0.55 0.35 0.3
```
````

You get a brown tabletop on four grey legs that you can orbit, zoom and pan like any other model. The first line is a header line that gives the viewer a title; every other line is one part.

Now break something on purpose: add the line `box Broken size 1 2` at the end. The table still renders, and a message under the viewer says `Line 7: ` followed by what is wrong. A broken line only costs its own part.

## Parts

A part line has the form `<shape> <name> size … [at …] [rot …] [color …]`. The shape, the name and `size` are required; `at`, `rot` and `color` are optional and can come in any order after the name.

| Shape | `size` takes | Meaning |
|---|---|---|
| `box` | 1 or 3 numbers | One number is a cube; three numbers are the extent along X, Y and Z |
| `sphere` | 1 number | Radius |
| `cylinder` | 2 numbers | Radius, height; the axis runs along Y |
| `cone` | 2 numbers | Radius of the base, height; the axis runs along Y and the tip points up (+Y) |

- **Name:** letters, digits, `-` and `_` (no spaces). A name must be unique within the block and must not be one of the words `size`, `at`, `rot` or `color`.
- **`at x y z`:** where the centre of the part sits. Default `0 0 0`.
- **`rot x y z`:** rotation in degrees as Euler angles, applied in X, Y, Z order. Default `0 0 0`.
- **`color #rrggbb`:** a hex colour, also as `#rgb`. Without it a part is grey (`#a0a0a0`).
- **Units and axes:** lengths are metres, angles are degrees, **Y is up**. Every shape is centred on its own origin, so a box of height 0.7 at `y = 0.35` stands on the floor.
- **Tessellation is fixed:** cylinders and cones have 24 segments, spheres 24 × 12 (segments × rings). There is no setting for smoother surfaces.
- **Numbers** use a decimal point. A decimal comma (`0,5`) is not accepted.
- **Size values** must be greater than 0.
- **Case:** shape names and keywords are not case-sensitive; part names are.
- **Comments:** a line that starts with `#` and empty lines are skipped. A comment after a part on the same line is not supported: `# …` there is read as unknown words (see below).

## Header

Lines of the form `key: value` before the first part are header lines.

| Key | Value | Effect |
|---|---|---|
| `title` | text | Title above the viewer; also names the exported file |
| `height` | number greater than 0 | Viewer height in pixels (default: the **Default height** setting) |
| `view` | `front`, `back`, `left`, `right`, `top`, `bottom`, `iso`, or three numbers `azimuth,elevation,distance` | Starting camera |

Known limit: `title`, `height` and `view` only take effect in the inline ```` ```shapes ```` block. In a `.shapes` file the viewer ignores them (the title is still used to name an export).

A header line after the first part is an error, as is `file:` (a shapes block holds its parts itself; use a `3d` block to point at a file). `camera:<name>` is accepted by the `view` parser, but a shapes model has no glTF cameras, so the viewer keeps its default view and shows a note under the model: ``unknown camera `<name>` — this file has no cameras``. An unknown key or an unusable `height` or `view` value is a warning: the line is ignored and the model still renders.

## When a line is wrong

Every problem is reported with its line number inside the block or file, as `Line 7: …`. Errors and warnings appear together, in line order, as a message under the viewer once the block has rendered. Because the notes are part of the rendered block, you only see them after it has rendered.

A line with an error drops only its own part. Messages you can run into:

- ``Unknown shape `boxx` — use box, cylinder, sphere or cone``
- ``Every part needs a name after the shape (letters, digits, `-`, `_`)``
- `` `size` is missing ``, `` `size` of a box needs 1 or 3 numbers ``, `` `size` of a sphere needs 1 number (radius) ``, `` `size` of a cylinder needs 2 numbers (radius, height) ``, `` `size` values must be greater than 0 ``
- `` `at` needs 3 numbers ``, `` `rot` needs 3 numbers ``
- `` `color` needs a hex colour like #8b5a2b ``
- `` `size` given twice `` (the same for any keyword)
- ``Duplicate name `Leg-1` ``
- ``Header lines (`key: value`) must come before the first part``

Two things are warnings rather than errors, so the part still renders: ``Unknown word `foo` ignored`` (a stray word after the name, for example a trailing comment) and the unknown or unusable header values above.

If no line produces a part, nothing is drawn and the viewer says `The shapes code has no valid part.` followed by the reasons. An empty block gets the hint to write one part per line.

## As a file

Put the same text in a file with the extension `.shapes`, for example `table.shapes`. Then it works like a `.gltf`:

- Click it in the file explorer to open it in the 3D view.
- Embed it with `![[table.shapes]]` (add `|300` for a height).
- Point a `3d` block at it:

````markdown
```3d
file: table.shapes
```
````

Edit the file and the views update. The header keys do not apply to files (see above).

## Editing a .shapes file

A `.shapes` file opens in its own view, not in the plain 3D viewer. At the top is a row of buttons that choose what you see: **Model**, **Text** and **Split**.

- **Model** shows the rendered model, **Text** shows an editor with the file's text, and **Split** shows both side by side.
- **Split** is only offered when the view is at least 700 px wide (the width of the pane, not of the window). In a narrower pane there are just **Model** and **Text**. A new view starts in Split when it is wide enough and in Model otherwise; if you chose Split and the pane gets narrower, the view shows Model and goes back to Split when the pane is wide again.
- The button that is on is marked as pressed, so the state is not carried by colour alone.
- Type in the editor and the model redraws after a short pause. The file is saved automatically; there is nothing to press.
- A line with a problem is marked in the text: errors have a red bar, a wavy underline and a tinted background, warnings a dotted yellow bar and underline. Hover a marked line to read its message. The same first message is also written out next to the buttons, for example `1 error — Line 8: …`, so a problem does not depend on colour.
- If the file changes from outside (for example through a sync tool) while it is open, the text updates in place and your cursor stays where it was. Undo works in the editor.

The header keys `title`, `height` and `view` still do not apply to files (see above).

## Moving between block and file

Two commands move a model between a ```` ```shapes ```` block and a `.shapes` file. Both are a move, not a copy: afterwards the text exists exactly once. Each command only shows up in the command palette where it applies, and appears in the editor's right-click menu under the same condition.

### Block into a file

**Move shapes block into a .shapes file** (menu entry: *Move shapes block into a file*). Put the cursor inside a ```` ```shapes ```` block in the editing view (Source mode or Live Preview, not Reading view) and run it.

- The file is **always new**. It is created in the attachment folder of the note and named after the `title` header, or after the note if there is no title, with the same character rules as the export. If that name is taken, a number is appended; an existing file is never overwritten.
- The block in the note is replaced by a ```` ```3d ```` block whose `file:` line points at the new file. The file holds the block's text and ends with one line break.
- If the new file is created but the note can no longer be changed (for example because it changed in the meantime), the new file is removed again and you are told so.
- A block inside a quote or callout, or nested in a list item by four or more spaces, is not found: the command and the menu entry are not offered, and a hotkey shows the general *Place the cursor in a ```` ```shapes ```` block* notice. A block in a list item that is indented by only one to three spaces is found, offered and refused with a message saying it is indented. A block without a matching closing fence (the closing line must use the same character and be at least as long) or an empty block is refused with a message too. Nothing is changed in any of these cases.

### File into a block

**Move .shapes file into a code block** (menu entry: *Move .shapes file into a code block*). Put the cursor in the ```` ```3d ```` block or on the `![[…]]` line that uses the file, or open the `.shapes` file itself, and run it.

- It only happens when **exactly one** place uses the file, and only when that place can become a block: either an embed `![[file.shapes]]` that stands alone on its own line at the top level, or a top-level ```` ```3d ```` block with a `file:` line. That place is replaced by a ```` ```shapes ```` block with the file's text, and the file goes to the trash (what that means follows your Obsidian *Deleted files* setting).
- It refuses, always with a message and without changing anything, when the file is not used anywhere (the message names no note), is used in several places (it names all the notes, not the lines), is only linked with `[[…]]` (no `!`), or when the embed or block sits in a list, a quote or callout, a table, is indented, is in the middle of a sentence, or continues a paragraph (these name the note and line). If the file is only mentioned in a canvas, a base or in text, the message is *has another mention*, not *not used*.
- **A ```` ```3d ```` block can only be moved back if it contains nothing but the `file:` line** (blank lines are fine). Other settings such as `height:`, `title:` or `view:` block the move and the message names them; `#` comment lines block it too, because a ```` ```shapes ```` block cannot keep either: remove them or move the file by hand. In the same way, an embed with display options (`![[file.shapes|400]]`, `|alias`, `#heading`) is refused until you remove them, and a Markdown-style embed `![](file.shapes)` has to be changed to `![[file.shapes]]` first.
- **The cursor form needs an editing view** (Source mode or Live Preview) of the note. Opening the `.shapes` file itself works from any view.
- **Other mentions block it too.** If the file name appears anywhere else, the command refuses with *has another mention* and the note and line. That covers the name in running text, in a canvas or a base file, or a different file of the same name in another folder. Known limit: a mention by file name alone, even in prose, is enough to block the move, because deleting the file could break it. Remove or change that mention and run the command again.
- Notes you have open are read as they are in the editor, so text you have typed but not saved counts. If the file is open in its own view, that view is saved first and closed before the file goes to the trash, so unsaved typing in it is not lost.
- If the file changes while the command runs, the note keeps the new block, but the file is left where it is and you are told so.
- **Normalisation:** the block gets the file's text with Windows line breaks (CRLF) turned into LF, a leading byte-order mark dropped and trailing blank lines removed. Moving the text back into a file therefore gives a file that is not byte-identical to the original.

## Export to glTF

The command **Export shapes model as glTF** turns a model into an ordinary `.gltf` file that other tools can open.

- **Source:** with the cursor inside a ```` ```shapes ```` block in the editor (Source mode or Live Preview), the command exports that block; otherwise it exports the active `.shapes` file. Anywhere else it tells you to place the cursor in a block or open a `.shapes` file.
- **Target:** the attachment folder of the source note or file. The file name is the `title` from the header, or the note or file name without a title; characters that are not allowed in file names are replaced by `-`, leading dots are stripped, the name is cut at 100 characters, and if nothing usable is left the name is `model`.
- **Overwriting:** if a file with that name already exists, you are asked `Overwrite <path>?` first. It never creates a numbered copy and never overwrites without asking.
- **Lines that were left out:** a line with a problem is not exported, just as it is not drawn. The confirmation says so, for example `Exported to Attachments/Tisch.gltf — 1 problem(s) ignored: Line 7: …`; at most three are listed, followed by `… and N more`.
- **Nothing to export:** if no line produces a part, the command says so and writes nothing.
- **The export is not a source:** the file records where it came from (`asset.extras.generatedFrom`), but nothing links back. Edit the shapes text and export again; changes made to the `.gltf` do not flow back into the text.
