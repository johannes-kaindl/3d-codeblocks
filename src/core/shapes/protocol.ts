// LLM-Antworttext → JSON. Pure. Inkrement 3 ergänzt hier die Prompts; heute nur das
// tolerante Lesen, das schon die Golden-Tests über die Spike-Aufzeichnung brauchen.

export function readPartsAnswer(text: string): { ok: true; parts: unknown[] } | { ok: false; reason: string } {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```[a-zA-Z]*/g, "");
  const start = clean.search(/[[{]/);
  if (start < 0) return { ok: false, reason: "no JSON in the answer" };
  const close = clean[start] === "{" ? "}" : "]";
  const end = clean.lastIndexOf(close);
  let parsed: unknown;
  try {
    if (end < start) throw new Error("incomplete");
    parsed = JSON.parse(clean.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "the JSON is incomplete or broken" };
  }
  if (Array.isArray(parsed)) return { ok: true, parts: parsed };
  const parts = (parsed as { parts?: unknown }).parts;
  return Array.isArray(parts) ? { ok: true, parts } : { ok: false, reason: "the JSON has no `parts` list" };
}
