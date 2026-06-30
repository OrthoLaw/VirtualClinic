import AnalyzeForm from "@/components/AnalyzeForm";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="no-print mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Ortho UX Tester
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          Paste a Figma share link or an HTML prototype URL, pick a practice
          persona, and get a rated UX friction report grounded in real
          practitioner complaints and Nielsen Norman Group usability heuristics.
        </p>
      </header>
      <AnalyzeForm />
    </main>
  );
}
