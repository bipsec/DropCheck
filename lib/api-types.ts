/**
 * Wire types mirroring the FastAPI Pydantic schemas.
 *
 * Kept in sync by hand with backend/app/schemas/*.py. When a new field
 * appears on the backend, add it here — TypeScript catches every call site
 * that needs to handle it.
 */

// --- Session ---------------------------------------------------------------

export type SessionInfo = {
  student_id: string | null;
  session_id: string;
  no_db: boolean;
};

// --- Catalog ---------------------------------------------------------------

export type CatalogSearchHit = {
  id: string;
  course_code: string;
  title: string;
  description: string | null;
  credits: number | null;
  level: "undergraduate" | "masters" | "doctoral" | null;
  similarity: number;
};

export type MatchCandidate = CatalogSearchHit;

export type CourseMatchOut = {
  query: string;
  match: MatchCandidate | null;
  confidence: number;
  decision: string;
  candidates: MatchCandidate[];
  reasoning?: string | null;
};

// --- Profile ---------------------------------------------------------------

export type CourseRow = {
  id: string;
  course_code: string | null;
  title: string | null;
  grade: string | null;
  credits: number | null;
  semester: string | null;
  source: string | null;
  confirmed_by_student: boolean;
  match_confidence: number | null;
  catalog_course_id: string | null;
};

export type Completeness = {
  score: number;
  missing_fields: string[];
  meets_80: boolean;
};

export type StudentRow = {
  id: string;
  name: string | null;
  program: string | null;
  major: string | null;
  expected_grad_semester: string | null;
  gpa: number | null;
  total_credits_completed: number | null;
  future_plan: string | null;
  preferences: Record<string, unknown> | null;
  international: boolean;
};

export type FinanceRow = {
  student_id: string;
  tuition_per_term: number | null;
  current_aid_amount: number | null;
  aid_types: string[] | null;
  sap_status: "good" | "warning" | "probation" | null;
  employment_hours_week: number | null;
  dependent_status: "dependent" | "independent" | null;
  max_out_of_pocket: number | null;
};

export type ProfileOut = {
  student_id: string;
  student: StudentRow;
  finance: FinanceRow | null;
  courses: CourseRow[];
  completeness: Completeness;
};

export type UploadResult = {
  student_id: string;
  transcript_id: string;
  parse_method: "text" | "ocr" | "text+ocr" | "empty";
  ocr_available: boolean;
  courses_parsed: number;
  courses_matched: number;
  completeness: Completeness;
  warning: string | null;
};

// --- Query -----------------------------------------------------------------

export type TraceEvent = {
  agent: string;
  status: "start" | "complete" | "skipped" | "error";
  summary: string;
  duration_ms: number;
};

export type Panel = {
  domain: "academic" | "financial" | "status";
  verdict: string;
  detail: string;
  nextStep?: string | null;
  nextStepDetail?: string | null;
  hasImpact: boolean;
};

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

export type FinalSource = {
  // Rich (from LangGraph synth) OR grounded (from server-computed):
  claim?: string;
  sourceAgent?: string;
  sourceCitation?: string;
  // Simple citation shape (Graph synth also uses this):
  source?: string;
  field?: string;
};

export type FinalPayload = {
  course: string;
  headline: string;
  bottomLine?: string;
  bottom_line?: string; // some code paths emit snake_case
  confidence: "low" | "medium" | "high";
  panels: Panel[];
  sources?: FinalSource[];
  diagram?: FinalDiagram | null;
  plot?: FinalPlot | null;
  meta: {
    mode: "agents" | "fallback" | "clarification";
    degraded: boolean;
    note?: string | null;
  };
};

export type Clarification = {
  headline: string;
  answer: string;
  confidence: "low" | "medium" | "high";
  sources: Array<{ source: string; field: string }>;
};

export type QueryOut = {
  conversation_id: string;
  course_code: string;
  match_decision: string;
  route_kind: "new_course_check" | "clarification" | "what_if";
  final: FinalPayload;
  clarification: Clarification | null;
  hypothetical_drops: Array<Record<string, unknown>>;
  trace_events: TraceEvent[];
  grounding_violations: Array<Record<string, unknown>>;
};

export type ConversationSummary = {
  id: string;
  course_code: string | null;
  created_at: string;
};

export type ConversationTurn = {
  id: string;
  role: "user" | "assistant";
  query: string | null;
  response: FinalPayload | null;
  created_at: string;
};

export type ConversationDetail = {
  conversation: {
    id: string;
    student_id: string;
    course_code: string | null;
    created_at: string;
  };
  turns: ConversationTurn[];
};
