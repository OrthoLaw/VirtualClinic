/**
 * Grounding-corpus builder.
 *
 * Uses Claude with the server-side web_search tool to find REAL complaint/praise
 * patterns from Reddit, Glassdoor/Indeed, AAO forums, and PM-software review threads,
 * paraphrase them (no verbatim copyright), tag per the spec schema, and merge the
 * result into data/corpus.json.
 *
 * Run: ANTHROPIC_API_KEY=... npm run build-corpus
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CORPUS_PATH = join(process.cwd(), "data", "corpus.json");

const SEGMENTS = [
  { role: "TC", size: "Small Independent" },
  { role: "TC", size: "Large OSO" },
  { role: "Front Desk", size: "Small Independent" },
  { role: "Front Desk", size: "Large OSO" },
];

const SCHEMA_HINT = `Return ONLY a JSON array. Each item:
{
  "role": "<role>",
  "practice_size": "<size>",
  "theme": "scheduling conflict | insurance friction | treatment presentation | multi-provider calendar | communication | software switching cost | training burden | other",
  "sentiment": "frustration | praise | neutral observation",
  "source": "<platform + rough date, e.g. 'reddit/orthodontics 2024'>",
  "pattern": "<one-sentence PARAPHRASE of the pattern — never a verbatim quote>"
}`;

async function scrapeSegment(
  client: Anthropic,
  role: string,
  size: string,
): Promise<any[]> {
  const prompt = `You are building a grounded research corpus for orthodontic practice management software UX.

Search the web for REAL operational complaints and praise from people in this role:
- Role: ${role}
- Practice type: ${size === "Large OSO" ? "large multi-location orthodontic-only group (OSO, 5+ locations)" : "small independent practice (1-2 locations)"}

Sources to prioritize: Reddit (r/orthodontics, r/dentaloffice), Glassdoor/Indeed reviews for "Treatment Coordinator"/"Scheduling Coordinator"/"Front Desk", AAO member discussion, and complaint/praise threads for Dolphin, Dentrix Ascend, Cliniconnect, Greyfinch, OrthoTrac, Open Dental.

Find 8-12 distinct patterns about software/workflow friction (or praise). PARAPHRASE each — do not quote verbatim (copyright). Tag each per the schema.

${SCHEMA_HINT}`;

  const res = await client.messages.create({
    model: process.env.ANALYSIS_MODEL || "claude-sonnet-4-6",
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 } as any],
    messages: [{ role: "user", content: prompt }],
  });

  // Grab the final text block; extract the JSON array.
  const text = res.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    console.warn(`  ! no JSON array for ${role}/${size}`);
    return [];
  }
  try {
    const arr = JSON.parse(match[0]);
    return Array.isArray(arr) ? arr : [];
  } catch {
    console.warn(`  ! JSON parse failed for ${role}/${size}`);
    return [];
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set.");
    process.exit(1);
  }
  const client = new Anthropic();
  const existing = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
  const all: any[] = [...existing.entries];

  for (const seg of SEGMENTS) {
    console.log(`Scraping ${seg.role} / ${seg.size} ...`);
    const found = await scrapeSegment(client, seg.role, seg.size);
    // normalize role/size to our canonical values
    for (const e of found) {
      e.role = seg.role;
      e.practice_size = seg.size;
    }
    console.log(`  + ${found.length} patterns`);
    all.push(...found);
  }

  // Dedupe by (role,size,first 40 chars of pattern).
  const seen = new Set<string>();
  const deduped = all.filter((e) => {
    const k = `${e.role}|${e.practice_size}|${(e.pattern || "").slice(0, 40)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const out = {
    note: existing.note,
    version: `built-${new Date().toISOString().slice(0, 10)}`,
    entries: deduped,
  };
  writeFileSync(CORPUS_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${deduped.length} entries to ${CORPUS_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
