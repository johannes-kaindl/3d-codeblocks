# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
