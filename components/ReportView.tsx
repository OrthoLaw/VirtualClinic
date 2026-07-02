"use client";

import type { FrictionReport, Finding, Severity } from "@/lib/types";

export type PinStatus = "idle" | "posting" | "done" | "error";

const SEV_META: Record<
  Severity,
  { label: string; cls: string; order: number }
> = {
  blocks_task: {
    label: "Blocks task",
    cls: "bg-red-100 text-red-800 border-red-200",
    order: 0,
  },
  slows_task: {
    label: "Slows task",
    cls: "bg-amber-100 text-amber-800 border-amber-200",
    order: 1,
  },
  annoys_but_tolerable: {
    label: "Annoys",
    cls: "bg-yellow-50 text-yellow-700 border-yellow-200",
    order: 2,
  },
};

const CONF_CLS: Record<string, string> = {
  high: "text-emerald-700",
  medium: "text-slate-500",
  low: "text-slate-400",
};

function SeverityBadge({ s }: { s: Severity }) {
  const m = SEV_META[s];
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function PinButton({
  status,
  onPin,
  pinnable,
}: {
  status: PinStatus;
  onPin: () => void;
  pinnable: boolean;
}) {
  if (!pinnable)
    return (
      <span className="text-xs text-slate-300" title="No frame location to pin">
        —
      </span>
    );
  const label =
    status === "posting"
      ? "Pinning…"
      : status === "done"
        ? "Pinned ✓"
        : status === "error"
          ? "Retry pin"
          : "Pin to Figma";
  return (
    <button
      onClick={onPin}
      disabled={status === "posting" || status === "done"}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
        status === "done"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status === "error"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
      }`}
    >
      {label}
    </button>
  );
}

function FindingCard({
  f,
  n,
  pinStatus,
  onPin,
  canPin,
  dismissed,
  onToggleDismiss,
}: {
  f: Finding;
  n: number;
  pinStatus: PinStatus;
  onPin: () => void;
  canPin: boolean;
  dismissed: boolean;
  onToggleDismiss: () => void;
}) {
  // Dismissed: collapse to a muted one-liner with Undo; hidden from print/PDF.
  if (dismissed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-400 print:hidden">
        <span className="line-through">
          {n}. {f.task}
        </span>
        <button
          onClick={onToggleDismiss}
          className="no-print shrink-0 text-xs font-medium text-indigo-600 hover:underline"
        >
          Undo
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-slate-900">
          {n}. {f.task}
        </h4>
        <div className="flex shrink-0 items-center gap-2">
          {canPin && (
            <span className="no-print">
              <PinButton
                status={pinStatus}
                onPin={onPin}
                pinnable={!!f.figma_location}
              />
            </span>
          )}
          <SeverityBadge s={f.severity} />
          <button
            onClick={onToggleDismiss}
            title="Dismiss this finding (e.g. false positive from dummy data)"
            className="no-print text-xs font-medium text-slate-400 hover:text-slate-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="grid grid-cols-[88px_1fr] gap-2">
          <dt className="text-slate-400">Step</dt>
          <dd className="text-slate-700">{f.step}</dd>
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-2">
          <dt className="text-slate-400">Expected</dt>
          <dd className="text-slate-700">{f.expected_behavior}</dd>
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-2">
          <dt className="text-slate-400">Actual</dt>
          <dd className="text-slate-700">{f.actual_behavior}</dd>
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-2">
          <dt className="text-slate-400">Why it hurts</dt>
          <dd className="text-slate-600 italic">{f.corpus_grounding}</dd>
        </div>
      </dl>
      <div className="mt-3 rounded-md bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-800">Fix</p>
        <p className="text-sm text-slate-700">{f.suggested_fix}</p>
        <p className="mt-1.5 text-xs text-slate-500">
          {f.heuristic_name} ·{" "}
          <a
            href={f.fix_source}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-slate-700"
          >
            NNG reference
          </a>{" "}
          ·{" "}
          <span className={CONF_CLS[f.confidence] ?? ""}>
            {f.confidence} confidence
          </span>
        </p>
      </div>
    </div>
  );
}

export default function ReportView({
  report,
  pinStates = {},
  onPin,
  dismissed = {},
  onToggleDismiss,
}: {
  report: FrictionReport;
  // keyed by the finding's original index in report.findings
  pinStates?: Record<number, PinStatus>;
  onPin?: (originalIndex: number) => void;
  dismissed?: Record<number, boolean>;
  onToggleDismiss?: (originalIndex: number) => void;
}) {
  const canPin = report.source_kind === "figma" && !!onPin;
  const src = Array.isArray(report.findings) ? report.findings : [];
  const findings = [...src].sort(
    (a, b) => SEV_META[a.severity].order - SEV_META[b.severity].order,
  );
  const isDismissed = (f: Finding) => !!dismissed[src.indexOf(f)];
  // Counts reflect active (non-dismissed) findings only.
  const active = findings.filter((f) => !isDismissed(f));
  const counts = {
    blocks_task: active.filter((f) => f.severity === "blocks_task").length,
    slows_task: active.filter((f) => f.severity === "slows_task").length,
    annoys_but_tolerable: active.filter(
      (f) => f.severity === "annoys_but_tolerable",
    ).length,
  };
  const dismissedCount = findings.length - active.length;

  return (
    <div id="report" className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {report.source_kind} prototype · {report.persona_label}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900">
          UX Friction Report
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          {report.summary}
        </p>
        {report.case_acceptance_risk && (
          <p className="mt-2 rounded-md bg-indigo-50 p-3 text-sm text-indigo-900">
            <span className="font-medium">Business risk:</span>{" "}
            {report.case_acceptance_risk}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-red-800">
            {counts.blocks_task} blocking
          </span>
          <span className="rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-amber-800">
            {counts.slows_task} slowing
          </span>
          <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-0.5 text-yellow-700">
            {counts.annoys_but_tolerable} minor
          </span>
          {dismissedCount > 0 && (
            <span className="no-print rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-slate-400">
              {dismissedCount} dismissed
            </span>
          )}
        </div>
        <p className="mt-3 break-all text-xs text-slate-400">
          {report.source_url} · {new Date(report.generated_at).toLocaleString()}
        </p>
      </div>

      <div className="space-y-3">
        {findings.map((f, i) => {
          const orig = src.indexOf(f);
          return (
            <FindingCard
              key={i}
              f={f}
              n={i + 1}
              canPin={canPin}
              pinStatus={pinStates[orig] ?? "idle"}
              onPin={() => onPin?.(orig)}
              dismissed={!!dismissed[orig]}
              onToggleDismiss={() => onToggleDismiss?.(orig)}
            />
          );
        })}
      </div>

      <p className="text-xs text-slate-400">
        {report.evidence_note} Grounded in Nielsen Norman Group usability
        heuristics and a tagged corpus of real practitioner complaints. Synthetic
        persona output — calibrate against real practitioners before acting on
        high-severity findings.
      </p>
    </div>
  );
}
