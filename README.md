# 3D Codeblocks

View 3D artifacts (GLB, glTF, STL) inside Obsidian — orbit, zoom and pan without
leaving your note. 3D files behave like PDFs: click to open, `![[…]]` to embed.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/3d-codeblocks?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/3d-codeblocks/releases)
[![Obsidian](https://img.shields.io/badge/obsidian-1.5.0%2B-purple)](https://obsidian.md)

*Auch auf Deutsch verfügbar: [`README.de.md`](README.de.md).*

<p align="center"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/hero.png" width="820" alt="A ground-floor model rendered inside an Obsidian note, walls and rooms visible from above"></p>

## Features

- Open `.glb`, `.gltf` and `.stl` files in their own pane, or embed them with `![[…]]`
  the way you would embed a PDF.
- Two code blocks: `3d` for a file reference with an optional title and height, `gltf`
  for glTF JSON written straight into the note.
- Orbit, zoom and pan; **save a camera angle into the block**, so the view travels with
  the note and shows up in git diffs.
- **Edit mode:** move and scale the top-level nodes of a glTF/GLB model. Edits go to a
  separate `.edit.gltf` file — the original is never modified.
- Theme-aware default material for STL, which carries none of its own.
- No continuous render loop: a frame is drawn only when something changes.

<a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/orbit.gif"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/orbit.gif" width="380" alt="The model being orbited and zoomed inside the note"></a><br><sub>Click the preview for the full-size loop</sub>

## Requirements

- Obsidian **1.5.0** or newer.
- WebGL support in the renderer — standard on desktop. Mobile works, but large models
  are slow and the browser's limit on simultaneous 3D views is reached sooner.
- **Uncompressed glTF.** Draco- and Meshopt-compressed files cannot be read (see
  [Supported formats](#supported-formats)).

## Installation

Not in the community store yet. To try it: build with `npm install && npm run build`,
then copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/three-d-codeblocks/`.

## Usage

### Four ways to show a model

**1. Open a file.** Click a `.gltf`, `.glb` or `.stl` in the file explorer — it opens
in its own pane, full size, fully interactive.

**2. Embed a file** with the normal wiki-embed syntax. Add `|<height>` for a fixed height:

```markdown
![[weltmodell/3d/eg.gltf]]
![[weltmodell/3d/eg.gltf|300]]
```

**3. The `3d` code block** — a file reference with an optional title and height. Best
when you want several models in one note (e.g. every floor of a building), each labelled:

````markdown
```3d
file: weltmodell/3d/eg.glb
height: 420
title: Ground floor
```
````

Only `file:` is required; a block with nothing but a path works too.

**4. The `gltf` code block** — glTF **JSON** written straight into the note, for small
hand-written or sketch models. (Binary GLB does not fit in a text block; use a file for that.)

````markdown
```gltf
{ "asset": { "version": "2.0" }, "scenes": [], "nodes": [] }
```
````

<img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/code-and-render.png" width="820" alt="A 3d code block in the editor on the left, the rendered model on the right">

### Supported formats

| Extension | Notes |
|---|---|
| `.glb`, `.gltf` | Materials and colours come from the file |
| `.stl` | No materials in the format; the plugin applies a theme-aware default |

**Compressed glTF is not supported.** Draco and Meshopt decoders run in web workers,
which Obsidian's renderer forbids. Such files are detected and reported in plain
language instead of failing with a parser error — export uncompressed.

### Block keys

| Key | Required | Meaning |
|---|---|---|
| `file:` | yes | Path to the model. Resolved like a wikilink (relative, vault-absolute or short form) |
| `height:` | no | Viewport height in pixels; falls back to the setting |
| `title:` | no | Caption above the viewport |
| `view:` | no | Saved camera angle — a name (`front`, `back`, `left`, `right`, `top`, `bottom`, `iso`) or three numbers `azimuth,elevation,distance` |

Unknown keys are reported below the viewport rather than silently ignored — a typo like
`heigth:` should not look like a plugin bug.

### Saving a camera angle

Turn the model to the angle you want, then press **Save view** — in the sidebar (open it
with the **Open 3D view controls** command) or the pin button that appears when you hover
the model. The angle is stored in the code block as `view:`, so it travels with your note
and shows up in git diffs. The model file itself is never modified.

**Clear view** removes the `view:` key again; **Fit** resets the camera without touching
it. The same three actions are also available as commands (**Save current view to
block**, **Clear saved view**, **Fit camera to model**) for whichever model you last
interacted with. Embeds and opened files can be aimed and fitted the same way, but have
no code block to save into.

The **Controls placement** setting decides where the buttons show up: the sidebar when
it is open, the hover toolbar otherwise (default), or always just one of the two.

<img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/hover-toolbar.png" width="820" alt="The hover toolbar over a model: pin, unpin, fit and edit">

<img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/sidebar-controls.png" width="820" alt="The 3D view sidebar next to a model: view presets, Save view, Clear view, Fit and Edit model">

<img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/saved-view.png" width="820" alt="The view: key in the code block on the left, the model turned to that angle on the right">

### Edit mode

Move and scale the top-level nodes of a `.gltf` or `.glb` model — a floor, a wall, a
prop — without leaving Obsidian. Not available for `gltf` code blocks (JSON-in-note) or
STL, since both lack the node structure the editor works on.

Enter edit mode with the **pencil** button (**Edit model**) in the hover toolbar, or with
the same button in the 3D-view sidebar. Click a node to select it — a gizmo appears —
then use **Move**/**Scale** to switch what the gizmo does, or type exact numbers into the
sidebar's translation/scale fields. **Reset node** reverts the selected node only;
**Save edits**/**Discard edits** act on the whole session. While edit mode is active,
auto-rotate is paused so the model holds still; it resumes when you leave.

**Originals are never modified — edits are saved to a `<name>.edit.gltf` (or
`.edit.glb`) next to the file**, overwriting an existing edit file of the same name.
Editing a `.edit.` file itself saves in place — it is already a user edit, not the
generated original.

Because of that, **the viewer keeps showing the original once you leave edit mode** —
your saved work is a change *request*, not the model itself. A small **Unapplied edits**
badge appears in the top-left corner whenever an edit file sits next to the model, so the
state is visible rather than surprising. It disappears once the edits are folded back
into the original by whatever generates it (or once you delete the edit file).

Re-entering edit mode re-reads the fresh original and re-applies the existing edit file
on top of it, matched by node **name** (a notice reports "Loaded existing edits for N
node(s)"). This is what makes edits survive regeneration: rerun whatever produced the
original, and the next time you enter edit mode your moves and scales come back —
unless a node was renamed or removed, in which case a notice lists which edits no longer
match.

Leaving with unsaved changes shows a confirm dialog ("Discard unsaved edits?" —
**Discard** or **Keep editing**); there is no per-step undo, only **Reset node** for the
current selection and **Discard edits** for the whole session.

**Locked node prefixes** (setting, default `env__`) protects nodes by name — a node whose
name starts with one of the comma-separated prefixes cannot be selected or edited at all.

<table>
<tr>
<td><a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/edit-mode.png"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/thumbs/edit-mode.png" width="380" alt="Edit mode"></a><br><sub>Edit mode</sub></td>
<td><a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/unapplied-edits.png"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/thumbs/unapplied-edits.png" width="380" alt="Unapplied edits"></a><br><sub>Unapplied edits</sub></td>
</tr>
<tr>
<td><a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/unknown-key.png"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/thumbs/unknown-key.png" width="380" alt="A 3d block reporting an unknown key below the viewport instead of failing silently"></a><br><sub>Unknown key reported</sub></td>
<td><a href="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/settings.png"><img src="https://git.jkaindl.de/jkaindl/3d-codeblocks/raw/branch/main/docs/images/thumbs/settings.png" width="380" alt="The plugin settings: default height, ground grid, maximum live views, controls placement, locked node prefixes"></a><br><sub>Settings</sub></td>
</tr>
</table>

#### Limits

- Translation and scale only — no rotation, by design (the contract this editor follows
  doesn't need it, and it keeps the gizmo and the file diff simple).
- Top-level nodes only, no multi-select.
- No step-undo; use Discard/Reset instead.
- STL and `gltf` code blocks are not editable.

**Known limitation:** node identity relies on the glTF node indices three.js's
`GLTFLoader` reports via `parser.associations`. In files where several top-level nodes
share a single mesh, that association can become ambiguous — a three.js `GLTFLoader`
quirk, not something this plugin controls. Mis-selection is now prevented: nodes whose
index is ambiguous simply become unselectable, so a click never moves the wrong room.
Editing files with shared meshes is still unsupported — those nodes cannot be edited at
all. One mesh per node avoids it; most generators (CAD exports, floor-plan scripts)
already produce models this way.

## Configuration

| Setting | Default | Meaning |
|---|---|---|
| View mode | Interactive right away | Or: still image, activate on click |
| Default height | 400 px | For blocks without `height:` |
| Auto-rotate | off | Spin until you interact |
| Show ground grid | off | Reference grid under the model |
| Maximum live 3D views | 6 (slider 0–12) | Older inline views become still images beyond this; 0 turns the limit off |
| Controls placement | Sidebar when open, toolbar otherwise | Where the Save/Clear/Fit buttons appear |
| Locked node prefixes | `env__` | Comma-separated name prefixes protected from editing |

The last setting exists because browsers cap simultaneous WebGL contexts (around 8–16)
and silently kill the oldest ones. Rather than let that happen at random, the plugin
decides which inline viewport turns into a still image. Opened files (way 1) are always
fully interactive and never counted against this limit.

## How it works

Generated 3D output — a floor plan, a scan, a CAD export — usually lives next to the
note that discusses it, but you have to leave Obsidian to look at it. This plugin keeps
it in place: regenerate the file, and the view updates without a restart.

There is no continuous render loop. A frame is drawn only when something changes —
an open note with several 3D blocks costs no GPU time while you read it. Blocks build
their viewport when they scroll into view and release it again when they leave.

The code is split so that each layer can be tested on its own: `src/core/` holds the pure
logic (config parsing, format detection, camera fitting, context budget) and imports
neither `obsidian` nor `three` — enforced by `check:pure`. `src/viewer/` wraps three.js
and knows nothing about Obsidian. `src/obsidian/` connects the two and owns the lifecycle.

## Development

```bash
npm install
npm run dev     # watch build
npm run gate    # lint + typecheck + tests + purity + bundle size
```

Design and plan: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
Manual test checklist: `docs/SMOKE.md`.

## License

AGPL-3.0-or-later
