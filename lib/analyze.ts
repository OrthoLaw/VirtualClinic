import Anthropic from "@anthropic-ai/sdk";
import type { FrictionReport, PersonaId, SourceKind } from "./types";
import { PERSONAS } from "./personas";
import { heuristicsPromptBlock } from "./heuristics";
import { corpusForPersona } from "./corpus";
import { captureFigma, parseFigmaKey } from "./figma";
import { captureHtml } from "./html-capture";

export function detectSource(url: string): SourceKind {
  return /figma\.com/.test(url) ? "figma" : "html";
}

// Structured-output tool: forces Claude to return a valid FrictionReport.
const REPORT_TOOL = {
  name: "submit_report",
  description: "Submit the structured UX friction report for this prototype.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "2-3 sentence executive read of the biggest UX risks for THIS persona.",
      },
      case_acceptance_risk: {
        type: "string",
        description:
          "For TC personas: how these issues threaten case acceptance / conversion. For FD personas: how they threaten chair utilization / scheduling integrity. 1-2 sentences.",
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task: { type: "string" },
            step: { type: "string" },
            expected_behavior: { type: "string" },
            actual_behavior: { type: "string" },
            severity: {
              type: "string",
              enum: ["blocks_task", "slows_task", "annoys_but_tolerable"],
            },
            corpus_grounding: {
              type: "string",
              description: "Which real-world complaint pattern this matches (reference the provided corpus).",
            },
            heuristic: {
              type: "string",
              description: "The heuristic id violated, e.g. nng-1.",
            },
            heuristic_name: { type: "string" },
            suggested_fix: { type: "string" },
            fix_source: {
              type: "string",
              description: "Citation URL from the provided NNG heuristics list.",
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            figma_location: {
              type: "object",
              description:
                "FIGMA ONLY: where on a frame this issue is, so we can pin a comment. Omit for HTML. frame_label must exactly match one of the provided frame labels. nx,ny = top-left of the offending area; nw,nh = its size; all normalized 0..1 within that frame.",
              properties: {
                frame_label: { type: "string" },
                nx: { type: "number" },
                ny: { type: "number" },
                nw: { type: "number" },
                nh: { type: "number" },
              },
              required: ["frame_label", "nx", "ny", "nw", "nh"],
            },
          },
          required: [
            "task",
            "step",
            "expected_behavior",
            "actual_behavior",
            "severity",
            "corpus_grounding",
            "heuristic",
            "heuristic_name",
            "suggested_fix",
            "fix_source",
            "confidence",
          ],
        },
      },
    },
    required: ["summary", "findings"],
  },
} as const;

function buildSystemPrompt(persona: PersonaId): string {
  const p = PERSONAS[persona];
  return `${p.systemPrompt}

---
YOU ARE USABILITY-TESTING A PROTOTYPE. You will be shown screenshot(s) and a structural outline of the screens. You cannot click in v1 — reason from what you see and from your deep operational experience: predict what WOULD happen at each step and where it WOULD break.

GROUND EVERY FINDING. For each issue:
1. Tie it to a real-world complaint pattern from the CORPUS below (don't invent friction that doesn't match how people actually complain).
2. Map it to exactly one NNG usability heuristic from the HEURISTICS list and cite that heuristic's source URL in fix_source.
3. Rate severity honestly: blocks_task only if it actually stops you; most things are slows_task or annoys_but_tolerable. Do NOT inflate.
4. Set confidence: high if you can see the problem directly in the screenshot/structure; medium if it's a strong inference; low if it's a guess about behavior you can't observe.

Be specific and actionable. A practice owner should be able to hand each suggested_fix to a designer. Aim for 4-10 findings — quality over quantity. If the prototype is genuinely good at something, it's fine to have fewer findings; don't manufacture issues.

=== NNG HEURISTICS (map + cite these) ===
${heuristicsPromptBlock()}

=== GROUNDING CORPUS (real complaint patterns for your role/size) ===
${corpusForPersona(persona)}

Call submit_report exactly once with your findings.`;
}

export async function analyze(
  url: string,
  persona: PersonaId,
  focus?: string,
): Promise<FrictionReport> {
  const kind = detectSource(url);
  if (kind === "figma" && !parseFigmaKey(url)) {
    throw new Error("That looks like a Figma URL but no file key could be parsed.");
  }

  const evidence =
    kind === "figma" ? await captureFigma(url) : await captureHtml(url);

  if (evidence.images.length === 0) {
    throw new Error(
      "No screenshots could be captured from that link. For Figma, confirm the file is shared; for HTML, confirm the URL loads.",
    );
  }

  const p = PERSONAS[persona];
  const client = new Anthropic();

  const cleanFocus = focus?.trim();
  // When the user supplies focus, lead with it and treat the persona's default
  // tasks as secondary context; otherwise just run the default task list.
  const taskBlock = cleanFocus
    ? `PRIMARY FOCUS — the team specifically wants you to test this:\n"${cleanFocus}"\n\nGround your walkthrough in that focus. Interpret which screens relate to it and stay on it. Use these standard ${p.label} tasks only as secondary context where relevant:\n${p.defaultTasks
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n")}\n\nIf the captured screens clearly don't cover the focus area, say so plainly in the summary rather than forcing unrelated findings.`
    : `Walk through this prototype as yourself. Run these tasks and log friction:\n${p.defaultTasks
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n")}`;

  // Figma only: tell the model which frame each screenshot is, and to tag every
  // finding with a normalized location so we can pin a comment to the frame.
  const figmaBlock =
    kind === "figma" && evidence.frames?.length
      ? `\n\nFRAME INDEX (screenshots are attached in this order; use these exact labels for figma_location.frame_label):\n${evidence.frames
          .map((f, i) => `Screen ${i + 1}: "${f.label}"`)
          .join(
            "\n",
          )}\n\nFor EVERY finding, set figma_location: pick the frame_label where the issue appears and give a normalized box (nx,ny = top-left, nw,nh = size, all 0..1) around the offending element. Estimate from the screenshot; approximate is fine.`
      : "";

  // User message = task/focus block + structure + the screenshots.
  const content: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text: `${taskBlock}\n\nSTRUCTURAL OUTLINE of what was captured:\n${evidence.structure}\n\nCapture note: ${evidence.note}${figmaBlock}\n\nScreens are attached below.`,
    },
    ...evidence.images.map(
      (img) =>
        ({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: img.base64 },
        }) as Anthropic.ImageBlockParam,
    ),
  ];

  const res = await client.messages.create({
    model: process.env.ANALYSIS_MODEL || "claude-sonnet-4-6",
    max_tokens: 8000,
    system: buildSystemPrompt(persona),
    tools: [REPORT_TOOL as any],
    tool_choice: { type: "tool", name: "submit_report" },
    messages: [{ role: "user", content }],
  });

  const toolUse = res.content.find((b: any) => b.type === "tool_use") as any;
  if (!toolUse) throw new Error("Model did not return a structured report.");
  const data = toolUse.input;

  return {
    persona,
    persona_label: p.label,
    source_kind: kind,
    source_url: url,
    summary: data.summary ?? "",
    case_acceptance_risk: data.case_acceptance_risk,
    // Defensive: the model (or a max_tokens truncation) could yield a non-array.
    findings: Array.isArray(data.findings) ? data.findings : [],
    evidence_note: evidence.note,
    generated_at: new Date().toISOString(),
    figma_frames: evidence.frames,
    figma_file_key: evidence.fileKey,
  };
}
