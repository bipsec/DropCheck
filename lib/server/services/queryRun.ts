// Query orchestration + persistence.
// Ported 1:1 from backend/app/services/query_run.py.
//
// Ties together: course matching → graph execution → fallback →
// conversation persistence. The graph knows nothing about Supabase or
// HTTP; this layer handles both.

import { matchCourse } from "@/lib/server/agents/courseMatcher";
import { phraseFromRules } from "@/lib/server/agents/fallback";
import { runGraph } from "@/lib/server/agents/graph";
import type { DropCheckState } from "@/lib/server/agents/state";
import { lookupCourse, normalizeCourse, type MajorId } from "@/lib/server/data/catalog";
import { getSupabase } from "@/lib/server/supabase";
import {
  buildQueryContext,
  QueryContextError,
  type QueryContextBundle,
} from "@/lib/server/services/queryContext";
import {
  buildGroundedDiagram,
  buildGroundedPlot,
} from "@/lib/server/services/groundedViz";
import { buildStudentContext } from "@/lib/server/services/resolver";

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

export interface QueryRunResult {
  conversation_id: string;
  final: Record<string, unknown>;
  trace_events: Array<Record<string, unknown>>;
  match_decision: string;
  course_code: string;
  grounding_violations: Array<Record<string, unknown>>;
  route_kind: string;
  clarification: Record<string, unknown> | null;
  hypothetical_drops: Array<Record<string, unknown>>;
}

// Deps object for testability — mirrors the matcherDeps / nodesDeps pattern.
export const queryDeps = {
  matchCourse,
  buildQueryContext,
  runGraph,
  getSupabase,
};

function clientOrRaise() {
  const sb = queryDeps.getSupabase();
  if (!sb) {
    throw new QueryError("Supabase not configured — cannot record conversations.");
  }
  return sb;
}

export async function runQuery(
  studentId: string,
  query: string,
  courseHint: string,
): Promise<QueryRunResult> {
  const match = await queryDeps.matchCourse(courseHint, 5);
  if (match.match == null) {
    throw new QueryError(
      `Could not resolve course from ${JSON.stringify(courseHint)} ` +
        `(decision=${match.decision}). Try picking one manually.`,
    );
  }

  const catalogCourseId = match.match.id;
  const courseCode = match.match.course_code;

  let bundle: QueryContextBundle;
  try {
    bundle = await queryDeps.buildQueryContext(studentId, catalogCourseId);
  } catch (err) {
    if (err instanceof QueryContextError) {
      throw new QueryError(`context: ${err.message}`);
    }
    throw err;
  }

  const initialState: DropCheckState = {
    student_id: studentId,
    query,
    matched_course_id: catalogCourseId,
    is_followup: false,
    trace_events: [],
  };
  const resultState = await safeInvoke(initialState);

  return finalizeAndPersist({
    studentId,
    query,
    courseCode,
    catalogCourseId,
    bundle,
    resultState,
    matchDecision: match.decision,
    conversationId: null,
  });
}

export async function runFollowup(
  studentId: string,
  conversationId: string,
  query: string,
): Promise<QueryRunResult> {
  const prior = await loadPriorTurn(studentId, conversationId);
  const catalogCourseId = String(prior.matched_course_id);
  const courseCode = String(prior.course_code);

  let bundle: QueryContextBundle;
  try {
    bundle = await queryDeps.buildQueryContext(studentId, catalogCourseId);
  } catch (err) {
    if (err instanceof QueryContextError) {
      throw new QueryError(`context: ${err.message}`);
    }
    throw err;
  }

  const initialState: DropCheckState = {
    student_id: studentId,
    conversation_id: conversationId,
    query,
    matched_course_id: catalogCourseId,
    prior_turn: prior,
    is_followup: true,
    trace_events: [],
  };
  const resultState = await safeInvoke(initialState);

  return finalizeAndPersist({
    studentId,
    query,
    courseCode,
    catalogCourseId,
    bundle,
    resultState,
    matchDecision: "follow_up",
    conversationId,
  });
}

async function safeInvoke(initial: DropCheckState): Promise<DropCheckState> {
  try {
    return await queryDeps.runGraph(initial);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[queryRun] runGraph failed, falling back:", message);
    return {
      trace_events: [
        {
          agent: "graph",
          status: "error",
          summary: message.slice(0, 200),
          duration_ms: 0,
        },
      ],
      final: null,
    };
  }
}

