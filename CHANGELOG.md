# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.4.1] — 2026-09-26

### Changed

- **The minimum Obsidian version is now 1.6.6** (was 1.5.0). The folder picker uses `Vault.getAllFolders`, which Obsidian introduced in 1.6.6; the declared minimum was too low, so the community store flagged the plugin. Nothing changes for anyone who could run the plugin before without error.

### Fixed

- **The initial camera fit could land ~18% too close when a note's layout narrowed after
  the block first rendered** (typical in a sidebar-narrow column) — the camera never moved
  to match, only its aspect ratio did. The fit now binds to the first layout that actually
  holds still, without disturbing a camera the reader has since orbited themselves.
- **Clicking a node that shares its mesh with another (a common case — any model with
  repeated objects, e.g. four walls built from one instanced mesh) silently selected
  nothing in edit mode**, indistinguishable from a click that missed or a broken plugin.
  It now shows a notice explaining that the node can't be edited individually.

## [0.4.0] — 2026-09-02

### Added

- **A model can now be shown from a camera its own author placed.** Many `.gltf` and `.glb`
  files carry cameras — the section, the entrance, the angle whoever built the model
  considered the right one — and until now the plugin ignored them. `view: camera:<name>`
  in the block starts there: position, direction and field of view come straight out of the
  file, and from that point you orbit, zoom and pan as usual, turning around the point that
  camera looks at rather than the middle of the model, so a camera that frames a detail
  keeps its detail. **The name is looked up in the file, not in the loaded scene** — worth
  knowing, because the two are not the same: three.js rewrites names while loading and turns
  `Schnitt A` into `Schnitt_A`, so a name with a space would otherwise be unreachable. The
  raw glTF is searched instead, node names first and camera names second, without regard to
  case. A name that is not there, a file with no cameras at all, an orthographic camera (the
  viewport is perspective) or a `view: camera:…` on an STL is reported below the viewport,
  and the model is fitted as usual so that it stays visible. **Save view** is unchanged and
  still writes numbers, so pressing it replaces the reference with the angle you are looking
  from at that moment.
- **Metallic models are no longer black.** A metallic surface needs an environment to
  reflect; without one there is nothing to see. glTF gives `metallicFactor` a default of
  `1.0`, so a material that only sets a base colour — the most common case in hand-written
  and tool-written files alike — was rendered as polished metal with nothing around it.
  The viewport now provides that environment.
- **New setting "Lighting"** with three states: *Faithful colors* (the default; reflections
  on, and your theme's colours stay intact), *High contrast* (punchier and more filmic,
  shifts theme colours somewhat), and *Off* (the previous behaviour). The default changes
  how existing notes look — that is deliberate, the old behaviour was the incorrect one.
- **New setting "Model's own lights".** Some 3D files bring their own lighting; the plugin
  now steps back and stops adding its own when they do. Set it to *Ignore them* for files
  whose lights are exported at unusable brightness.

- **Models that come in several files now work.** A `.gltf` usually keeps its geometry in
  a `.bin` beside it and its textures in a folder — the way every Blender export looks.
  Those files are now loaded from your vault, resolved relative to the model file. What
  the model asks for and your vault does not have is named below the viewport instead of
  quietly missing.
- **New setting "Allow external resources"** (off by default). A model may point at
  http(s) addresses; with the setting off, those are not fetched and are reported instead.
  Off by default because opening a note should not contact a server you did not choose.
- **STL files that carry their own colours now show them.** The theme colour still applies
  to STL files without colours of their own.
- **Meshopt-compressed models now load** (`EXT_meshopt_compression`, what `gltfpack -cc`
  produces). The README said this was impossible because the decoder needs a web worker —
  that is true of Draco, not of Meshopt: its decoder falls back to running in the main
  thread, and the WebAssembly it needs is embedded in the plugin, so nothing is fetched.
  Draco is still refused, and its message now names the way out instead of only the wall.
- **A guide: [writing a 3D model by hand](docs/guide/writing-gltf-by-hand.md).** Builds a
  model as text inside a note, step by step, and teaches you to read any `.gltf` file along
  the way. Every example in it is loaded through the plugin's own loader on every commit,
  so it cannot quietly stop working.

### Fixed

- **The "discard unsaved edits" dialog had its buttons the wrong way round** — the
  destructive choice sat on the left. Cancel is now on the left and the destructive
  action on the right, as everywhere else in Obsidian.

## [0.3.1] — 2026-08-04

### Changed

- The **active model** is easier to spot: its frame is stronger and its title now carries
  the accent colour too. The sidebar controls whichever model you used last, which was
  hard to tell apart when several models sit in one note — the title is exactly the name
  the sidebar shows, so the two now point at each other.

### Fixed

