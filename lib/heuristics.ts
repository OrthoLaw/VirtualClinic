import data from "@/data/heuristics.json";
import type { Heuristic } from "./types";

export const heuristics: Heuristic[] = data.heuristics;

export function heuristicsPromptBlock(): string {
  return heuristics
    .map((h) => `- ${h.id} — ${h.name}: ${h.summary} (source: ${h.source})`)
    .join("\n");
}

export function heuristicById(id: string): Heuristic | undefined {
  return heuristics.find((h) => h.id === id);
}
