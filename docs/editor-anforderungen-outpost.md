# Editor-Anforderungen aus dem outpost-Roundtrip (Konsumenten-Kontrakt)

**Stand 2026-07-25.** Die Gegenseite ist fertig und auf `main` gemergt: `outpost-worldbuilding`
exportiert seine Weltmodell-Views pure Python (`src/comfyui_client/outpost/render3d/gltf.py`)
und übersetzt Editor-Edits per `scripts/outpost_floorplan.py --diff <etage>.edit.gltf` in
Zielwerte für sein Geometrie-SSOT (`data.py`). Dieses Dokument ist der **Vertrag, den der
3d-codeblocks-Editor erfüllen muss**, damit der Roundtrip funktioniert — Input für den
anstehenden Brainstorm „Editor-Modus" (Cockpit-§▶). Spec der Gegenseite:
`outpost-worldbuilding/docs/superpowers/specs/2026-07-24-editor-roundtrip-design.md`.

## Was der Editor als Input bekommt (garantiert vom Generator)

- glTF 2.0, JSON mit eingebettetem Buffer (data-URI), natives Y-up, keine Texturen/Animationen/Skins.
- **Ein Node pro Raum, `name` = Raum-Slug** (z. B. `privat-herd`). Mesh-Vertices lokal um den
  Raum-Mittelpunkt zentriert; der Node trägt `translation` = Mittelpunkt, `scale` = `[1,1,1]`,
  keine Rotation.
- Kuppeln hängen als **Kind-Node `<slug>__dome`** am Raum-Node (translation `[0,0,0]`) und
  wandern bei Raum-Edits automatisch mit.
- `haus.gltf` enthält zusätzlich Umgebungs-Nodes mit Prefix **`env__`** (Gelände, See, Bäume …).
- Ein Material pro Node (`baseColorFactor`, `alphaMode: BLEND` bei Alpha < 1 — Glasdächer).

## Was der Editor können muss (Muss-Anforderungen)

1. **Edits ausschließlich als TRS am Raum-Node**: Verschieben → `translation`, Größe → `scale`.
   Mesh-/Vertex-Daten niemals anfassen.
2. **Speichern als `<etage>.edit.gltf`** neben dem Original (`eg.gltf` → `eg.edit.gltf`) —
   **nie in-place**: die Originale werden bei jeder Regeneration überschrieben.
3. **Node-Namen unverändert lassen** — der Slug ist der Schlüssel des gesamten Diffs.
4. **TRS-Properties schreiben, keine `matrix`** — Nodes mit `matrix` kann der Diff nicht
   auswerten (er meldet sie nur als Warnung).
5. **Keine Nodes hinzufügen oder löschen** — außerhalb des Kontrakts; der Diff warnt und
   liefert dafür keine Zielwerte.

## Was der Editor wissen sollte (Soll/Kontext)

- **Rotationen sind erlaubt, aber wirkungslos für die Übernahme**: das outpost-Datenmodell
  sind achsenparallele Boxen (AABBs); der Diff flaggt Rotationen als „nicht abbildbar" ohne
  Zielwerte. Sinnvoll: Rotation im Editor gar nicht erst anbieten oder sichtbar als
  „wird nicht übernommen" markieren.
- `env__*`- und `*__dome`-Nodes ignoriert der Diff — Edits daran gehen verloren. Sinnvoll:
  im Editor sperren oder ausblenden.
- Toleranz der Gegenseite: Abweichungen < 1 mm gelten als unverändert — Float-Rauschen beim
  Speichern ist unkritisch.
- Rendering-Erkenntnis (bereits in LESSONS): Notes müssen glTF als `![[…]]`-**Embed**
  referenzieren; reine `[[…]]`-Links rendern nicht.

## Abnahme-Test (erster echter Anwendungsfall)

`outpost-worldbuilding` → `weltmodell/3d/eg.gltf` öffnen, einen Raum (z. B. `privat-herd`)
verschieben, als `eg.edit.gltf` speichern. Dann liefert
`uv run python scripts/outpost_floorplan.py --diff weltmodell/3d/eg.edit.gltf` (im
outpost-Repo) eine Prosa-Änderungszeile plus fertige `x_min…z_max`-Zielwerte. Danach als
echte Aufgabe: die 6 bekannten Raum-Überlappungen (`--check`) im Editor auseinanderschieben.
