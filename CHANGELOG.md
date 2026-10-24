# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- **A Claude entry of the LLM Endpoint Manager can now serve the prompt panel.** The plugin opts in to the Anthropic transport; without it a Claude entry stayed invisible here. Streaming, the thinking block and the shapes answer work as with a local model. **What changes for you:** under "automatic (first reachable)" the first reachable, enabled chat entry in the manager's list is used, so a Claude entry above your local one wins, and then your prompt (and, for a change, the current parts of the model) goes to Anthropic. Put the local entry first, or pick it in the **Endpoint** setting, to keep it on your machine. For Claude the request sends no `temperature`/`top_p`, and "thinking off" is sent as low effort.

### Changed

- **The version list in a narrow sidebar keeps the label.** The meta column ("3 days ago · 14 changes") used to be rigid and pushed the label out ("Run…"); it is now capped at 45 % of the row and cut with an ellipsis, the label shrinks below its content, and both carry their full text as a tooltip. In a wide sidebar nothing changes. (Kit: obsidian-kit 0.65.0; `styles.css` carries the new rules.)
- **Claude models are recognised by name.** A model whose id starts with `claude-` counts as one that reads images, and the Claude models of the sampling profile `claude` count as models that always think (the thinking toggle cannot switch them off). A local model that only carries the word in its name (`qwen3.6-claude-opus-distill`) does not count. (Kit: code-kit 0.33.0.)
- **The thinking block is built by a shared routine.** Same look, same copy button; no visible difference. (Kit: obsidian-kit 0.65.0.)
- **Kit pins raised to obsidian-kit 0.69.1 and code-kit 0.36.0.** The other changes in between touch modules this plugin does not vendor or have no visible effect here (the role "used for search — does not write" in the endpoint list, 0.67.0, is only shown when a plugin sets it).

## [0.11.0] — 2026-10-18

### Changed

