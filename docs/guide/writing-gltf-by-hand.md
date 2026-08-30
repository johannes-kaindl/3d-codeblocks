# Writing a 3D model by hand

Most 3D files are exported, never read. This guide takes the other route: you will write
a model as text, paste it into a note, and watch it appear. By the end you will be able to
open any `.gltf` file and understand what it says.

You need nothing but Obsidian and this plugin. No Blender, no build step.

> Every example on this page is checked on every commit — a test extracts each block and
> loads it through the same code the plugin uses. If one stopped working, the build would
> fail before you ever saw it.

## The block you will be typing into

The `gltf` code block takes glTF **JSON** directly. It has no options; whatever is between
the fences is the whole model.

````markdown
```gltf
{ "asset": { "version": "2.0" } }
```
````

Paste that and you get a message, not a model — it is valid glTF, but it contains nothing.
Let us give it something.

## Step 1: a triangle

Here is a complete, working model. Paste it into a note and you will see a triangle you
can orbit.

```gltf
{
  "asset": { "version": "2.0" },
  "scene": 0,
  "scenes": [{ "nodes": [0] }],
  "nodes": [{ "mesh": 0 }],
  "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0, "NORMAL": 1 } }] }],
  "accessors": [
    {
      "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
      "min": [0, 0, 0], "max": [1, 1, 0]
    },
    { "bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3" }
  ],
  "bufferViews": [
    { "buffer": 0, "byteOffset": 0, "byteLength": 36 },
    { "buffer": 0, "byteOffset": 36, "byteLength": 36 }
  ],
  "buffers": [
    {
      "byteLength": 72,
      "uri": "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/"
    }
  ]
}
```

That is a lot of JSON for one triangle, and the reason is worth understanding: **glTF
separates what the data means from where the data sits.** Read it from the bottom up.

| Layer | What it says | In plain words |
|---|---|---|
| `buffers` | 72 bytes, here they are | The raw material. Nothing about what it means |
| `bufferViews` | bytes 0–35 are one thing, 36–71 another | Two slices of that material |
| `accessors` | slice 0 is 3 × `VEC3` of `5126` | *How to read* a slice: three groups of three 32-bit floats |
| `meshes` | `POSITION` is accessor 0, `NORMAL` is accessor 1 | What each slice is *for* |
| `nodes` | this node shows mesh 0 | An object placed in the world |
| `scenes` | the scene contains node 0 | What gets shown |

The number `5126` is glTF's code for "32-bit float". It looks like a magic number because
it is one: glTF borrowed these codes from OpenGL.

### Why NORMAL is not optional

`POSITION` says where the corners are. `NORMAL` says which way the surface faces — and
without it, lighting has nothing to work with. Delete the `NORMAL` lines and the triangle
does not disappear; it turns dark, because every light in the scene is now hitting a
surface with no direction.

This is the single most common reason a hand-written model shows up black.

### What min and max are for

`POSITION` accessors must carry `min` and `max` — the corners of the box the geometry fits
in. It is the one accessor where glTF insists, because a viewer needs to know how big a
model is *before* decoding the data. This plugin uses it to point the camera at your model
instead of into empty space.

Get them wrong and nothing breaks visibly; the camera just aims oddly.

## Step 2: reusing corners with indices

A square is two triangles. Written out, that is six corners — but a square has four, and
two of them would be duplicated. `indices` lets you list each corner once and then say in
which order to visit them:

```gltf
{
  "asset": { "version": "2.0" },
  "scene": 0,
  "scenes": [{ "nodes": [0] }],
  "nodes": [{ "mesh": 0 }],
  "meshes": [
    { "primitives": [{ "attributes": { "POSITION": 0, "NORMAL": 1 }, "indices": 2 }] }
  ],
  "accessors": [
    {
      "bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3",
      "min": [0, 0, 0], "max": [1, 1, 0]
    },
    { "bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC3" },
    { "bufferView": 2, "componentType": 5123, "count": 6, "type": "SCALAR" }
  ],
  "bufferViews": [
    { "buffer": 0, "byteOffset": 0, "byteLength": 48 },
    { "buffer": 0, "byteOffset": 48, "byteLength": 48 },
    { "buffer": 0, "byteOffset": 96, "byteLength": 12 }
  ],
  "buffers": [
    {
      "byteLength": 108,
      "uri": "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAABAAIAAAACAAMA"
    }
  ]
}
```

The indices are `0,1,2, 0,2,3` — two triangles sharing the corners 0 and 2. Their
`componentType` is `5123`, glTF's code for "unsigned 16-bit integer", and their type is
`SCALAR` because an index is a single number, not a triple.

**The order matters.** Corners listed counter-clockwise face you; clockwise, and the
surface faces away. That is how a viewer knows the inside of a wall from the outside.
Swap two indices and half your square vanishes at certain angles.

## Step 3: giving it a colour

Nothing so far said anything about appearance, so the plugin fell back to a default.
Materials live in their own list, and a primitive points at one:

```gltf
{
  "asset": { "version": "2.0" },
  "scene": 0,
  "scenes": [{ "nodes": [0] }],
  "nodes": [{ "mesh": 0 }],
  "meshes": [
    {
      "primitives": [
        { "attributes": { "POSITION": 0, "NORMAL": 1 }, "indices": 2, "material": 0 }
      ]
    }
  ],
  "materials": [
    {
      "name": "Terracotta",
      "pbrMetallicRoughness": {
        "baseColorFactor": [0.79, 0.38, 0.25, 1.0],
        "metallicFactor": 0.0,
        "roughnessFactor": 0.7
      }
    }
  ],
  "accessors": [
    {
      "bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3",
      "min": [0, 0, 0], "max": [1, 1, 0]
    },
    { "bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC3" },
    { "bufferView": 2, "componentType": 5123, "count": 6, "type": "SCALAR" }
  ],
  "bufferViews": [
    { "buffer": 0, "byteOffset": 0, "byteLength": 48 },
    { "buffer": 0, "byteOffset": 48, "byteLength": 48 },
    { "buffer": 0, "byteOffset": 96, "byteLength": 12 }
  ],
  "buffers": [
    {
      "byteLength": 108,
      "uri": "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAABAAIAAAACAAMA"
    }
  ]
}
```

