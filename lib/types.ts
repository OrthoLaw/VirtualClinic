// Shared types for the Ortho UX Tester.

export type PersonaId =
  | "tc-small"
  | "tc-oso"
  | "fd-small"
  | "fd-oso";

export type SourceKind = "figma" | "html";

export type Severity = "blocks_task" | "slows_task" | "annoys_but_tolerable";

// One finding in the friction log. Mirrors the schema in the spec doc (Section 6),
// extended with NNG-grounded fix guidance.
export interface Finding {
  task: string; // the user task being attempted
  step: string; // what the persona did
  expected_behavior: string;
  actual_behavior: string;
  severity: Severity;
  corpus_grounding: string; // which real-world complaint pattern this matches
  heuristic: string; // NNG heuristic id this violates, e.g. "nng-1"
  heuristic_name: string; // human label of that heuristic
  suggested_fix: string; // concrete, actionable fix
  fix_source: string; // citation: NNG/UX-research URL or reference
  confidence: "high" | "medium" | "low";
  // Figma-only: where on a frame this issue sits, normalized 0..1 within the frame.
  // Used to pin a positioned comment. Absent for HTML sources.
  figma_location?: {
    frame_label: string;
    nx: number;
    ny: number;
    nw: number;
    nh: number;
  };
}

// Figma-only: the frames captured this run, so the comment step can map a
// finding's frame_label back to a node_id + pixel geometry without re-capturing.
export interface FigmaFrameRef {
  label: string;
  node_id: string;
  width: number;
  height: number;
}

export interface FrictionReport {
  persona: PersonaId;
  persona_label: string;
  source_kind: SourceKind;
  source_url: string;
  summary: string; // 2-3 sentence executive read
  case_acceptance_risk?: string; // persona-relevant business read (TC) where applicable
  findings: Finding[];
  evidence_note: string; // what the agent actually saw (frames/screens analyzed)
  generated_at: string; // ISO timestamp
  // Figma-only: frame index + file key, to post positioned comments later.
  figma_frames?: FigmaFrameRef[];
  figma_file_key?: string;
}

// Evidence handed to the agent.
export interface CapturedEvidence {
  kind: SourceKind;
  url: string;
  // base64 PNG screenshots (data only, no prefix)
  images: { label: string; base64: string }[];
  // textual structure: DOM outline or Figma frame tree
  structure: string;
  note: string;
  // Figma-only: captured frames with node_id + geometry (for comment pinning).
  frames?: FigmaFrameRef[];
  fileKey?: string;
}

export interface Heuristic {
  id: string;
  name: string;
  summary: string;
  source: string; // canonical URL
}
