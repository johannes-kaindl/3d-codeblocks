# Entscheidungen

Das Warum hinter Bauentscheidungen, die man dem Code nicht ansieht. Eine Entscheidung steht hier mit Anlass, Unterschied und Grund; sie ist ein Anlass nachzusehen, kein Grund (AGENTS.md des Dachs).

## Zaun-Scanner aus dem Kit, Rundenkette teils beim Träger (2026-11-14)

Anlass: Der Eigenbau `fence.ts` (entfallen) und die Kette in `panel-state.ts` (Ordner `src/core/shapes/`) waren die Vorlage für `fence-scan` (obsidian-kit 0.80.1) und `panel-session` (code-kit 0.54.0); beide Fassungen liefen parallel (Drift-Gefahr, Bibliothek ab Eins). Verglichen wurde Zeile für Zeile.

Zaun-Scanner (`fence.ts` entfällt, `listFences`/`findFenceAt`/`fenceFor` kommen aus `vendor/kit/fences`; bis obsidian-kit 0.95.0 lag der Leser als `fence-scan` im Kit). Drei Unterschiede, alle zugunsten der Kit-Fassung angeglichen, weil sie CommonMark genauer folgt und der Eigenbau an keiner Stelle absichtlich lockerer war:

- Einzug des Zauns: Eigenbau `\s{0,3}` (ein Tabulator zählte als Einzug), Kit ` {0,3}`. In CommonMark ist ein Tabulator vier Spalten, der Zaun wäre ein eingerückter Codeblock. Ein mit Tabulator eingerückter Zaun wird nicht mehr als Block gefunden.
- Schlusszaun: Eigenbau `\s*` hinter dem Zaun, Kit `[ \t]*`. Das Kit lässt nur Leerzeichen und Tabulatoren zu, wie CommonMark.
- Ein BOM vor der ersten Zeile versteckt einen Zaun in Zeile 1 im Eigenbau, im Kit nicht.

Belegt in `tests/core/shapes/fence.test.ts` (Abschnitt „Unterschied zum früheren Eigenbau“). `locateShapesFence` in `shapes-convert.ts` und die Zitat-/Listen-Suche in `references.ts` bleiben eigen: sie sind bewusst zeilenstreng beziehungsweise kennen Präfixe, die der Kit-Scanner nicht kennt.

Panel-Zustand: `followTarget` (State plus `kept`) und `baseTextForRefine` stützen sich auf die Kit-Fassung, `kind()` im Prompt-Panel auf `taskKind`, `settleTarget()` auf das Kit-`settleTarget`. Die Panel-Tests blieben unverändert.

Rundenkette (`resolveChain`, `chainOf`, `acceptText`) bleibt beim Träger. Gründe, jeder einzeln:

- Meldungen: Das Kit (`chainOf`, `acceptChain`) liefert die Texte „the round chain is broken …“, „nothing to apply“ und das Präfix „round N:“ fest englisch. Das Plugin zeigt sie in der Sprache der Oberfläche (`core.rounds.*`, Deutsch/Englisch). Ohne einen Problem-Code im Kit-Ergebnis wäre das Übersetzen ein Abgleich gegen Satzanfänge. Kit-Wunsch an den Master: Ergebnis mit `code` und Zahlen (`round`, `ref`) statt nur `problem`, oder ein `labelOf`/Texte-Parameter wie bei `measured-quality`.
- Teilkette: Bei kaputter Kette liefert der Eigenbau, was bis dahin gelesen wurde (`chainOf` im Test), das Kit meldet nur den Fehler. `accept.ts` liest daran die Wurzelart.
- Mehrere Probleme: `applyChanges` meldet mehrere Probleme, der Eigenbau stellt jedem die Rundennummer voran (`problems: string[]`), das Kit-`Step` trägt ein `problem`.

`run-slot` (code-kit) wurde geprüft und nicht übernommen: Der Stopp-Knopf des Panels bricht nur das Signal ab (`controller?.abort()`) und lässt den Platz belegt, bis `finally` im Lauf aufräumt (`this.controller === ctrl` setzt `settleTarget`, `renderAll` und den Fokus). `RunSlot.abort()` gibt den Platz sofort frei, danach liefe dieses `finally` nicht mehr. Ein Übernehmen bräuchte im Kit ein Abbrechen ohne Freigeben.

## Messzeile über Kit-`measured-quality`, Stempel im Kit-Schema (2026-11-14)

Suche, Rangfolge und Fehlerhinweis der Messzeile (`findMeasurement`, `qualityLine`, `failureHint`) kommen aus `vendor/kit/measured-quality` (code-kit 0.55.0, Einzelpin). Tabelle `MEASUREMENTS` und die Sätze (`quality.*` in der i18n) bleiben beim Plugin; `quality.ts` hält die alte Signatur, damit Panel und Tests unverändert bleiben. Die Cloud-Familie `claude` geht als `unmeasuredFamilies` hinein (die Familie gewinnt vor einem Modellnamen aus der Tabelle).

`promptSha` ist jetzt `promptFingerprint(system, vorlage)` mit NUL-Trenner (vorher ohne Trenner aneinandergehängt). Die Prompts blieben, `prompt-sha.test.ts` pinnt sie byteweise; deshalb keine Neumessung, die vier Zeilen bekommen nur den neuen Stempel (create `7822186a04037e50`, refine `875cdf88016d175c`). Aufgezeichnete Fixtures behalten ihren Stempel im alten Schema (`RECORDED_SHA_OLD_SCHEME` im Replay-Test); Aufzeichnungen werden nicht umgeschrieben. Vermerk in `docs/LAB.md`.