The buffer did not change. Geometry and appearance are separate concerns in glTF, and this
is what that separation buys you: the same shape, described once, wearing a different coat.

**`baseColorFactor` is four numbers from 0 to 1** — red, green, blue, alpha. Not 0–255.
A value above 1 is not brighter; it is invalid.

**`metallicFactor` is a claim about the material, not a look.** At `1.0` the surface takes
its colour almost entirely from what it reflects — and in an empty scene there is nothing
to reflect, so a fully metallic object goes dark.

And here is the trap: **`metallicFactor` defaults to `1.0`**, not to `0.0`. Write a
material with nothing but a `baseColorFactor` and you have declared polished metal. That is
the second-most-common reason a hand-written model comes out black, right after missing
normals, and it is the reason the example above sets the value explicitly even though
`0.0` looks like it should be the obvious default.

## Step 4: two objects from one mesh

A node is not the shape; it is a *placement* of the shape. Point two nodes at the same
mesh and you have two objects for the price of one:

```gltf
{
  "asset": { "version": "2.0" },
  "scene": 0,
  "scenes": [{ "nodes": [0, 1] }],
  "nodes": [
    { "name": "Ground", "mesh": 0, "scale": [3, 3, 1], "rotation": [-0.7071, 0, 0, 0.7071] },
    { "name": "Panel", "mesh": 0, "translation": [0.5, 0, 0.5] }
  ],
  "meshes": [
    { "primitives": [{ "attributes": { "POSITION": 0, "NORMAL": 1 }, "indices": 2 }] }
  ],
  "accessors": [
    {
      "bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3",
      "min": [0, 0, 0], "max": [1, 1, 0]
    },
    { "bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC3" },
    { "bufferView": 2, "componentType": 5123, "count": 6, "type": "SCALAR" }
  ],
  "bufferViews": [
    { "buffer": 0, "byteOffset": 0, "byteLength": 48 },
    { "buffer": 0, "byteOffset": 48, "byteLength": 48 },
    { "buffer": 0, "byteOffset": 96, "byteLength": 12 }
  ],
  "buffers": [
    {
      "byteLength": 108,
      "uri": "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAABAAIAAAACAAMA"
    }
  ]
}
```

Two things are worth naming here.

**The coordinate system.** glTF is Y-up and right-handed: **X** goes right, **Y** goes up,
**Z** comes toward you. One unit is one metre. That is why the ground plane above had to be
rotated — a square drawn in X/Y stands upright like a wall, and turning it flat means
tipping it a quarter turn around X.

**Rotations are quaternions**, four numbers, not three angles. `[-0.7071, 0, 0, 0.7071]` is
−90° around X. Writing those by hand is unpleasant, and you are not expected to: the
formula for a rotation of angle *a* around a unit axis is
`[x·sin(a/2), y·sin(a/2), z·sin(a/2), cos(a/2)]`. For −90° around X that gives
sin(−45°) ≈ −0.7071 and cos(−45°) ≈ 0.7071.

**Naming nodes pays off.** `name` is optional, but this plugin's edit mode lists nodes by
name, and its locked-prefix setting matches on them. An unnamed node is one you cannot
talk about.

## Producing the numbers yourself

The one part you cannot type by hand is the buffer. Here is the whole trick, as a shell
command — it prints the base64 for a list of floats:

```bash
node -e '
const floats = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
console.log("byteLength", floats.byteLength);
console.log(Buffer.from(floats.buffer).toString("base64"));
'
```

For a model with several slices, concatenate them in the order your `bufferViews` claim,
and keep two rules in mind:

- **Offsets must be aligned.** A slice of 32-bit floats has to start at a byte offset
  divisible by 4, a slice of 16-bit integers at one divisible by 2. Put the floats first
  and the indices last and this takes care of itself.
- **`byteLength` on the buffer is the total**, and each `bufferView` must fit inside it.
  Be accurate here even though you may get away with being wrong: this plugin's loader
  takes however many bytes the `data:` URI actually decodes to and never checks your
  number — but the glTF validator and other viewers do, so a file that works here can fail
  elsewhere. A `bufferView` that reaches past the real data is a different matter and does
  break, visibly.

## What this block cannot do

- **No binary `.glb`.** A code block is text; a GLB is a container. Use a file for that.
- **No files beside it.** An inline block has no folder to look in, so every byte must be
  in the block itself, as a `data:` URI. A `.gltf` **file** in your vault does not have this
  limit — it may keep its geometry in a `.bin` next to it, the way exporters write it.
- **No Draco compression.** Meshopt-compressed files (`gltfpack -cc`) load fine — but as
  a *file*, not here: compressed data is binary, and a code block is text. Draco-compressed
  models are reported in plain language rather than failing obscurely.

## Where to go next

- Save a camera angle into the block with `view:` — see the main [README](../../README.md).
- Open a real exported model and read it with what you now know. Blender writes
  `scene.gltf` plus `scene.bin`; the JSON is the same shape as above, just longer.
- The full specification is
  [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) — surprisingly
  readable now that the vocabulary is familiar.
