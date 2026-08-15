# Four ways to show a model

A wiki-embed, exactly like a PDF:

![[models/ground-floor.gltf|260]]

A `3d` block, when you want a caption and a fixed height:

```3d
file: models/octahedron.stl
title: Octahedron (STL — no materials in the format)
height: 260
```

And glTF JSON written straight into the note, for a quick sketch:

```gltf
{ "asset": { "version": "2.0" }, "scene": 0,
  "scenes": [ { "nodes": [0] } ],
  "nodes": [ { "mesh": 0, "name": "Sketch" } ],
  "meshes": [ { "primitives": [ { "attributes": { "POSITION": 0 } } ] } ],
  "accessors": [ { "bufferView": 0, "componentType": 5126, "count": 3,
                   "type": "VEC3", "min": [0,0,0], "max": [1,1,0] } ],
  "bufferViews": [ { "buffer": 0, "byteOffset": 0, "byteLength": 36 } ],
  "buffers": [ { "byteLength": 36,
    "uri": "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAA" } ] }
```
