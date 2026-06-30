# Ortho UX Tester

Persona-driven UX testing for orthodontic practice management prototypes.

Paste a **Figma share link** or an **HTML prototype URL**, pick a practice persona, and get a **rated UX friction report** grounded in real practitioner complaints and Nielsen Norman Group (NNG) usability heuristics — downloadable as PDF.

## What it does

1. **Captures** the prototype — Figma via REST API (renders frames to PNG), HTML via a headless-browser screenshot + DOM outline.
2. **Loads a persona** (one of four) plus the relevant slice of a grounding corpus of real complaint patterns.
3. **Runs the persona agent** (Claude) over a fixed task list, producing structured findings: expected vs actual behavior, severity, the NNG heuristic violated, and a concrete fix with a citation.
4. **Renders a report**, sorted by severity, with a one-click **Download PDF**.

### Personas (one each, per the spec)

| Persona | Focus |
|---|---|
| TC · Small Independent | Live treatment presentation under sales pressure |
| TC · Large OSO | Scale across locations, corporate templates, leaderboards |
| FD · Small Independent | Phones, 30-second reschedules, ortho-specific scheduling |
| FD · Large OSO | Call-center bookings, sync, location-scoped views |

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open the printed URL (e.g. http://localhost:3000 — or 3001 if 3000 is taken).

### Required env (`.env.local`)

- `ANTHROPIC_API_KEY` — runs the persona agents. https://console.anthropic.com/
- `FIGMA_TOKEN` — reads Figma share links via REST. *Figma → Settings → Security → Personal access tokens* (`file_content:read`). Not needed if you only test HTML links.
- `ANALYSIS_MODEL` — optional, defaults to `claude-opus-4-8` (accuracy). Use `claude-sonnet-4-6` for cheaper runs.

### HTML capture — local Chrome

The HTML path uses a headless browser. Locally it points at installed Chrome:
`/Applications/Google Chrome.app/...` (macOS). To use a different binary, set `CHROMIUM_LOCAL=/path/to/chrome`.

## Build the grounding corpus

A seed corpus ships in `data/corpus.json`. To expand it from the live web (Claude with server-side web search, paraphrased + tagged per the spec):

```bash
npm run build-corpus
```

This searches Reddit, Glassdoor/Indeed, AAO forums, and PM-software review threads for each role/size, paraphrases the patterns (no verbatim copyright), tags them, and merges into `data/corpus.json`.

## Deploy (Vercel)

```bash
vercel
```

Set `ANTHROPIC_API_KEY` and `FIGMA_TOKEN` in the Vercel project env. The HTML capture path auto-switches to `@sparticuz/chromium-min` on serverless (`CHROMIUM_REMOTE_PACK` pins the binary). The analyze route runs with `maxDuration = 300` — use a plan that allows it.

## Architecture & scope (MVP)

```
app/
  page.tsx                 form + report
  api/analyze/route.ts     POST { url, persona } -> { report }
lib/
  personas.ts              4 persona system prompts + task lists
  heuristics.ts            NNG heuristic loader
  corpus.ts                corpus query by persona
  figma.ts                 Figma REST capture
  html-capture.ts          Playwright screenshot + DOM outline
  analyze.ts               orchestrator + Claude structured-output call
  types.ts                 FrictionReport schema
data/
  heuristics.json          NNG heuristics (names + source URLs; no article text)
  corpus.json              tagged complaint corpus (seed; expand via build-corpus)
scripts/
  build-corpus.ts          Claude + web-search corpus builder
```

**v1 = screenshot + structure analysis.** The agent reasons over rendered screens and the DOM/frame outline; it does not yet drive the live DOM. Designed so autonomous click-through (via a browser service like Browserbase) bolts on later for high-value flows.

**Grounding & honesty.** Findings cite NNG heuristics by URL (article text is not reproduced) and tie to real complaint patterns. Output is synthetic — per the spec, calibrate top-severity findings against 1–2 real practitioners before acting.
```
