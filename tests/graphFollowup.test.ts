// Follow-up / conversation-memory graph paths.
// Ported 1:1 from backend/tests/test_graph_followup.py — 4 cases.
//
// Same spy pattern as graph.test.ts. The what-if test additionally
// mocks the courseMatcher module so we don't need OpenAI / Supabase.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted) ------------------------------------------------

vi.mock("@/lib/server/agents/courseMatcher", () => ({
  matchCourse: vi.fn(),
}));

// --- Imports (after mocks) --------------------------------------------------

import { runGraph } from "@/lib/server/agents/graph";
import { nodesDeps } from "@/lib/server/agents/nodes";
import {
  ClarificationAnswer,
  GraphCitation,
  GraphDecisionFrame,
  GraphDomainReport,
  GraphPanel,
  GraphSynthOutput,
  HypotheticalDrop,
  RouterDecision,
} from "@/lib/server/agents/schemasGraph";
import * as courseMatcher from "@/lib/server/agents/courseMatcher";

const mockedMatcher = vi.mocked(courseMatcher);

function makeResolver(
  international: boolean = false,
  afterCredits: number = 12.0,
): Record<string, unknown> {
  return {
    course: {
      code: "CS 410",
      title: "Databases",
      credits: 3,
      termsOffered: ["Spring"],
      prereqs: ["CS 201"],
    },
    student: {
      major: "cs",
      majorName: "cs",
      totalCredits: 15.0,
      international,
      requiredForMajor: true,
    },
    finance: {
      tuitionPerTerm: 12500,
      currentAidAmount: 8000,
      aidTypes: ["pell"],
    },
    afterDrop: {
      credits: afterCredits,
      deltaFromFullTime: afterCredits - 12,
      deltaFromHalfTime: afterCredits - 6,
      belowFullTime: afterCredits < 12,
      belowHalfTime: afterCredits < 6,
    },
    prereqs: {
      downstream: ["CS 411"],
      blocksGraduation: true,
      nextOfferedTerms: ["Spring"],
      onlyOfferedOnce: true,
    },
    policy: {
      FULL_TIME_MIN: 12,
      HALF_TIME_MIN: 6,
      F1_FULL_LOAD_MIN: 12,
      SAP_MIN_PACE: 0.67,
    },
    context: { importance: "critical" },
  };
}

function makeBundle(resolver: Record<string, unknown>) {
  const course = resolver.course as Record<string, unknown>;
  const student = resolver.student as Record<string, unknown>;
  const finance = resolver.finance as Record<string, unknown>;
  const prereqs = resolver.prereqs as Record<string, unknown>;
  const ctx = resolver.context as Record<string, unknown>;
  return {
    student_id: "stu-1",
    course_code: course.code as string,
    student,
    finance,
    courses_taken: [],
    catalog_course: { course_code: course.code as string, credits: 3 },
    downstream: prereqs.downstream as string[],
    importance: ctx.importance as string,
    completeness_score: 85.0,
    completeness_meets_80: true,
  };
}

function patchContext(resolver: Record<string, unknown>) {
  vi.spyOn(nodesDeps, "buildQueryContext").mockImplementation(async () =>
    makeBundle(resolver),
  );
  vi.spyOn(nodesDeps, "toResolverDict").mockImplementation(() => resolver);
}