- **The thinking block in the prompt panel has a copy button.** It copies the model's thinking as plain text; it appears once the block has text, stays usable after the answer ends, and clicking it does not fold the block. (Kit: obsidian-kit 0.63.0; the long-line fix below comes with it.)
- **With LM Studio, whether a model thinks or reads images now comes from the model's own metadata instead of only its name.** The thinking toggle can therefore appear for more models, and a model whose name gave no hint is no longer treated as text-only.
- **The request section of the settings warns before a request would load another model in LM Studio.** If the model you send is not loaded but others are, a line names the loaded ones: the request loads it on demand and can unload a running one ("Model unloaded.").
- **At the note "Model family recognized", a button "Set family in the manager" opens the LLM Endpoint Manager settings.** The family itself is still set there, never learned from the answer.
- **A connection type the plugin does not support (for example the manager's Claude API endpoint) is now reported as such**, instead of as a general configuration error.
- **References inside a glTF file are checked with the shared path rules.** A back slash in a reference (`tex\\a.png`) now counts as a separator, as in the browser, so it can no longer hide a `..\\`; a reference with a NUL byte is refused (listed as "this kind of reference cannot be read"), and a `..` padded with white space (`".. "`) counts as `..`. Nothing changes for ordinary references.

### Fixed

- **A long unbroken line in the prompt panel's answer no longer runs off to the right.** The model's JSON answer is one line without spaces; the answer area now wraps it instead of cutting it off at the panel edge.

## [0.10.3] — 2026-10-16

### Fixed

- **The status line in the prompt panel no longer overlaps "Preview of round N".** With a model that thinks at length (Gemma 4: several thousand characters) the open thinking block filled the answer area, and the two-line "Done — check the preview, …" line stuck out below the box and was drawn over the preview caption. The height limit now sits on the answer text and the thinking block instead of the whole box. Present since 0.10.0 (checked on 0.10.1).

## [0.10.2] — 2026-10-16

### Changed

- **Gemma 4 no longer shows its thinking as the answer.** With Gemma 4 in LM Studio the thinking used to appear in the prompt panel's answer area (and, with "Thinking" off, was part of the reply); it now goes into the collapsible thinking block and the answer area shows only the model's answer.
- **Gemma 4 on LM Studio cannot be switched off completely.** "Thinking: off" sends the lowest level there, because LM Studio ignores "none" for this model; the model still thinks a little (a few tokens, a little time).
- **A model backend or family this version does not know yet** no longer breaks the request; it is sent as unknown.

### Fixed

- **After resetting the view (double-click or the fit button), a later size change refits the view again.** Previously the reset view counted as "moved by you" again a moment later, so showing or hiding the sidebar left the picture at its old size.

## [0.10.1] — 2026-10-14

### Security

- **OBJ/MTL: a library or texture is only read when it is a file in your vault.** Since 0.10.0 the check relied on the loader's address being "changed" by the vault lookup; a blocked or missing reference now also comes back changed (as a placeholder), and with "Allow external resources" on a disguised web address (`ht<TAB>tps://…`) came back as a cleaned `https://…` address. Neither could reach the network for the texture path (placeholder or cleaned web address), but a cleaned web address would have been fetched with the setting on, and a placeholder would have been read as a material library. Both are closed; OBJ/MTL never loads from the web, whatever the setting says.

## [0.10.0] — 2026-10-14

### Security

- **With "Allow external resources" off, a model no longer loads anything from the web.** Until now a `.gltf` that named a texture or buffer at an `https://…` address was reported as "not loaded" under the viewport, but the address was still handed to the loader and requested (measured: a counting server received both requests). The setting did what the README said only for the notice, not for the request. Now every reference that is not a file in your vault or an embedded `data:` URI is replaced by a transparent placeholder, so the model appears without that texture and the notice under the viewport says what was left out. The same holds for references the loader would otherwise try relative to the app, and for references that could not be found.
- **Web addresses are recognised the way the browser reads them.** An address with a tab or line break inside the scheme (`ht<TAB>tps://…`), leading control characters or spaces, upper case, or a scheme-relative form (`//host/x`, `\\host\x`) was treated as a file name in the vault and so slipped past the check; all of these count as web addresses now (blocked with the setting off, loaded once on, in a cleaned form).

### Added

- **Seven more file formats** (open in their own pane, embed with `![[…]]` or `file:` in a block): **`.3mf`** (3D printing; colours and materials from the file, turned from Z-up to Y-up), **`.obj`** (materials from the `.mtl` named in the file when it lies in the same folder, otherwise the theme-aware default; a missing or broken `.mtl` does not stop the model; textures and libraries are only read from your vault, a `.mtl` that asks for a web address or a `file:` path gets nothing loaded, whatever the setting "Allow external resources" says), **`.ply`** (faces with the colours of the file, a file without faces as a point cloud), **`.gcode`** (the printer path as lines, travel red and extrusion green), **`.xyz`** and **`.pcd`** (point clouds, colours from the file or the theme colour, point size follows the extent). A file without any geometry now says so ("the file holds no geometry") instead of showing an empty view. The bundle grows from 851 to 904 KB. README and getting-started list the formats; `.fbx`, `.dae` and the like stay unsupported.
- **New command "Save current view as image":** saves the current frame of the active 3D model as a PNG in the attachment folder of the open note. An existing file is never overwritten (the file name is numbered instead). It works for code blocks, embeds and the file view; while the model is still loading it says so instead of saving an empty picture.

### Fixed

- **Prompt panel, "Apply" as a new block:** a selection that ends inside another code block, or a cursor inside it, now puts the new block after that code block instead of inside it. If the code block is never closed there is no "after it": the panel refuses with a message and writes nothing. In a note with Windows line endings the inserted block keeps them.

### Changed

- **Prompt panel, no language model:** when the LLM Endpoint Manager is the source, the hint now says what is missing and where to fix it (no usable endpoint, endpoint removed, endpoint switched off, API key not stored yet, manager not answering) instead of the raw reason. A local endpoint list keeps the plain "Reason: …" line.
- Behaviour of the shared kit pins taken with the update: obsidian-kit 0.60.1 and code-kit 0.27.1 (from 0.59.1 and 0.24.0). The other changes in 0.60.0, 0.60.1, 0.25.0, 0.26.0, 0.27.0 and 0.27.1 (tool-provider contract, share export, plugin-id check, local time stamps, slugs, sizes, secret value, `version-list` mode, byte tokens, Lua-port exports) do not change what this plugin shows; the list of request settings that were dropped (`sanitizeRequestSettings`) is now sorted, which only changes the order of that hint.

## [0.9.1] — 2026-10-12

### Fixed

- **Prompt panel, answer area:** the streamed answer now follows to the end also when a large block arrives in one piece (several lines at once), as long as you are at the bottom; before, the area stopped following after the first big piece. If you scroll up while an answer streams, it still does not pull you back down. (Measured in the smoke run with pieces of 300 characters: distance to the end 2,480 px before, 1 px now.)

### Changed

- **Settings, endpoint list:** the "move up" and "remove endpoint" buttons stay together, the address and the model ID stay fully visible at normal widths; in a narrow window the block of model and buttons moves as a whole to a second row instead of a button standing alone (obsidian-kit 0.59.0 and 0.59.1).
- **Settings, section "Request":** for an endpoint whose model family is not known yet, it now says "not detected yet" with a note that this is normal for a freshly entered endpoint (and that the LLM Endpoint Manager keeps family and backend), and the fields read "not sent yet — waiting for the model family" instead of "unknown".
- Behaviour of the shared kit pins taken with the update: obsidian-kit 0.59.1 and code-kit 0.24.0 (from 0.56.0 and 0.23.0). The other changes in 0.56.1–0.58.0 (kit mock additions, `sanitizeChoice`, `pruefeLinearFuzz`, `fetchEndpointContext`, embedding rows without "server picks") touch modules this plugin does not use or tests only.

## [0.9.0] — 2026-10-12

### Fixed

- Reading the JSON out of a model answer is no longer quadratic for two more kinds of degenerate answer (measured on a prompt-panel answer, 2,000 / 10,000 / 20,000 / 50,000 repetitions): `\"[` repeated took 10 / 157 / 657 / 3,593 ms and `[` repeated, then `x`, then `]` repeated took 28 / 566 / 2,048 / 11,391 ms; both now take a few milliseconds (1 / 1 / 1 / 4 ms and 1 / 3 / 5 / 10 ms). The scan is the shared kit module `llm-json` now; an answer that is so degenerate that it reaches the work budget is reported as incomplete, as an unclosed bracket is.
- The check of a model answer for a hidden `<think>` block is linear now: an answer with tens of thousands of unclosed `<think>` tags took seconds to check and takes under a millisecond.

### Changed

- **Settings, endpoint list:** under a reachable endpoint row that has a model, the row now shows the model's context length ("Context: loaded N · max M tokens", or only "max M" when the model is not loaded; nothing when the server does not report a number). The model drop-down of a row offers "— (server picks)" again: choosing it clears the row's model, and the server answers with the model it has loaded.
- The status and warning texts of the endpoint row (the tooltips of the status icons and of the input hints) come from the kit's wording now, in English and German.
- Long streamed answers in the prompt panel are rendered faster: the kit's guard against remote resources in a model answer works on the changed parts only instead of the whole answer on every update (100 KB: 3.2 s down to 1.3 s in the kit's measurement).
- Behaviour of the shared kit pins taken with the update: obsidian-kit 0.56.0 and code-kit 0.23.0 (from 0.53.0 and 0.21.1).

