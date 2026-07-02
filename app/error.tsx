"use client";

// App-level error boundary. Catches client render errors so a malformed report
// (or any bug) shows a readable message + retry instead of white-screening.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-lg px-5 py-20 text-center">
      <h2 className="text-lg font-semibold text-slate-900">
        Something went wrong rendering this.
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        {error?.message || "An unexpected client-side error occurred."}
      </p>
      <button
        onClick={reset}
        className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Try again
      </button>
    </main>
  );
}
