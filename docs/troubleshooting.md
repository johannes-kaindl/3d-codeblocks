# Troubleshooting

Each entry starts with the message you see, as the plugin words it.

## File not found: `<path>`

**Cause:** The `file:` path of a `3d` block (or an embed) does not resolve to a file in your vault.

**Fix:** Check the spelling and the extension. The path is resolved like a wikilink: relative, vault-absolute or short form all work. Renamed or moved the file? Update the block.

## Unsupported format: `<path>` (supported: .glb, .gltf, .stl)

**Cause:** The file has another extension.

**Fix:** Convert the model to glTF/GLB or STL, for example with Blender.

## Draco-compressed glTF is not supported …

**Cause:** The file uses `KHR_draco_mesh_compression`. Draco's decoder needs a web worker, which Obsidian's renderer does not allow.

**Fix:** Export the model uncompressed, or with Meshopt compression, which does work (`gltfpack -cc` produces such files).

## The file is damaged or not a valid GLB.

**Cause:** The file is truncated, has been altered, or is not a GLB despite its extension.

**Fix:** Re-export or re-download the file. Open it in another viewer to check it.

## The glTF code is not valid JSON.

**Cause:** The body of a `gltf` code block does not parse, often a missing comma or quote.

**Fix:** Check the JSON. The [hand-writing guide](guide/writing-gltf-by-hand.md) shows working examples.

## WebGL is unavailable, so the 3D view cannot be shown.

**Cause:** Obsidian's renderer could not create a WebGL context, for example because hardware acceleration is off or the graphics driver is blocked.

**Fix:** Enable hardware acceleration in your operating system or graphics settings, then restart Obsidian.

## The 3D context was lost.

**Cause:** Browsers cap simultaneous WebGL contexts and may drop one, or the GPU reset.

**Fix:** Press the reload button in the message box. If it happens often, lower **Maximum live 3D views** in the plugin settings.

## Could not load the model: …

**Cause:** The loader failed; the text after the colon says why.

**Fix:** Press the reload button. If it keeps failing, check the file in another viewer.

## Unknown key: `heigth`

**Cause:** A `3d` block contains a key the plugin does not know, usually a typo. Known keys are `file`, `height`, `title` and `view`.

**Fix:** Correct the key name. The block still renders; the message only points out the typo.

## `height` must be a number

**Cause:** `height:` holds something other than a number.

**Fix:** Write pixels only, for example `height: 420`.

## `view`: unknown view …

**Cause:** The `view:` value is not one of `front`, `back`, `left`, `right`, `top`, `bottom`, `iso`, three numbers (`azimuth,elevation,distance`) or `camera:<name>`.

**Fix:** Use one of those forms, or press **Save view** and let the plugin write the value.

## Not found in the vault / Not loaded because "Allow external resources" is off

**Cause:** The model renders, but a texture or `.bin` file it references is missing from the vault, or is a web address. The plugin names the affected files below the viewport.

**Fix:** Copy the missing files next to the model, keeping the relative layout. For web addresses, turn on **Allow external resources** in the plugin settings.

## The view can only be saved in a `3d` code block

**Cause:** **Save view** was used on an embed, an opened file or a `gltf` block. They have no `3d` block to write into.

**Fix:** Put the model in a `3d` code block. You can still aim and fit embeds and opened files.

## Editing requires a glTF or GLB file

**Cause:** Edit mode only works on `.gltf` and `.glb` files, not on STL or `gltf` code blocks.

**Fix:** Open a glTF or GLB file and use the pencil button there.

## Model changed on disk — re-open edit mode to continue

**Cause:** The model file changed while edit mode was open, for example because a generator rewrote it.

**Fix:** Leave edit mode and enter it again. Saved edits are re-applied by node name.

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/3d-codeblocks/issues) with your Obsidian version, the plugin version (Settings → Community plugins) and what you expected to happen.
