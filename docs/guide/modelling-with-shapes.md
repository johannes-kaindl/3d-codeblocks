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

A header line after the first part is an error, as is `file:` (a shapes block holds its parts itself; use a `3d` block to point at a file). `camera:<name>` is accepted by the `view` parser but has no effect on a shapes model, because shapes produce no glTF cameras. An unknown key or an unusable `height` or `view` value is a warning: the line is ignored and the model still renders.

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

## Export to glTF

The command **Export shapes model as glTF** turns a model into an ordinary `.gltf` file that other tools can open.

- **Source:** with the cursor inside a ```` ```shapes ```` block in the editor (Source mode or Live Preview), the command exports that block; otherwise it exports the active `.shapes` file. Anywhere else it tells you to place the cursor in a block or open a `.shapes` file.
- **Target:** the attachment folder of the source note or file. The file name is the `title` from the header, or the note or file name without a title; characters that are not allowed in file names are replaced by `-`, leading dots are stripped, the name is cut at 100 characters, and if nothing usable is left the name is `model`.
- **Overwriting:** if a file with that name already exists, you are asked `Overwrite <path>?` first. It never creates a numbered copy and never overwrites without asking.
- **Nothing to export:** if no line produces a part, the command says so and writes nothing.
- **The export is not a source:** the file records where it came from (`asset.extras.generatedFrom`), but nothing links back. Edit the shapes text and export again; changes made to the `.gltf` do not flow back into the text.
