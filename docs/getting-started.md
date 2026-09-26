# Getting started

From the install to a model you can orbit inside a note, with a camera angle saved into the block.

## 1. Install the plugin

Settings → Community plugins → Browse → search for *3D Codeblocks* → Install → Enable.

## 2. Put a model in your vault

Drop any `.glb`, `.gltf` or `.stl` file into your vault. A `.gltf` that comes with a `.bin` file and textures needs its whole folder, so copy the folder, not just the one file.

Click the file in the file explorer. It opens in its own pane and you can orbit (drag), zoom (scroll) and pan (right-drag or Shift-drag).

## 3. Show it inside a note

Write a `3d` code block in a note and switch to reading view or Live Preview:

````markdown
```3d
file: models/house.glb
height: 420
title: My house
```
````

Only `file:` is required. To embed without a code block, use `![[models/house.glb]]`, or `![[models/house.glb|300]]` for a fixed height of 300 pixels.

You should now see the model rendered in the note, with the title above it.

## 4. Save a camera angle

Turn the model to the angle you want. Open the sidebar with the command **Open 3D view controls**, then press **Save view**, or use the pin button that appears when you hover the model.

The angle is written into the block as a `view:` line, so it travels with your note. The model file itself is never modified. **Clear view** removes the line again; **Fit** resets the camera.

## Where to go next

- [Writing a 3D model by hand](guide/writing-gltf-by-hand.md) — a `gltf` code block takes glTF JSON directly.
- The [README](https://github.com/johannes-kaindl/3d-codeblocks/blob/main/README.md) lists all block keys, the lighting setting and edit mode.
- Something off? [Troubleshooting](troubleshooting.md).
