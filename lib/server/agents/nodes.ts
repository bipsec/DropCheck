// Graph nodes for the DropCheck query pipeline — 1:1 port of
// backend/app/agents/nodes.py.
//
// Each node reads only the DropCheckState fields it needs and returns a
// partial update to merge into state. Nodes never throw — they capture
// errors and emit "skipped" / "error" trace events so the graph can
// proceed.

import {
  AnthropicUnavailable,
  getClient,
  runTool,
} from "@/lib/server/agents/client";
import {
  ACADEMIC_SYSTEM,
  CLARIFICATION_SYSTEM,
  FINANCIAL_SYSTEM,
  INTAKE_SYSTEM,
  ROUTER_SYSTEM,
  STATUS_SYSTEM,
  SYNTH_SYSTEM,
} from "@/lib/server/agents/prompts";
import {
  ClarificationAnswer,
  GraphCitation,
  GraphDecisionFrame,
  GraphDomainReport,
  GraphSynthOutput,
  RouterDecision,
} from "@/lib/server/agents/schemasGraph";
import type {
  DropCheckState,
  NodePartial,
  TraceEvent,
  TraceStatus,
} from "@/lib/server/agents/state";
import { CONTACTS, POLICY } from "@/lib/server/data/policy";
import {
  buildQueryContext,
  citePaths,
  QueryContextError,
  toResolverDict,
} from "@/lib/server/services/queryContext";

// Deps object so tests can spy on the internal Anthropic + Supabase calls
// without vi.mock at module-graph level. Matches the matcherDeps pattern
// in courseMatcher.ts.
export const nodesDeps = {
  getClient,
  runTool,
  buildQueryContext,
  toResolverDict,
};

// --- Trace helpers ---------------------------------------------------------

function trace(
  agent: string,
  status: TraceStatus,
  summary: string,
  duration_ms: number = 0,
): TraceEvent {
  return { agent, status, summary, duration_ms };
}

function ms(start: number): number {
  return Math.round(performance.now() - start);
}

// --- Router ----------------------------------------------------------------

export async function routerNode(state: DropCheckState): Promise<NodePartial> {
  const start = performance.now();
  const events: TraceEvent[] = [trace("router", "start", "classifying query")];

  if (!state.student_id) {
    events.push(trace("router", "error", "missing student_id", ms(start)));
    return { error: "missing student_id", trace_events: events };
  }
  if (!state.matched_course_id) {
    events.push(trace("router", "error", "missing matched_course_id", ms(start)));
    return { error: "missing matched_course_id", trace_events: events };
  }

  const prior = state.prior_turn;
  if (!prior || !state.is_followup) {
    events.push(
      trace("router", "complete", "route: new_course_check (initial)", ms(start)),
    );
    return {
      route_kind: "new_course_check",
      hypothetical_drops: [],
      route_reasoning: "initial turn",
      trace_events: events,
    };
  }

  if (nodesDeps.getClient() === null) {
    events.push(trace("router", "skipped", "no Anthropic key", ms(start)));
    return {
      route_kind: "new_course_check",
      hypothetical_drops: [],
      route_reasoning: "router LLM unavailable",
      trace_events: events,
    };
  }

  const priorSummary = summarizePrior(prior);
  const user =
    `Prior conversation summary:\n${priorSummary}\n\n` +
    `Student's new message: ${JSON.stringify(state.query ?? "")}\n\n` +
    "Classify this turn.";

  let decision;
  try {
    decision = await nodesDeps.runTool({
      system: ROUTER_SYSTEM,
      user,
      schema: RouterDecision,
      toolName: "record_router_decision",
      toolDescription: "Record the classification of the follow-up turn.",
      maxTokens: 1024,
    });
  } catch (err) {
    if (err instanceof AnthropicUnavailable) {
      events.push(trace("router", "error", err.message, ms(start)));
      return {
        route_kind: "new_course_check",
        hypothetical_drops: [],
        route_reasoning: `router error: ${err.message}`,
        trace_events: events,
      };
    }
    throw err;
  }

  const extra =
    decision.additional_drops.length > 0
      ? ` (+${decision.additional_drops.length} hypothetical drops)`
      : "";
  events.push(
    trace("router", "complete", `route: ${decision.kind}${extra}`, ms(start)),
  );
  return {
    route_kind: decision.kind,
    hypothetical_drops: decision.additional_drops.map((d) => ({ ...d })),
    route_reasoning: decision.reasoning,
    trace_events: events,
  };
}

