"use client";

import { useState } from "react";
import { PERSONA_LIST } from "@/lib/personas";
import type { FrictionReport, PersonaId } from "@/lib/types";
import ReportView, { type PinStatus } from "./ReportView";

// Read a response as JSON, but degrade gracefully when the server returns a
// non-JSON error page (e.g. a Vercel timeout/crash: "An error occurred…").
async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const hint =
      res.status === 504 || /timeout|timed out/i.test(text)
        ? "The analysis took too long and the server timed out (Vercel Hobby caps at 60s). Try a link with fewer/simpler frames."
        : `Server returned a non-JSON error (HTTP ${res.status}): ${text.slice(0, 160)}`;
    throw new Error(hint);
  }
}

const STEPS = [
  "Capturing the prototype…",
  "Loading persona + grounding corpus…",
  "Walking through tasks…",
  "Writing up friction…",
];

export default function AnalyzeForm() {
  const [url, setUrl] = useState("");
  const [persona, setPersona] = useState<PersonaId>("tc-small");
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FrictionReport | null>(null);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [pinStates, setPinStates] = useState<Record<number, PinStatus>>({});
  const [dismissed, setDismissed] = useState<Record<number, boolean>>({});

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
    setPostResult(null);
    setPostError(null);
    setPinStates({});
    setDismissed({});
    setLoading(true);
    setStep(0);
    const ticker = setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      8000,
    );
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, persona, focus }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Analysis failed.");
      setReport(data.report);
    } catch (err: any) {
      setError(err.message);
    } finally {
      clearInterval(ticker);
      setLoading(false);
    }
  }

  async function postToFigma() {
    if (!report) return;
    setPostError(null);
    setPostResult(null);
    setPosting(true);
    try {
      // Post only findings the user hasn't dismissed. Keep figma_frames intact.
      const all = Array.isArray(report.findings) ? report.findings : [];
      const keep = all.filter((_, i) => !dismissed[i]);
      const res = await fetch("/api/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: { ...report, findings: keep } }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Posting failed.");
      const extra =
        data.skipped > 0 ? ` (${data.skipped} skipped — no location)` : "";
      setPostResult(`Posted ${data.posted}/${data.total} comments${extra}.`);
      // Mark every kept pinnable finding as done (batch returns counts, not per-finding).
      setPinStates(() => {
        const next: Record<number, PinStatus> = {};
        all.forEach((f, i) => {
          if (f.figma_location && !dismissed[i]) next[i] = "done";
        });
        return next;
      });
    } catch (err: any) {
      setPostError(err.message);
    } finally {
      setPosting(false);
    }
  }

  function toggleDismiss(index: number) {
    setDismissed((d) => ({ ...d, [index]: !d[index] }));
  }

  async function pinOne(index: number) {
    if (!report) return;
    const finding = report.findings[index];
    setPostError(null);
    setPinStates((s) => ({ ...s, [index]: "posting" }));
    try {
      const res = await fetch("/api/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, finding }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Pin failed.");
      setPinStates((s) => ({ ...s, [index]: "done" }));
    } catch (err: any) {
      setPinStates((s) => ({ ...s, [index]: "error" }));
      setPostError(err.message);
    }
  }

  // Never assume the API gave us a well-formed findings array.
  const safeFindings = Array.isArray(report?.findings) ? report!.findings : [];
  const activeCount = safeFindings.filter((_, i) => !dismissed[i]).length;

  return (
    <div className="space-y-6">
      <form
        onSubmit={run}
        className="no-print rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <label className="block text-sm font-medium text-slate-700">
          Prototype link
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.figma.com/design/… or https://your-prototype.html"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Test as
          <select
            value={persona}
            onChange={(e) => setPersona(e.target.value as PersonaId)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            {PERSONA_LIST.map((p) => (
              <option key={p.id} value={p.id}>
                {p.short}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          What should we focus on?{" "}
          <span className="font-normal text-slate-400">(optional)</span>
          <textarea
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            rows={2}
            placeholder="e.g. Test the payment / financial arrangement flow. Or: the reschedule flow when a conflict happens."
            className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? STEPS[step] : "Run UX test"}
        </button>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </form>

      {report && (
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-center justify-end gap-2">
            {postResult && (
              <span className="mr-auto text-sm text-emerald-700">
                {postResult}{" "}
                <a
                  href={report.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Open in Figma
                </a>
              </span>
            )}
            {postError && (
              <span className="mr-auto text-sm text-red-700">{postError}</span>
            )}
            {report.source_kind === "figma" && (
              <button
                onClick={postToFigma}
                disabled={posting || activeCount === 0}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {posting
                  ? "Posting…"
                  : `Post ${activeCount} comments to Figma`}
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download PDF
            </button>
          </div>
          <ReportView
            report={report}
            pinStates={pinStates}
            onPin={pinOne}
            dismissed={dismissed}
            onToggleDismiss={toggleDismiss}
          />
        </div>
      )}
    </div>
  );
}