interface FinalizeArgs {
  studentId: string;
  query: string;
  courseCode: string;
  catalogCourseId: string;
  bundle: QueryContextBundle;
  resultState: DropCheckState;
  matchDecision: string;
  conversationId: string | null;
}

async function finalizeAndPersist(args: FinalizeArgs): Promise<QueryRunResult> {
  const {
    studentId,
    query,
    courseCode,
    catalogCourseId,
    bundle,
    resultState,
    matchDecision,
  } = args;

  const routeKind = String(resultState.route_kind ?? "new_course_check");
  const groundingViolations = [...(resultState.grounding_violations ?? [])];
  const hypotheticalDrops = [...(resultState.hypothetical_drops ?? [])];
  const clarification = resultState.clarification;

  let clarificationPayload: Record<string, unknown> | null = null;
  let finalPayload: Record<string, unknown>;
  if (routeKind === "clarification" && clarification != null) {
    clarificationPayload = { ...clarification };
    finalPayload = clarificationFinal(bundle.course_code, clarificationPayload);
  } else {
    finalPayload = extractFinal(resultState, bundle);
  }

  const reportsPayload = reportsSnapshot(resultState, catalogCourseId, bundle);

  const conversationId = await persist({
    studentId,
    query,
    courseCode,
    finalPayload,
    traceEvents: (resultState.trace_events ?? []) as unknown as Array<Record<string, unknown>>,
    reportsPayload,
    conversationId: args.conversationId,
  });

  return {
    conversation_id: conversationId,
    final: finalPayload,
    trace_events: [...((resultState.trace_events ?? []) as unknown as Array<Record<string, unknown>>)],
    match_decision: matchDecision,
    course_code: courseCode,
    grounding_violations: groundingViolations,
    route_kind: routeKind,
    clarification: clarificationPayload,
    hypothetical_drops: hypotheticalDrops,
  };
}

function clarificationFinal(
  courseCode: string,
  answer: Record<string, unknown>,
): Record<string, unknown> {
  const sources = (answer.sources as Array<Record<string, unknown>>) ?? [];
  const headline = String(answer.headline ?? "");
  return {
    course: courseCode,
    headline,
    bottomLine: String(answer.answer ?? ""),
    confidence: answer.confidence ?? "medium",
    panels: [
      {
        domain: "academic",
        verdict: headline,
        detail: String(answer.answer ?? ""),
        nextStep: null,
        hasImpact: false,
      },
      {
        domain: "financial",
        verdict: "See the clarification above.",
        detail: "",
        nextStep: null,
        hasImpact: false,
      },
      {
        domain: "status",
        verdict: "See the clarification above.",
        detail: "",
        nextStep: null,
        hasImpact: false,
      },
    ],
    sources: sources.map((s) => ({
      claim: headline.slice(0, 200),
      sourceAgent: "resolver",
      sourceCitation: String(s.field ?? "?"),
    })),
    meta: { mode: "clarification", degraded: false, note: null },
  };
}

function reportsSnapshot(
  resultState: DropCheckState,
  catalogCourseId: string,
  bundle: QueryContextBundle,
): Record<string, unknown> {
  const dump = (rep: unknown): unknown => (rep == null ? null : rep);
  return {
    matched_course_id: catalogCourseId,
    course_code: bundle.course_code,
    academic_report: dump(resultState.academic_report),
    financial_report: dump(resultState.financial_report),
    status_report: dump(resultState.status_report),
  };
}