function summarizePrior(prior: DropCheckState["prior_turn"]): string {
  if (!prior) return "";
  const course = String(prior.course_code ?? "?");
  const final = (prior.final ?? {}) as Record<string, unknown>;
  const parts = [`Prior course discussed: ${course}`];
  const headline = final.headline as string | undefined;
  const bottom = (final.bottomLine ?? final.bottom_line) as string | undefined;
  if (headline) parts.push(`Prior headline: ${headline}`);
  if (bottom) parts.push(`Prior bottom line: ${bottom}`);
  return parts.join("\n");
}

// --- Context ---------------------------------------------------------------

export async function contextNode(state: DropCheckState): Promise<NodePartial> {
  const start = performance.now();
  const events: TraceEvent[] = [
    trace("context", "start", "fetching profile + catalog"),
  ];

  if (state.error) {
    events.push(trace("context", "skipped", "prior error", ms(start)));
    return { trace_events: events };
  }

  let bundle;
  try {
    bundle = await nodesDeps.buildQueryContext(
      state.student_id!,
      state.matched_course_id!,
    );
  } catch (err) {
    if (err instanceof QueryContextError) {
      events.push(trace("context", "error", err.message, ms(start)));
      return { error: `context: ${err.message}`, trace_events: events };
    }
    throw err;
  }

  let resolver = nodesDeps.toResolverDict(bundle);
  const hypothetical = state.hypothetical_drops ?? [];
  let resolvedHypotheticals: Array<Record<string, unknown>> = [];
  if (hypothetical.length > 0) {
    const applied = await applyHypotheticalDrops(resolver, hypothetical);
    resolver = applied.resolver;
    resolvedHypotheticals = applied.resolved;
  }

  let summary = `assembled ctx for ${bundle.course_code} (importance=${bundle.importance})`;
  if (resolvedHypotheticals.length > 0) {
    const codes = resolvedHypotheticals
      .filter((h) => h.course_code)
      .map((h) => h.course_code);
    if (codes.length > 0) summary += `; also dropping ${codes.join(", ")}`;
  }
  events.push(trace("context", "complete", summary, ms(start)));

  return {
    resolver,
    hypothetical_drops:
      resolvedHypotheticals.length > 0 ? resolvedHypotheticals : hypothetical,
    trace_events: events,
  };
}

async function applyHypotheticalDrops(
  resolver: Record<string, unknown>,
  drops: Array<Record<string, unknown>>,
): Promise<{
  resolver: Record<string, unknown>;
  resolved: Array<Record<string, unknown>>;
}> {
  // Local import to avoid a cycle: courseMatcher imports catalog which
  // pulls in supabase which the nodes also use.
  const { matchCourse } = await import("@/lib/server/agents/courseMatcher");

  const after = { ...(resolver.afterDrop as Record<string, unknown>) };
  let additional = 0;
  const resolved: Array<Record<string, unknown>> = [];

  for (const drop of drops) {
    const hint = String(drop.course_hint ?? "").trim();
    if (!hint) continue;
    let result;
    try {
      result = await matchCourse(hint, 5);
    } catch {
      resolved.push({ course_hint: hint, matched: false, credits: 0 });
      continue;
    }
    if (result.match == null) {
      resolved.push({ course_hint: hint, matched: false, credits: 0 });
      continue;
    }
    const credits = Number(result.match.credits ?? 0);
    additional += credits;
    resolved.push({
      course_hint: hint,
      course_code: result.match.course_code,
      matched: true,
      credits,
      match_confidence: result.confidence,
    });
  }

  const newCredits = Math.max(0.0, Number(after.credits ?? 0) - additional);
  Object.assign(after, {
    credits: newCredits,
    deltaFromFullTime: newCredits - POLICY.FULL_TIME_MIN,
    deltaFromHalfTime: newCredits - POLICY.HALF_TIME_MIN,
    belowFullTime: newCredits < POLICY.FULL_TIME_MIN,
    belowHalfTime: newCredits < POLICY.HALF_TIME_MIN,
  });
  const newResolver: Record<string, unknown> = { ...resolver, afterDrop: after };
  const context = { ...((newResolver.context as Record<string, unknown>) ?? {}) };
  context.hypotheticalDrops = resolved;
  newResolver.context = context;
  return { resolver: newResolver, resolved };
}

// --- Intake / DecisionFrame ------------------------------------------------

