#!/bin/sh
# Re-vendor kit modules from ../obsidian-kit. Run after kit updates.
#
# CORE-META-22 (verbindlich seit 2026-08-30): gelesen wird aus einer FESTEN GIT-REF, nicht
# aus dem Arbeitsstand des Nachbar-Repos. Ein `cp $KIT/src/...` liefert, was dort gerade
# ausgecheckt ist — bei einem Repo mitten in einer Migration also etwas, das in keinem Commit
# steht. Probe fuer die Korrektheit: ein zweiter Lauf darf keinen Diff erzeugen.
#
# Warum 0.27.0 und nicht der neueste Tag: seit Kit 0.28.0 sind die `pure/`-Module nach
# `code-kit` gezogen — `0.28.0:src/pure/num.ts` und `settings_schema.ts` existieren dort
# NICHT MEHR. 0.27.0 traegt alle fuenf hier benoetigten Dateien, und `confirm.ts` ist
# zwischen 0.27.0 und 0.28.0 byte-identisch (geprueft 2026-08-30). Ein Umzug der beiden
# pure-Module auf code-kit als Quelle ist ein eigener Vorgang, kein Nebeneffekt hiervon.
set -e

KIT="${KIT_DIR:-../obsidian-kit}"
KIT_REF="${KIT_REF:-0.27.0}"
# help-setting.ts (Hilfe-Zeile, UI-STANDARD §8) gibt es erst ab 0.43.0; die uebrigen Module
# bleiben auf KIT_REF. Eigene Ref, damit kein Modul still mit angehoben wird.
KIT_REF_HELP="${KIT_REF_HELP:-0.43.0}"

[ -d "$KIT/.git" ] || { echo "Kit-Repo nicht gefunden unter $KIT (KIT_DIR setzen)" >&2; exit 1; }
git -C "$KIT" rev-parse --verify --quiet "${KIT_REF}^{commit}" >/dev/null \
  || { echo "Ref '$KIT_REF' existiert nicht in $KIT (KIT_REF setzen)" >&2; exit 1; }

VER="$KIT_REF"
SHA=$(git -C "$KIT" rev-parse --short "${KIT_REF}^{commit}")

# fetch <kit-relativer-pfad> <zieldatei>
# Schreibt NUR bei Erfolg. Der Fehlschlag ist sonst nicht still, sondern schlimmer: er
# hinterlaesst eine Datei, die nur aus dem Herkunftsstempel besteht und wie ein gueltiges
# Vendoring aussieht (Befund finance-ledger, 2026-08-27).
fetch() {
  src="$1"; dst="$2"; ref="${3:-$KIT_REF}"
  git -C "$KIT" cat-file -e "$ref:src/$src" 2>/dev/null \
    || { echo "FEHLT in $KIT_REF: src/$src — nichts geschrieben" >&2; exit 1; }
  tmp="$dst.tmp"
  printf '// vendored from obsidian-kit@%s, src/%s — do not hand-edit; re-vendor via tools/sync-kit.sh\n' "$ref" "$src" > "$tmp"
  git -C "$KIT" show "$ref:src/$src" >> "$tmp"
  [ -s "$tmp" ] || { echo "leeres Ergebnis fuer src/$src — nichts geschrieben" >&2; rm -f "$tmp"; exit 1; }
  mv "$tmp" "$dst"
  echo "vendored obsidian-kit@$ref/$src"
}

mkdir -p src/vendor/kit src/vendor/kit-obsidian

# num.ts ist keine eigenstaendige Uebernahme, sondern Pflicht-Abhaengigkeit:
# settings_schema.ts importiert clampInt daraus (src/pure/settings_schema.ts:52).
for m in num settings_schema; do
  fetch "pure/$m.ts" "src/vendor/kit/$m.ts"
done

for m in confirm folder-suggest settings_walker; do
  fetch "obsidian/$m.ts" "src/vendor/kit-obsidian/$m.ts"
done

fetch "obsidian/help-setting.ts" "src/vendor/kit-obsidian/help-setting.ts" "$KIT_REF_HELP"
HELP_SHA=$(git -C "$KIT" rev-parse --short "${KIT_REF_HELP}^{commit}")

cat > src/vendor/kit/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "num.ts, settings_schema.ts",
  "note": "Verbatim snapshot aus der Git-Ref $VER (CORE-META-22: feste Ref, nicht Arbeitsstand). Never hand-edit. Re-vendor via tools/sync-kit.sh. num.ts kommt nur als Abhaengigkeit mit: settings_schema.ts importiert clampInt daraus. ACHTUNG: ab Kit 0.28.0 liegen diese beiden Module nicht mehr im Kit, sondern in code-kit — ein Anheben der Ref erfordert vorher einen Quellenwechsel. kit-obsidian/ siehe dortige VENDOR.json."
}
JSON
cat > src/vendor/kit-obsidian/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "confirm.ts, folder-suggest.ts, settings_walker.ts, help-setting.ts",
  "perFile": { "help-setting.ts": { "version": "$KIT_REF_HELP", "sha": "$HELP_SHA" } },
  "note": "help-setting.ts liegt auf eigener Ref (perFile), die uebrigen Module auf version. Verbatim snapshot aus der Git-Ref $VER (CORE-META-22: feste Ref, nicht Arbeitsstand). Never hand-edit. Re-vendor via tools/sync-kit.sh. confirm.ts ist zwischen 0.27.0 und 0.28.0 byte-identisch. kit/ siehe dortige VENDOR.json."
}
JSON
echo "VENDOR.json → $VER ($SHA)"