export async function loadPriorTurn(
  studentId: string,
  conversationId: string,
): Promise<Record<string, unknown>> {
  const sb = clientOrRaise();
  const conv = await sb
    .from("conversations")
    .select("id, student_id, course_code")
    .eq("id", conversationId)
    .limit(1);
  if (!conv.data || conv.data.length === 0) {
    throw new QueryError(`conversation ${JSON.stringify(conversationId)} not found`);
  }
  const convRow = conv.data[0] as Record<string, unknown>;
  if (convRow.student_id !== studentId) {
    throw new QueryError("conversation belongs to a different student");
  }

  const turns = await sb
    .from("conversation_turns")
    .select("id, role, query, response, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1);
  if (!turns.data || turns.data.length === 0) {
    throw new QueryError("conversation has no assistant turn to follow up on");
  }

  const response =
    ((turns.data[0] as Record<string, unknown>).response as Record<string, unknown>) ??
    {};
  const reports = (response._reports as Record<string, unknown>) ?? {};
  const matchedId = reports.matched_course_id as string | undefined;
  if (!matchedId) {
    throw new QueryError(
      "prior turn does not carry a matched_course_id — cannot follow up",
    );
  }

  const final = Object.fromEntries(
    Object.entries(response).filter(([k]) => k !== "_reports"),
  );

  return {
    course_code: (reports.course_code as string | undefined) ?? convRow.course_code,
    matched_course_id: matchedId,
    academic_report: reports.academic_report ?? null,
    financial_report: reports.financial_report ?? null,
    status_report: reports.status_report ?? null,
    final,
  };
}

function extractFinal(
  resultState: DropCheckState,
  bundle: QueryContextBundle,
): Record<string, unknown> {
  const synth = resultState.final;
  const groundingViolations = resultState.grounding_violations ?? [];

  if (synth != null && groundingViolations.length === 0) {
    const resolver = (resultState.resolver ?? {}) as Record<string, unknown>;
    return {
      course: bundle.course_code,
      headline: synth.headline,
      bottomLine: synth.bottom_line,
      confidence: synth.confidence,
      panels: synth.panels.map((p) => ({ ...p })),
      sources: synth.sources.map((s) => ({ ...s })),
      diagram: buildGroundedDiagram(resolver, bundle),
      plot: buildGroundedPlot(resolver, bundle),
      meta: { mode: "agents", degraded: false, note: null },
    };
  }

  // Deterministic fallback using the in-memory demo dataset. When the queried
  // course isn't in that set (common with the 531-row Supabase catalog), fall
  // back to a bare bundle payload rather than leaving the caller with nothing.
  const demo = lookupCourse(normalizeCourse(bundle.course_code));
  if (demo != null) {
    const student = bundle.student;
    const totalCredits = Number(student.total_credits_completed ?? 15);
    const important =
      bundle.importance === "critical" || bundle.importance === "high";
    const ctx = buildStudentContext({
      course: bundle.course_code,
      credits: totalCredits,
      required_for_major: important ? "yes" : "unsure",
      international: Boolean(student.international),
      major: (student.major ?? null) as MajorId | null,
    });
    if (ctx != null) {
      const note = fallbackNote(resultState, groundingViolations);
      const payload = phraseFromRules(ctx, note);
      const data = { ...payload } as unknown as Record<string, unknown>;
      // Zod-parsed FinalPayload is camelCase; nothing else to project.
      if (groundingViolations.length > 0) {
        const meta = { ...(data.meta as Record<string, unknown>) };
        meta.degraded = true;
        data.meta = meta;
      }
      return data;
    }
  }

  return bareBundlePayload(bundle, resultState, groundingViolations);
}

function bareBundlePayload(
  bundle: QueryContextBundle,
  resultState: DropCheckState,
  groundingViolations: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const note = fallbackNote(resultState, groundingViolations);
  const resolver = (resultState.resolver ?? {}) as Record<string, unknown>;
  return {
    course: bundle.course_code,
    headline: `Impact check for ${bundle.course_code}`,
    bottomLine:
      "Not enough of your profile is filled in to give a grounded answer. " +
      "Add missing fields on the profile page and try again.",
    confidence: "low",
    panels: [
      {
        domain: "academic",
        verdict: "Not enough info to score academic impact.",
        detail:
          `${bundle.course_code} importance: ${bundle.importance}. ` +
          "Set your major and required-for-major so the agent can reason.",
        nextStep: null,
        hasImpact: true,
      },
      {
        domain: "financial",
        verdict: "Not enough info to score financial impact.",
        detail:
          "Add tuition and aid amounts to your profile so the agent " +
          "can reason about aid thresholds.",
        nextStep: null,
        hasImpact: true,
      },
      {
        domain: "status",
        verdict: "No status impact.",
        detail: "Set the international flag to check F-1 status impact.",
        nextStep: null,
        hasImpact: false,
      },
    ],
    sources: [],
    diagram: buildGroundedDiagram(resolver, bundle),
    plot: buildGroundedPlot(resolver, bundle),
    meta: { mode: "fallback", degraded: true, note },
  };
}

function fallbackNote(
  resultState: DropCheckState,
  groundingViolations: Array<Record<string, unknown>>,
): string {
  if (groundingViolations.length > 0) {
    const fields = groundingViolations
      .slice(0, 3)
      .map((v) => String(v.field ?? "?"))
      .join(", ");
    return (
      `Synthesizer cited ungrounded field(s): ${fields} — using deterministic ` +
      "phrasing."
    );
  }
  const errors = (resultState.trace_events ?? []).filter(
    (e) => e.status === "error",
  );
  if (errors.length > 0) {
    return `Agent path failed (${JSON.stringify(errors[errors.length - 1].summary)}); using fallback.`;
  }
  return "Graph produced no synthesis; using fallback.";
}

interface PersistArgs {
  studentId: string;
  query: string;
  courseCode: string;
  finalPayload: Record<string, unknown>;
  traceEvents: Array<Record<string, unknown>>;
  reportsPayload: Record<string, unknown> | null;
  conversationId: string | null;
}

async function persist(args: PersistArgs): Promise<string> {
  const sb = clientOrRaise();
  let conversationId = args.conversationId;

  if (conversationId == null) {
    const conv = await sb
      .from("conversations")
      .insert({ student_id: args.studentId, course_code: args.courseCode })
      .select("id");
    if (conv.error || !conv.data || conv.data.length === 0) {
      throw new QueryError(
        `failed to create conversation row${conv.error ? `: ${conv.error.message}` : ""}`,
      );
    }
    conversationId = String((conv.data[0] as Record<string, unknown>).id);
  }

  const userTurn = await sb
    .from("conversation_turns")
    .insert({
      conversation_id: conversationId,
      role: "user",
      query: args.query,
      response: null,
    })
    .select("id");
  if (userTurn.error || !userTurn.data || userTurn.data.length === 0) {
    throw new QueryError(
      `failed to create user turn${userTurn.error ? `: ${userTurn.error.message}` : ""}`,
    );
  }

  const responseBlob: Record<string, unknown> = { ...args.finalPayload };
  if (args.reportsPayload != null) {
    responseBlob._reports = args.reportsPayload;
  }

  const assistantTurn = await sb
    .from("conversation_turns")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      query: null,
      response: responseBlob,
    })
    .select("id");
  if (
    assistantTurn.error ||
    !assistantTurn.data ||
    assistantTurn.data.length === 0
  ) {
    throw new QueryError(
      `failed to create assistant turn${assistantTurn.error ? `: ${assistantTurn.error.message}` : ""}`,
    );
  }

  const turnId = String((assistantTurn.data[0] as Record<string, unknown>).id);
  if (args.traceEvents.length > 0) {
    const rows = args.traceEvents.map((ev, i) => ({
      conversation_turn_id: turnId,
      agent_name: String(ev.agent ?? "unknown"),
      step_order: i,
      input_summary: ev.status ?? null,
      output_summary: ev.summary ?? null,
      duration_ms: Number(ev.duration_ms ?? 0),
    }));
    await sb.from("agent_traces").insert(rows);
  }

  return conversationId;
}

