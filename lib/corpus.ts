import corpus from "@/data/corpus.json";
import type { PersonaId } from "./types";

export interface CorpusEntry {
  role: string;
  practice_size: string;
  theme: string;
  sentiment: string;
  source: string;
  pattern: string;
}

const PERSONA_FILTER: Record<PersonaId, { role: string; size: string }> = {
  "tc-small": { role: "TC", size: "Small Independent" },
  "tc-oso": { role: "TC", size: "Large OSO" },
  "fd-small": { role: "Front Desk", size: "Small Independent" },
  "fd-oso": { role: "Front Desk", size: "Large OSO" },
};

const entries = corpus.entries as CorpusEntry[];

// Pull the most relevant corpus entries for a persona (matching role+size first,
// then same-role other-size as backfill), formatted for the system prompt.
export function corpusForPersona(persona: PersonaId, limit = 8): string {
  const f = PERSONA_FILTER[persona];
  const exact = entries.filter(
    (e) => e.role === f.role && e.practice_size === f.size,
  );
  const sameRole = entries.filter(
    (e) => e.role === f.role && e.practice_size !== f.size,
  );
  const chosen = [...exact, ...sameRole].slice(0, limit);
  if (chosen.length === 0) return "(no corpus entries available)";
  return chosen
    .map(
      (e) =>
        `- [${e.theme} · ${e.sentiment}] ${e.pattern} (source: ${e.source})`,
    )
    .join("\n");
}
