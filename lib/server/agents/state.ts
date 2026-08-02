// Graph state shape — TypeScript port of backend/app/agents/state.py.
//
// The original used LangGraph's TypedDict with an `operator.add` reducer on
// `trace_events`. The Node port runs nodes in plain async functions, so the
// `merge` helper in graph.ts concatenates trace events explicitly.

import type {
  ClarificationAnswer,
  GraphDecisionFrame,
  GraphDomainReport,
  GraphSynthOutput,
  HypotheticalDrop,
  RouteKind,
} from "@/lib/server/agents/schemasGraph";

export type TraceStatus = "start" | "complete" | "skipped" | "error";

export interface TraceEvent {
  agent: string;
  status: TraceStatus;
  summary: string;
  duration_ms: number;
}

export interface PriorTurn {
  course_code?: string;
  matched_course_id?: string;
  resolver?: Record<string, unknown>;
  academic_report?: Record<string, unknown>;
  financial_report?: Record<string, unknown>;
  status_report?: Record<string, unknown>;
  final?: Record<string, unknown>;
}

export interface DropCheckState {
  // Inputs
  student_id?: string;
  conversation_id?: string;
  query?: string;
  matched_course_id?: string;

  // Follow-up inputs
  prior_turn?: PriorTurn | null;
  is_followup?: boolean;

  // Router output
  route_kind?: RouteKind | null;
  hypothetical_drops?: Array<Record<string, unknown>>;
  route_reasoning?: string | null;

  // Resolved context
  resolver?: Record<string, unknown>;

  // Agent outputs
  frame?: GraphDecisionFrame | null;
  academic_report?: GraphDomainReport | null;
  financial_report?: GraphDomainReport | null;
  status_report?: GraphDomainReport | null;

  // Clarification path
  clarification?: ClarificationAnswer | null;

  // Final payload
  final?: GraphSynthOutput | null;
  grounding_violations?: Array<Record<string, unknown>>;

  // Streaming / tracing
  trace_events?: TraceEvent[];

  // Failure surface
  error?: string | null;
}

// Partial update returned by a node; graph.ts merges these into state.
export type NodePartial = Partial<DropCheckState> & {
  trace_events?: TraceEvent[];
};

// Re-export for callers.
export type { HypotheticalDrop };
