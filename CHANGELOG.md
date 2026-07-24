# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