function priorTurn(): Record<string, unknown> {
  return {
    course_code: "CS 410",
    matched_course_id: "cat-cs410",
    academic_report: {
      verdict: "significant",
      headline: "Dropping delays graduation.",
      reasoning: "cs 410 required.",
      citations: [{ source: "resolver", field: "student.requiredForMajor" }],
    },
    financial_report: {
      verdict: "watch",
      headline: "Below full time.",
      reasoning: "12 → 9 credits.",
      citations: [{ source: "resolver", field: "afterDrop.belowFullTime" }],
    },
    status_report: {
      verdict: "no_impact",
      headline: "n/a",
      reasoning: "domestic",
      citations: [{ source: "resolver", field: "student.international" }],
    },
    final: {
      course: "CS 410",
      headline: "This drop matters.",
      bottomLine: "Talk to advising + financial aid.",
      confidence: "medium",
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedMatcher.matchCourse.mockReset();
});

describe("graph follow-up", () => {
  it("first_turn_skips_router_llm_call", async () => {
    patchContext(makeResolver(false, 12.0));
    vi.spyOn(nodesDeps, "getClient").mockReturnValue({} as never);

    let routerCalls = 0;
    let domainCalls = 0;

    vi.spyOn(nodesDeps, "runTool").mockImplementation(async ({ schema }) => {
      if (schema === RouterDecision) {
        routerCalls += 1;
        throw new Error("router should not call the LLM on the first turn");
      }
      if (schema === GraphDecisionFrame) {
        return GraphDecisionFrame.parse({
          restatement: "x",
          ambiguities: [],
          focus_domains: ["academic", "financial", "status"],
        }) as never;
      }
      if (schema === GraphDomainReport) {
        domainCalls += 1;
        return GraphDomainReport.parse({
          verdict: "watch",
          headline: "h",
          reasoning: "r",
          citations: [
            GraphCitation.parse({ source: "resolver", field: "afterDrop.credits" }),
          ],
          next_step: null,
        }) as never;
      }
      if (schema === GraphSynthOutput) {
        return GraphSynthOutput.parse({
          headline: "h",
          bottom_line: "b",
          confidence: "medium",
          panels: [
            GraphPanel.parse({
              domain: "academic",
              verdict: "v",
              detail: "d",
              next_step: null,
              next_step_detail: null,
              has_impact: false,
            }),
            GraphPanel.parse({
              domain: "financial",
              verdict: "v",
              detail: "d",
              next_step: null,
              next_step_detail: null,
              has_impact: false,
            }),
            GraphPanel.parse({
              domain: "status",
              verdict: "v",
              detail: "d",
              next_step: null,
              next_step_detail: null,
              has_impact: false,
            }),
          ],
          sources: [],
        }) as never;
      }
      throw new Error("unexpected schema");
    });

    const state = await runGraph({
      student_id: "stu-1",
      query: "Should I drop CS 410?",
      matched_course_id: "cat-cs410",
      is_followup: false,
      trace_events: [],
    });

    expect(state.route_kind).toBe("new_course_check");
    expect(routerCalls).toBe(0);
    expect(domainCalls).toBeGreaterThan(0);
    expect(state.final).not.toBeNull();
  });

  it("clarification_short_circuits_domain_agents", async () => {
    patchContext(makeResolver());
    vi.spyOn(nodesDeps, "getClient").mockReturnValue({} as never);

    const calls = { router: 0, clarification: 0, domain: 0 };

    vi.spyOn(nodesDeps, "runTool").mockImplementation(async ({ schema }) => {
      if (schema === RouterDecision) {
        calls.router += 1;
        return RouterDecision.parse({
          kind: "clarification",
          reasoning: "asking for an explanation of the earlier answer",
          additional_drops: [],
        }) as never;
      }
      if (schema === ClarificationAnswer) {
        calls.clarification += 1;
        return ClarificationAnswer.parse({
          headline: "What SAP means",
          answer:
            "Satisfactory Academic Progress — you need to pass 67% of attempted credits.",
          confidence: "high",
          sources: [GraphCitation.parse({ source: "policy", field: "SAP_MIN_PACE" })],
        }) as never;
      }
      if (
        schema === GraphDecisionFrame ||
        schema === GraphDomainReport ||
        schema === GraphSynthOutput
      ) {
        calls.domain += 1;
        throw new Error("clarification path must not run domain agents");
      }
      throw new Error("unexpected schema");
    });

    const state = await runGraph({
      student_id: "stu-1",
      query: "What is SAP?",
      matched_course_id: "cat-cs410",
      prior_turn: priorTurn(),
      is_followup: true,
      trace_events: [],
    });

    expect(state.route_kind).toBe("clarification");
    expect(calls.router).toBe(1);
    expect(calls.clarification).toBe(1);
    expect(calls.domain).toBe(0);
    expect(state.clarification).not.toBeNull();
    expect(state.final).toBeFalsy();
    const agents = new Set((state.trace_events ?? []).map((ev) => ev.agent));
    expect(agents.has("clarification")).toBe(true);
    expect(agents.has("academic")).toBe(false);
    expect(agents.has("synthesis")).toBe(false);
  });

  it("what_if_applies_hypothetical_drops", async () => {
    // Primary drop leaves 12 credits; hypothetical MATH 210 (3 more) → 9 credits.
    patchContext(makeResolver(false, 12.0));
    vi.spyOn(nodesDeps, "getClient").mockReturnValue({} as never);

    const seenPrompts: string[] = [];

    vi.spyOn(nodesDeps, "runTool").mockImplementation(async (opts) => {
      const { schema, user } = opts as { schema: unknown; user: string };
      if (schema === RouterDecision) {
        return RouterDecision.parse({
          kind: "what_if",
          reasoning: "student added a hypothetical drop",
          additional_drops: [HypotheticalDrop.parse({ course_hint: "MATH 210" })],
        }) as never;
      }
      if (schema === GraphDecisionFrame) {
        return GraphDecisionFrame.parse({
          restatement: "x",
          ambiguities: [],
          focus_domains: ["academic", "financial", "status"],
        }) as never;
      }
      if (schema === GraphDomainReport) {
        seenPrompts.push(user);
        return GraphDomainReport.parse({
          verdict: "watch",
          headline: "h",
          reasoning: "r",
          citations: [
            GraphCitation.parse({ source: "resolver", field: "afterDrop.belowFullTime" }),
          ],
          next_step: null,
        }) as never;
      }
      if (schema === GraphSynthOutput) {
        return GraphSynthOutput.parse({
          headline: "h",
          bottom_line: "b",
          confidence: "medium",
          panels: [
            GraphPanel.parse({
              domain: "academic",
              verdict: "v",
              detail: "d",
              next_step: null,
              next_step_detail: null,
              has_impact: true,
            }),
            GraphPanel.parse({
              domain: "financial",
              verdict: "v",
              detail: "d",
              next_step: null,
              next_step_detail: null,
              has_impact: true,
            }),
            GraphPanel.parse({
              domain: "status",
              verdict: "v",
              detail: "d",
              next_step: null,
              next_step_detail: null,
              has_impact: false,
            }),
          ],
          sources: [],
        }) as never;
      }
      throw new Error("unexpected schema");
    });

    mockedMatcher.matchCourse.mockImplementation(async (query: string) => ({
      query,
      match: {
        id: "cat-math210",
        course_code: "MATH 210",
        title: "Discrete Math",
        description: "",
        credits: 3.0,
        level: "undergraduate",
        similarity: 0.9,
      },
      confidence: 0.9,
      decision: "auto_accept",
      candidates: [],
      reasoning: "",
    }));

    const state = await runGraph({
      student_id: "stu-1",
      query: "What if I also drop MATH 210?",
      matched_course_id: "cat-cs410",
      prior_turn: priorTurn(),
      is_followup: true,
      trace_events: [],
    });

    expect(state.route_kind).toBe("what_if");
    // Domain agent saw the amended after-drop state: 12 - 3 = 9 credits.
    expect(seenPrompts.some((text) => /"credits":\s*9/.test(text))).toBe(true);
    expect(seenPrompts.some((text) => /"belowFullTime":\s*true/.test(text))).toBe(true);
    const hypothetical = state.hypothetical_drops ?? [];
    expect(hypothetical.length).toBeGreaterThan(0);
    expect(hypothetical[0].course_code).toBe("MATH 210");
  });

  it("router_defaults_to_full_pipeline_without_llm", async () => {
    // No Anthropic key on a follow-up → router falls back to new_course_check
    // so we don't skip legitimate work.
    patchContext(makeResolver());
    vi.spyOn(nodesDeps, "getClient").mockReturnValue(null);

    const state = await runGraph({
      student_id: "stu-1",
      query: "what if?",
      matched_course_id: "cat-1",
      prior_turn: priorTurn(),
      is_followup: true,
      trace_events: [],
    });
    expect(state.route_kind).toBe("new_course_check");
  });
});
