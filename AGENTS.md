# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, `../../_docs` relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

Obsidian-Plugin `three-d-codeblocks` („3D Codeblocks", v0.2.0) von Johannes Kaindl. Rendert
3D-Artefakte (GLB, glTF, STL) direkt in Obsidian — als eigene Ansicht, als Wiki-Embed oder in
`3d`-/`gltf`-Codeblöcken; Orbit/Zoom/Pan ohne die Notiz zu verlassen. three.js gebündelt;
Draco/Meshopt bewusst nicht unterstützt (worker-basiert, Obsidians Renderer verbietet Worker).

## Commands

```bash
npm run dev        # esbuild im Watch-/Dev-Modus
npm run build      # Typecheck + Production-Bundle
npm test           # Pfad-Guard + vitest run
npm run lint       # eslint src (0 Warnungen erlaubt)
npm run gate       # lint + typecheck(+test) + test + check:pure + check:bundle
npm run deploy     # build + Kopie nach $OBSIDIAN_PLUGIN_DIR
npm run smoke:gui  # GUI-Smoke gegen ein laufendes Obsidian (CDP; s. scripts/gui-smoke.ts)
npm run release    # Release via ../tools/release/ (braucht das Dach-Verzeichnis)
```

## Conventions

- Conventional Commits, deutsche Beschreibung erlaubt. Nur berührte Dateien stagen.
- Pure-Core-Trennung: `src/core/` bleibt Obsidian-frei (`npm run check:pure` erzwingt das); Tests mit vitest.

## Memory

- **SDD-Artefakte (seit 2026-07-16): Cockpit, nicht Repo** — Specs/Plans/Task-Reports leben im
  Coding-Cockpit des Maintainers (`$VAULT/25_Coding/3d-codeblocks/_SDD/`, CORE-META-14, maintainer-lokal).
  Sie tragen Arbeitskontext (Vault-Pfade, Schwester-Repo-Interna), der in einem public Repo niemandem nützt.
  Das Repo behält die Design-Essenz in dieser Datei + `CHANGELOG.md`.
- **Alt-Bestand:** `docs/superpowers/{specs,plans}/` ist eingefroren — nichts Neues dort ablegen.
- **Nie im Repo:** absolute Pfade außerhalb des Repos (`/Users/…`, Vault-Pfade) — Platzhalter nutzen
  (`$VAULT/…`, `~/…`, repo-relativ). Herkunftsnachweise als Repo-Name + `Datei:Zeile` sind dagegen erwünscht.
  Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).

## Dach-Kontext (obsidian-plugins)

Dieses Repo liegt unter einem Koordinations-Dach. Vor dem Lösen eines Problems: `../AGENTS.md`
(Kit-first-Regel), `../REGISTRY.md` (Lösungs-Registry) und `../KIT-MATRIX.md` prüfen; vor
UI-Arbeit ist `../UI-STANDARD.md` verbindlich.