## [0.8.0] — 2026-10-11

### Fixed

- Reading the JSON out of a model answer no longer slows down quadratically on an answer with very many unclosed brackets or unclosed `<think>` tags (50,000 opening brackets took about 12 seconds, now a few milliseconds).

### Changed

- **The global model setting is gone; each endpoint row carries its own model.** A model you had set globally moves once, when the plugin loads, into every row that had none; rows with their own model stay as they are, and a row you clear afterwards stays empty. The model drop-down in the prompt panel now sets the model of the endpoint row in use (or the Manager's endpoint choice). The endpoint choice no longer offers a "global model" option.
- The source editor's cursor-preserving external edit (`diffReplaceSpan`) now comes from the shared kit instead of a local copy. Behaviour is unchanged.
- The redaction of secrets before a request now masks `Bearer` tokens more broadly (from 8 characters on, in any letter case, `=` allowed inside the token).

## [0.7.1] — 2026-10-10

### Changed

- The settings screenshot in the README now shows the whole Settings page, including the Help row and the "Model by prompt" section.

## [0.7.0] — 2026-10-09

### Changed

- **Secrets are masked before a prompt leaves the plugin (kit 0.51.2).** Private-key blocks, bearer tokens and similar secrets in the text you send from the prompt panel go to the model as placeholders; the answer comes back with the originals restored (the model's JSON stays valid, also for multi-line values). Nothing to configure.
- **A deviation notice now appears by default** when the model server answers differently from what the plugin asked for (once per kind and session, English text).
- **Request section:** a failed save of the request settings is now shown in the section (red status line).
- Updated the vendored kit modules to obsidian-kit 0.51.2 / code-kit 0.15.0 (one version for all modules).

## [0.6.2] — 2026-10-04

### Fixed

- **Store CSS lint (review of 0.6.1: Satisfactory, two medium findings):** the error and warning markers of the `.shapes` text editor no longer use the multi-valued `text-decoration: underline wavy|dotted` (flagged as only partially supported by Obsidian 1.11.4); the line under a marked line is now a `border-bottom` (solid 2 px for errors, dotted 1 px for warnings), so the shape still tells the two apart without colour. A duplicate `min-height` declaration in the editor's minimum-height rule is removed.

## [0.6.1] — 2026-10-04

### Fixed

- **Release build on GitHub failed for 0.6.0** (`npm ci` stopped with a peer-dependency conflict: the `obsidian` typings pin `@codemirror/state` 6.5.0, the text editor needs 6.7.6; `npm install` resolves this leniently, `npm ci` does not). Added `.npmrc` with `legacy-peer-deps=true`, the same setting json-editor uses for the same editor. No change to the plugin itself; 0.6.0 and 0.6.1 carry identical code.

## [0.6.0] — 2026-10-04

### Added

- **shapes models** (hand-written, no LLM): describe a model as one part per line (`box`, `cylinder`, `sphere`, `cone` with `size`, `at`, `rot`, `color`) in a ``shapes`` code block or a `.shapes` file. A broken line only drops that part and is reported with its line number. Files work in the 3D view, as `![[…]]` embeds and via the ``3d`` block's `file:` key.
- `.shapes` files open in their own view with **Model | Text | Split**: edit the text and the model re-renders after a short pause; broken lines are marked in the text.
- Commands **Move shapes block into a .shapes file** and **Move .shapes file into a code block** (also in the editor's right-click menu). Moving a file back into a block only happens when exactly one place uses it (one embed or one ```3d block with nothing but the `file:` line); the file then goes to the trash or is removed, as your *Deleted files* setting says. Embeds with display options and blocks with comment lines are refused, because they would lose them.
- Command **Export shapes model as glTF**: writes a self-contained `.gltf` to the attachment folder; an existing file is only overwritten after you confirm.
- A ```` ```shapes ```` fence whose info line contains a backtick (for example a prose line like ```` ```shapes``` text ````) is no longer treated as the start of a code block, following the CommonMark rule. This only matters for Export and Move shapes block into a file with such an unusual line.
- The GitHub release now also carries a ready-to-unpack `three-d-codeblocks.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.
- **Model by prompt:** a prompt panel (command **Open prompt panel**, or the sparkles button **Edit in prompt panel** on a shapes model) creates a shapes model from a description or changes an existing one (move, resize, rotate, recolour, switch shape, add, remove). It streams the answer, shows a preview and the list of changes, keeps every request as a round you can select back, and applies the selected round to a code block, a `.shapes` file or a new model. A quality line says whether the chosen model was measured. Stop works at any moment.
- Setting **Apply new models as** (code block at the cursor, file in the attachment folder, or ask each time).
- Section **Language model** in the settings: your endpoints (OpenAI-compatible, keys in Obsidian's secret storage) and the request parameters; the optional LLM Endpoint Manager plugin can supply them instead.
- After a first Create round the status says `… or press New to start another model.`; a Change round keeps the old text.
- Arrow keys pan the view after you click the model (a focus ring shows it has the focus; Escape gives it back). Right-drag and Shift-drag pan as before.
- Shift, Ctrl or Cmd with an arrow key rotates the view instead of panning (OrbitControls default).

### Changed

- **The minimum Obsidian version is now 1.11.4** (was 1.6.6). The prompt panel stores API keys in Obsidian's secret storage, which Obsidian introduced in 1.11.4.

### Fixed

- **`.shapes` file view: the model sat too low and was cut off at the bottom.** The drawing surface could grow beyond the visible pane, so the model was centred in an area that extended below the window. The surface is now bounded by the pane, and the camera frames the model (middle of the box in the middle of the pane) when the file opens and again on every size change as long as you have not moved the view yourself, for example when a sidebar opens or you switch between Split and Model. This applies to code blocks as well. With auto-rotate switched on, the view is not framed again on every size change.
- **Prompt panel: nothing is cut off or overlapped any more.** With two rounds and a list of changes the answer area collapsed to a thin strip, the status line overlapped the preview caption and Apply/Discard were half cut off at the bottom. The panel now scrolls, the answer area keeps a minimum height of six lines, and the Apply/Discard row stays at the bottom edge.
- **`.shapes` file view: the editor frame stays a solid line when focused.** CodeMirror drew a dotted outline on a focused editor; the frame now turns accent-coloured instead.
- **`.shapes` file view: the editor is as tall as its text.** At least about three lines, at most the height of the pane (then it scrolls inside); in Split the text column follows the same rule and the model stays as tall as the pane.
- **`.shapes` file view: the text and split views had no visible end.** The editor is now a framed field, the area ends in a line, and Split has a divider line between text and model; neither half grows past the area.

## [0.5.0] — 2026-09-26

### Added

- Help row at the top of the settings with links to the documentation and the issue tracker.

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