export async function intakeNode(state: DropCheckState): Promise<NodePartial> {
  const start = performance.now();
  const events: TraceEvent[] = [
    trace("intake", "start", "restating decision + ambiguities"),
  ];

  if (state.error || !state.resolver) {
    events.push(trace("intake", "skipped", "no resolver context", ms(start)));
    return { trace_events: events };
  }

  if (nodesDeps.getClient() === null) {
    events.push(trace("intake", "skipped", "no Anthropic key", ms(start)));
    return { trace_events: events };
  }

  const user =
    `Student query: ${JSON.stringify(state.query ?? "")}\n\n` +
    `StudentCtx:\n${JSON.stringify(state.resolver, null, 2)}\n\n` +
    "Restate the decision plainly, list any ambiguities, " +
    "and choose the focus domains.";

  let frame;
  try {
    frame = await nodesDeps.runTool({
      system: INTAKE_SYSTEM,
      user,
      schema: GraphDecisionFrame,
      toolName: "record_decision_frame",
      toolDescription: "Record the decision frame for this query.",
      maxTokens: 2048,
    });
  } catch (err) {
    if (err instanceof AnthropicUnavailable) {
      events.push(trace("intake", "error", err.message, ms(start)));
      return { trace_events: events };
    }
    throw err;
  }

  events.push(
    trace(
      "intake",
      "complete",
      `focus: ${frame.focus_domains.join(", ")}`,
      ms(start),
    ),
  );
  return { frame, trace_events: events };
}

// --- Domain agents ---------------------------------------------------------

async function runDomain(
  state: DropCheckState,
  opts: {
    agentName: string;
    system: string;
    toolName: string;
    toolDescription: string;
    extraContext?: string;
  },
): Promise<{ report: GraphDomainReport | null; events: TraceEvent[] }> {
  const start = performance.now();
  const events: TraceEvent[] = [trace(opts.agentName, "start", "running domain agent")];

  if (state.error || !state.resolver) {
    events.push(trace(opts.agentName, "skipped", "no context", ms(start)));
    return { report: null, events };
  }
  if (nodesDeps.getClient() === null) {
    events.push(trace(opts.agentName, "skipped", "no Anthropic key", ms(start)));
    return { report: null, events };
  }

  const parts: string[] = [
    `Student query: ${JSON.stringify(state.query ?? "")}`,
    "",
    "StudentCtx:",
    JSON.stringify(state.resolver, null, 2),
  ];
  if (state.frame) {
    parts.push("", "DecisionFrame:", JSON.stringify(state.frame, null, 2));
  }
  if (opts.extraContext) {
    parts.push("", opts.extraContext);
  }
  parts.push(
    "",
    "Return your domain report. Every claim must cite a resolver, " +
      "finance, context, or policy field from the whitelist.",
  );
  const user = parts.join("\n");

  let report;
  try {
    report = await nodesDeps.runTool({
      system: opts.system,
      user,
      schema: GraphDomainReport,
      toolName: opts.toolName,
      toolDescription: opts.toolDescription,
      maxTokens: 3000,
    });
  } catch (err) {
    if (err instanceof AnthropicUnavailable) {
      events.push(trace(opts.agentName, "error", err.message, ms(start)));
      return { report: null, events };
    }
    throw err;
  }

  events.push(
    trace(opts.agentName, "complete", `verdict: ${report.verdict}`, ms(start)),
  );
  return { report, events };
}

export async function academicNode(state: DropCheckState): Promise<NodePartial> {
  const { report, events } = await runDomain(state, {
    agentName: "academic",
    system: ACADEMIC_SYSTEM,
    toolName: "record_academic_report",
    toolDescription: "Record the Academic Impact agent's report.",
  });
  return { academic_report: report, trace_events: events };
}

export async function financialNode(state: DropCheckState): Promise<NodePartial> {
  const extra =
    `Financial Aid contact (use verbatim in nextStep.contact when there is ` +
    `impact): ${CONTACTS.financial_aid}`;
  const { report, events } = await runDomain(state, {
    agentName: "financial",
    system: FINANCIAL_SYSTEM,
    toolName: "record_financial_report",
    toolDescription: "Record the Financial Aid Impact agent's report.",
    extraContext: extra,
  });
  return { financial_report: report, trace_events: events };
}

export async function statusNode(state: DropCheckState): Promise<NodePartial> {
  const resolver = (state.resolver ?? {}) as Record<string, unknown>;
  const student = (resolver.student ?? {}) as Record<string, unknown>;
  if (!student.international) {
    const events = [trace("status", "skipped", "student not international", 0)];
    const report = GraphDomainReport.parse({
      verdict: "no_impact",
      headline:
        "No status impact — this doesn't apply to your enrollment type.",
      reasoning:
        "Status impact only applies to international students on an " +
        "F-1 visa. student.international is false in the resolver.",
      citations: [
        GraphCitation.parse({ source: "resolver", field: "student.international" }),
      ],
      next_step: null,
    });
    return { status_report: report, trace_events: events };
  }

  const extra =
    `DSO contact (use verbatim in nextStep.contact when there is impact): ` +
    `${CONTACTS.dso}`;
  const { report, events } = await runDomain(state, {
    agentName: "status",
    system: STATUS_SYSTEM,
    toolName: "record_status_report",
    toolDescription: "Record the Enrollment Status / Visa agent's report.",
    extraContext: extra,
  });
  return { status_report: report, trace_events: events };
}

