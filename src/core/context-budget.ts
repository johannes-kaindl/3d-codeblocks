// LRU-Auswahl fuer das WebGL-Kontext-Budget. Pure.
//
// Browser deckeln gleichzeitige WebGL-Kontexte (~8-16) und schiessen darueber
// hinaus stillschweigend die aeltesten ab. Statt das dem Browser zu ueberlassen,
// waehlt diese Funktion bewusst aus, welche Viewports zum Poster degradiert werden.

export interface ActiveContext {
  id: string;
  lastUsedAt: number;
}

export function pickEvictions(active: ActiveContext[], limit: number): string[] {
  // limit 0 = off: die Begrenzung ist deaktiviert, nie verdraengen.
  if (limit <= 0) return [];
  const excess = active.length - limit;
  if (excess <= 0) return [];

  return [...active]
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.id.localeCompare(b.id))
    .slice(0, excess)
    .map((entry) => entry.id);
}
