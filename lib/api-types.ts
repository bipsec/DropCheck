// Wire types for surviving visualization components (track-view,
// prereq-diagram, credit-plot). Slim replacement of the pre-pivot file
// — every type here is what the viz needs to render *tool_result*
// payloads streamed from the Claude Agent SDK in phases 5/6.
//
// Keep this file dependency-free (no imports) so the client bundle stays
// tiny and there's no accidental Supabase / Anthropic pull-through.

// --- Track (rules-engine `build_track` tool result) ------------------------

export type TrackTerm = { season: "Fall" | "Spring" | "Summer"; year: number };

export type PlannedCourse = {
  course_code: string;
  credits: number;
  category_id: string;
  chosen_reason: "required" | "pool_fill" | "gen_ed_fill";
};

export type PlannedTerm = {
  term: TrackTerm;
  courses: PlannedCourse[];
  credits_this_term: number;
  cumulative_credits: number;
};

export type UnresolvedSlot = {
  category_id: string;
  credits_needed: number;
  options: string[];
};

export type Track = {
  program_id: string;
  generated_for: "fresh" | "in_progress";
  terms: PlannedTerm[];
  total_terms: number;
  projected_grad_term: TrackTerm;
  unresolved: UnresolvedSlot[];
};

// --- Diagram (rules-engine `impact_of_dropping` tool result) ---------------

export type FinalDiagramNode = {
  id: string;
  label: string;
  kind: "dropped" | "downstream" | "prereq" | "context";
};

export type FinalDiagramEdge = { from: string; to: string };

export type FinalDiagram = {
  nodes: FinalDiagramNode[];
  edges: FinalDiagramEdge[];
};

// --- Plot (credit-progress rendering) -------------------------------------

export type FinalPlotSeries = { label: string; credits: number };

export type FinalPlotThreshold = {
  label: string;
  value: number;
  domain: "financial" | "status" | "academic";
};

export type FinalPlot = {
  title: string;
  yAxisLabel: string;
  series: FinalPlotSeries[];
  thresholds: FinalPlotThreshold[];
};