- **Clicking a still image did not fill the sidebar.** With the view mode set to
  *activate on click* — and whenever the context budget had turned a model into a still
  image — the click brought the model back to life but left the **3D view** sidebar
  showing "Click a 3D model to control it here.", so the controls seemed broken. A still
  image has no orbit controls, and those were the only source of the "this model is being
  used" signal; the reactivating click now reports itself as the interaction it is.

## [0.3.0] — 2026-08-01

### Added

- **Unapplied edits** badge: when a `<name>.edit.gltf`/`.edit.glb` sits next to the
  displayed model, a small hint appears in the top-left corner of the viewport. Outside
  edit mode the viewer deliberately shows the original — the edit file is a change
  request, not the model — which previously looked as if saved work had been lost. The
  badge appears in all viewing paths (code block, embed, file view) and updates without
  a reload when the edit file is created, deleted or renamed.

### Fixed

- **Leaving edit mode failed silently.** `TransformControls.dispose()` throws in
  three r169 (`this.traverse is not a function` — the class moved from `Object3D` to
  `Controls`, but its `dispose()` still calls `traverse`). The error aborted everything
  that followed it: edit mode could not be left, the viewport stayed pinned so
  auto-rotate and orbit never resumed, and unloading a block never disposed its WebGL
  context. Also hardened: a failing rig teardown can no longer block the exit.

## [0.2.0] — 2026-07-27

### Added

- **Edit mode**: move and scale top-level nodes of glTF/GLB models via a gizmo
  (**Edit model** in the hover toolbar or the 3D-view sidebar) or precise number
  fields in the sidebar. Rotation is deliberately not offered.
- Edits are saved to a `<name>.edit.gltf`/`.edit.glb` **next to** the file — the
  original is never modified. Re-entering edit mode re-applies saved edits by node
  name onto the fresh original, so edits survive file regeneration.
- New setting **Locked node prefixes** (default `env__`): nodes whose names match a
  prefix cannot be selected or edited.
- Edit mode works in all three viewing paths (code block, embed, file view — the
  latter two are operated via the sidebar) and pauses auto-rotate while active.
- The file view now reloads when its file changes on disk and follows theme changes.

### Fixed

- The **Auto-rotate** setting now applies to already-open viewports immediately
  instead of only after a reload.
- Reloading a model (file regeneration) no longer leaks a WebGL context per reload.
- Discarding edits while the model reloads in the background now shows a notice
  instead of silently doing nothing.

## [0.1.3] — 2026-07-26

### Added

- Saved camera angles: turn a model, press **Save view**, and the angle is written into
  the code block as `view:` (`iso`, `top`, or `azimuth,elevation,distance`).
- Sidebar view with view presets and Save/Clear/Fit, plus a hover toolbar on the model
  when the sidebar is closed. New setting: **Controls placement**.

### Fixed

- **View mode "Still image, activate on click" now works.** Clicking the still image
  rebuilt the viewport and immediately degraded it back to a still image, so the model
  never became interactive. Present since 0.1.0.
- **Saving a view in Reading mode no longer fails silently.** The editor write path is
  a no-op there, yet still reported "View saved"; Reading mode now writes through the
  vault instead.
- The hover toolbar reappears after collapsing and expanding a sidebar. Obsidian does
  not emit `layout-change` for that, so the plugin listens for `resize` as well.
- Named views are written within 5° of a preset instead of 2°. Turning a model by hand
  never hit the old tolerance, which made names like `top` practically unreachable.
- Settings are declared through `getSettingDefinitions()` so they appear in Obsidian
  1.13+ settings search, with the existing `display()` rendering kept as a fallback for
  older versions.

## [0.1.2] — 2026-07-24

### Fixed

- `authorUrl` set to the GitHub profile so the community-store validator can reach it
  (the portal reaches URLs from a restricted IP range and flags some personal domains
  as unreachable even when they respond fine in a browser).

## [0.1.1] — 2026-07-24

### Fixed

- Plugin id changed to `three-d-codeblocks` to satisfy the community-store rule that
  ids contain only lowercase letters and hyphens (no digits). The display name
  "3D Codeblocks" is unchanged.

## [0.1.0] — 2026-07-24

### Added

- Inline 3D viewer for GLB, glTF and STL artifacts with orbit, zoom and pan.
- Four rendering paths over a shared `ViewerHost` core: a `3d` code block with a
  `file:` reference, a `gltf` code block holding source inline, a `![[model.gltf|H]]`
  file embed, and a full-tab file view when opening a 3D file directly.
- Per-block options (`height:`, `title:`) plus global settings for a consistent look
  across views, and a "render on click" poster mode as an alternative to instant interactivity.
- Setting to cap the number of simultaneously live viewers (0 = off … 12) to keep
  notes with many embeds responsive.
