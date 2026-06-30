import { NextRequest, NextResponse } from "next/server";
import { postComments, type CommentItem } from "@/lib/figma";
import type { FrictionReport, Finding, Severity } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const SEV_TAG: Record<Severity, string> = {
  blocks_task: "🔴 BLOCKS TASK",
  slows_task: "🟠 SLOWS TASK",
  annoys_but_tolerable: "🟡 MINOR",
};

// Compose the comment body a designer will read in Figma.
function messageFor(f: Finding, persona: string): string {
  return [
    `${SEV_TAG[f.severity]} — ${f.task}`,
    ``,
    `Expected: ${f.expected_behavior}`,
    `Actual: ${f.actual_behavior}`,
    ``,
    `Fix: ${f.suggested_fix}`,
    `Heuristic: ${f.heuristic_name} (${f.fix_source})`,
    ``,
    `— ${persona} · approx. location · via Ortho UX Tester`,
  ].join("\n");
}

// Build a postable comment from a finding + the frame geometry map. null if unpinnable.
function buildItem(
  f: Finding,
  personaLabel: string,
  frameByLabel: Map<string, { node_id: string; width: number; height: number }>,
): CommentItem | null {
  const loc = f.figma_location;
  const frame = loc ? frameByLabel.get(loc.frame_label) : undefined;
  if (!loc || !frame || !frame.width || !frame.height) return null;
  return {
    message: messageFor(f, personaLabel),
    node_id: frame.node_id,
    nx: loc.nx,
    ny: loc.ny,
    nw: loc.nw,
    nh: loc.nh,
    width: frame.width,
    height: frame.height,
  };
}

export async function POST(req: NextRequest) {
  try {
    // `finding` present => post just that one; else post all findings.
    const { report, finding } = (await req.json()) as {
      report: FrictionReport;
      finding?: Finding;
    };

    if (!report || report.source_kind !== "figma") {
      return NextResponse.json(
        { error: "Comments can only be posted for Figma reports." },
        { status: 400 },
      );
    }
    if (!report.figma_file_key) {
      return NextResponse.json(
        { error: "Report is missing the Figma file key — re-run the analysis." },
        { status: 400 },
      );
    }
    if (!process.env.FIGMA_TOKEN) {
      return NextResponse.json(
        { error: "Server missing FIGMA_TOKEN." },
        { status: 500 },
      );
    }

    const frameByLabel = new Map(
      (report.figma_frames ?? []).map((fr) => [fr.label, fr]),
    );

    const targets = finding ? [finding] : report.findings;
    const items: CommentItem[] = [];
    let skipped = 0;
    for (const f of targets) {
      const item = buildItem(f, report.persona_label, frameByLabel);
      if (item) items.push(item);
      else skipped++;
    }

    if (items.length === 0) {
      return NextResponse.json(
        {
          error: finding
            ? "This finding has no usable frame location to pin."
            : "No findings had a usable frame location to pin. (Re-run the analysis.)",
        },
        { status: 422 },
      );
    }

    const results = await postComments(report.figma_file_key, items);
    const posted = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    // Surface a scope/permission failure clearly.
    const scopeErr = failed.find((r) => (r.error || "").startsWith("403"));
    if (posted === 0 && scopeErr) {
      return NextResponse.json(
        {
          error:
            "Figma rejected the comments (403). Your token needs the file_comments:write scope, or your account lacks comment access to this file. Regenerate the PAT with comments-write and try a file you can comment on.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json({
      posted,
      failed: failed.length,
      skipped,
      total: targets.length,
      errors: failed.map((r) => r.error).slice(0, 5),
    });
  } catch (e: any) {
    console.error("comment error:", e);
    return NextResponse.json(
      { error: e?.message || "Posting comments failed." },
      { status: 500 },
    );
  }
}
