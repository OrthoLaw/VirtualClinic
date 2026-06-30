import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/analyze";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

export const runtime = "nodejs";
// Hobby caps at 60s. Keep capture lean (FIGMA_MAX_FRAMES=2) to finish in time.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { url, persona, focus } = await req.json();

    if (!url || typeof url !== "string" || !/^https?:\/\//.test(url)) {
      return NextResponse.json(
        { error: "Provide a valid http(s) URL (Figma share link or HTML link)." },
        { status: 400 },
      );
    }
    if (!persona || !(persona in PERSONAS)) {
      return NextResponse.json(
        { error: "Pick a valid persona." },
        { status: 400 },
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "Server missing ANTHROPIC_API_KEY." },
        { status: 500 },
      );
    }

    const focusStr =
      typeof focus === "string" ? focus.slice(0, 1000) : undefined;
    const report = await analyze(url, persona as PersonaId, focusStr);
    return NextResponse.json({ report });
  } catch (e: any) {
    console.error("analyze error:", e);
    return NextResponse.json(
      { error: e?.message || "Analysis failed." },
      { status: 500 },
    );
  }
}
