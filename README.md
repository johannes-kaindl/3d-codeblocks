# 3D Codeblocks

Render 3D artifacts inline in your notes. Put a path in a `3d` code block and get an
interactive viewport — orbit, zoom and pan without leaving the note.

````markdown
```3d
file: weltmodell/3d/eg.glb
height: 420
title: Ground floor
```
````

Only `file:` is required. A block that contains nothing but a path works too:

````markdown
```3d
weltmodell/3d/eg.glb
```
````

## Why

Generated 3D output — a floor plan, a scan, a CAD export — usually lives next to the
note that discusses it, but you have to leave Obsidian to look at it. This plugin keeps
it in place: regenerate the file, and the view updates without a restart.

## Supported formats

| Extension | Notes |
|---|---|
| `.glb`, `.gltf` | Materials and colours come from the file |
| `.stl` | No materials in the format; the plugin applies a theme-aware default |

**Compressed glTF is not supported.** Draco and Meshopt decoders run in web workers,
which Obsidian's renderer forbids. Such files are detected and reported in plain
language instead of failing with a parser error — export uncompressed.

## Block keys

| Key | Required | Meaning |
|---|---|---|
| `file:` | yes | Path to the model. Resolved like a wikilink (relative, vault-absolute or short form) |
| `height:` | no | Viewport height in pixels; falls back to the setting |
| `title:` | no | Caption above the viewport |

Unknown keys are reported below the viewport rather than silently ignored — a typo like
`heigth:` should not look like a plugin bug.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| View mode | Interactive right away | Or: still image, activate on click |
| Default height | 400 px | For blocks without `height:` |
| Auto-rotate | off | Spin until you interact |
| Show ground grid | off | Reference grid under the model |
| Maximum live 3D views | 6 | Older views become still images beyond this |

The last setting exists because browsers cap simultaneous WebGL contexts (around 8–16)
and silently kill the oldest ones. Rather than let that happen at random, the plugin
decides which viewport turns into a still image.

## Performance

There is no continuous render loop. A frame is drawn only when something changes —
an open note with several 3D blocks costs no GPU time while you read it. Blocks build
their viewport when they scroll into view and release it again when they leave.

## Installation

Not in the community store yet. To try it: build with `npm install && npm run build`,
then copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/3d-codeblocks/`.

## Development

```bash
npm install
npm run dev     # watch build
npm run gate    # lint + typecheck + tests + purity + bundle size
```

`src/core/` holds the pure logic (config parsing, format detection, camera fitting,
context budget) and imports neither `obsidian` nor `three` — enforced by `check:pure`.
`src/viewer/` wraps three.js and knows nothing about Obsidian. `src/obsidian/` connects
the two and owns the lifecycle.

Design and plan: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
Manual test checklist: `docs/SMOKE.md`.

## License

AGPL-3.0-or-later