// --- Synthesizer + citation grounding --------------------------------------

export async function synthesisNode(state: DropCheckState): Promise<NodePartial> {
  const start = performance.now();
  const events: TraceEvent[] = [trace("synthesis", "start", "merging reports")];

  if (state.error || !state.resolver) {
    events.push(trace("synthesis", "skipped", "no context", ms(start)));
    return { trace_events: events };
  }
  if (nodesDeps.getClient() === null) {
    events.push(trace("synthesis", "skipped", "no Anthropic key", ms(start)));
    return { trace_events: events };
  }

  const academic = state.academic_report;
  const financial = state.financial_report;
  const status = state.status_report;
  if (!academic || !financial || !status) {
    events.push(
      trace("synthesis", "skipped", "missing domain reports", ms(start)),
    );
    return { trace_events: events };
  }

  const user =
    `Student query: ${JSON.stringify(state.query ?? "")}\n\n` +
    `StudentCtx:\n${JSON.stringify(state.resolver, null, 2)}\n\n` +
    `AcademicReport:\n${JSON.stringify(academic, null, 2)}\n\n` +
    `FinancialReport:\n${JSON.stringify(financial, null, 2)}\n\n` +
    `StatusReport:\n${JSON.stringify(status, null, 2)}\n\n` +
    "Produce the final synthesis. Panels must appear in order: " +
    "academic, financial, status. Every source citation must reference " +
    "a field from the resolver, finance, context, or policy whitelist.";

  let synth;
  try {
    synth = await nodesDeps.runTool({
      system: SYNTH_SYSTEM,
      user,
      schema: GraphSynthOutput,
      toolName: "record_synthesis",
      toolDescription: "Record the final synthesis output.",
      maxTokens: 4000,
    });
  } catch (err) {
    if (err instanceof AnthropicUnavailable) {
      events.push(trace("synthesis", "error", err.message, ms(start)));
      return { trace_events: events };
    }
    throw err;
  }

  // Citation grounding: variants let leaf-only or snake_case citations pass.
  const dotted = new Set(citePaths());
  const variants = new Set<string>(dotted);
  for (const path of dotted) {
    const leaf = path.includes(".") ? path.slice(path.indexOf(".") + 1) : path;
    variants.add(leaf);
    // camelCase → snake_case
    const snake = leaf
      .replace(/([A-Z])/g, (_, c: string) => `_${c.toLowerCase()}`)
      .replace(/^_/, "");
    variants.add(snake);
  }
  const bad = synth.sources.filter((c) => !variants.has(c.field));
  events.push(
    trace(
      "synthesis",
      "complete",
      `confidence=${synth.confidence}, ${bad.length} ungrounded citations`,
      ms(start),
    ),
  );

  return {
    final: synth,
    grounding_violations: bad.map((c) => ({ ...c })),
    trace_events: events,
  };
}

// --- Clarification ---------------------------------------------------------

export async function clarificationNode(state: DropCheckState): Promise<NodePartial> {
  const start = performance.now();
  const events: TraceEvent[] = [
    trace("clarification", "start", "answering follow-up"),
  ];

  if (state.error) {
    events.push(trace("clarification", "skipped", "prior error", ms(start)));
    return { trace_events: events };
  }

  const prior = state.prior_turn;
  if (!prior) {
    events.push(
      trace("clarification", "skipped", "no prior turn on state", ms(start)),
    );
    return { trace_events: events };
  }

  if (nodesDeps.getClient() === null) {
    events.push(trace("clarification", "skipped", "no Anthropic key", ms(start)));
    return { trace_events: events };
  }

  const user =
    `Student's new message: ${JSON.stringify(state.query ?? "")}\n\n` +
    "Prior conversation (compact):\n" +
    JSON.stringify(
      {
        course_code: prior.course_code,
        final: prior.final,
        academic_report: prior.academic_report,
        financial_report: prior.financial_report,
        status_report: prior.status_report,
      },
      null,
      2,
    ) +
    "\n\nAnswer the clarification. Do not re-derive numbers.";

  let answer;
  try {
    answer = await nodesDeps.runTool({
      system: CLARIFICATION_SYSTEM,
      user,
      schema: ClarificationAnswer,
      toolName: "record_clarification",
      toolDescription: "Record the clarification answer.",
      maxTokens: 1500,
    });
  } catch (err) {
    if (err instanceof AnthropicUnavailable) {
      events.push(trace("clarification", "error", err.message, ms(start)));
      return { trace_events: events };
    }
    throw err;
  }

  events.push(
    trace(
      "clarification",
      "complete",
      `confidence=${answer.confidence}`,
      ms(start),
    ),
  );
  return { clarification: answer, trace_events: events };
}
