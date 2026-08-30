#!/bin/sh
# Re-vendor kit modules from ../obsidian-kit. Run after kit updates.
set -e

KIT="${KIT_DIR:-../obsidian-kit}"
[ -d "$KIT/src/pure" ] || { echo "Kit nicht gefunden unter $KIT (KIT_DIR setzen)" >&2; exit 1; }
# ⚠️ Dieses Skript vendored IMMER den aktuellen Kit-HEAD, nicht den gepinnten Stand.
# Am 2026-08-30 stand das Kit auf 0.28.0, src/vendor/kit/ aber auf 0.27.0 — ein Lauf haette
# num.ts und settings_schema.ts stillschweigend mit angehoben. Wer nur EIN Modul nachziehen
# will, prueft vorher, was sich sonst noch aendert:
#   for f in ...; do diff <(tail -n +2 src/vendor/<f>.ts) $KIT/src/<f>.ts; done
# Die dauerhafte Loesung ist eine feste Kit-Ref (offener Task „sync-kit.sh auf feste
# Kit-Ref umstellen"); bis dahin ist dieser Lauf eine bewusste Entscheidung, kein Routineschritt.
VER=$(node -p "require('$KIT/package.json').version")
# Der Pin-SHA ist bewusst der Kit-HEAD, NICHT der Tag-SHA von $VER (0.27.0: fbb42d4 statt
# 548041b). So erzeugen es alle Form-A-Skripte im Workspace, und tools/pin_find.py des Dachs
# loest den Tag inhaltsbasiert auf, ist also nicht auf den SHA angewiesen. Wer hier auf den
# Tag umstellt, weicht von acht Schwester-Repos ab — dann bitte dort mit.
SHA=$(git -C "$KIT" rev-parse --short HEAD)

stamp() { # stamp <vendored-file> <kit-relative-path>
  header="// vendored from obsidian-kit@$VER, $2 — do not hand-edit; re-vendor via tools/sync-kit.sh"
  printf '%s\n' "$header" | cat - "$1" > "$1.tmp"
  mv "$1.tmp" "$1"
}

mkdir -p src/vendor/kit src/vendor/kit-obsidian

# num.ts ist keine eigenstaendige Uebernahme, sondern Pflicht-Abhaengigkeit:
# settings_schema.ts importiert clampInt daraus (src/pure/settings_schema.ts:52).
for m in num settings_schema; do
  cp "$KIT/src/pure/$m.ts" "src/vendor/kit/$m.ts"
  stamp "src/vendor/kit/$m.ts" "src/pure/$m.ts"
  echo "vendored obsidian-kit@$VER/pure/$m.ts"
done

for m in confirm folder-suggest settings_walker; do
  cp "$KIT/src/obsidian/$m.ts" "src/vendor/kit-obsidian/$m.ts"
  stamp "src/vendor/kit-obsidian/$m.ts" "src/obsidian/$m.ts"
  echo "vendored obsidian-kit@$VER/obsidian/$m.ts"
done

cat > src/vendor/kit/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "num.ts, settings_schema.ts",
  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh. version/sha gelten AUSSCHLIESSLICH fuer die unter \"vendored\" gelisteten Dateien. num.ts kommt nur als Abhaengigkeit mit: settings_schema.ts importiert clampInt daraus. kit-obsidian/ siehe dortige VENDOR.json."
}
JSON
cat > src/vendor/kit-obsidian/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "confirm.ts, folder-suggest.ts, settings_walker.ts",
  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh. version/sha gelten AUSSCHLIESSLICH fuer die unter \"vendored\" gelisteten Dateien. kit/ siehe dortige VENDOR.json."
}
JSON
echo "VENDOR.json → $VER ($SHA)"