export async function listConversations(
  studentId: string,
  limit: number = 50,
): Promise<Array<Record<string, unknown>>> {
  const sb = clientOrRaise();
  const r = await sb
    .from("conversations")
    .select("id, course_code, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (r.data ?? []) as Array<Record<string, unknown>>;
}

export async function getConversation(
  studentId: string,
  conversationId: string,
): Promise<{
  conversation: Record<string, unknown>;
  turns: Array<Record<string, unknown>>;
}> {
  const sb = clientOrRaise();
  const conv = await sb
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .limit(1);
  if (!conv.data || conv.data.length === 0) {
    throw new QueryError(`conversation ${JSON.stringify(conversationId)} not found`);
  }
  const convRow = conv.data[0] as Record<string, unknown>;
  if (convRow.student_id !== studentId) {
    throw new QueryError("conversation belongs to a different student");
  }

  const turns = await sb
    .from("conversation_turns")
    .select("id, role, query, response, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const clean: Array<Record<string, unknown>> = [];
  for (const turn of (turns.data ?? []) as Array<Record<string, unknown>>) {
    let resp = turn.response;
    if (resp && typeof resp === "object" && "_reports" in resp) {
      resp = Object.fromEntries(
        Object.entries(resp as Record<string, unknown>).filter(([k]) => k !== "_reports"),
      );
    }
    clean.push({ ...turn, response: resp });
  }

  return { conversation: convRow, turns: clean };
}
