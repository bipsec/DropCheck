// Offline tests for the async graph orchestrator.
// Ported 1:1 from backend/tests/test_graph.py — 5 cases.
//
// We spy on `nodesDeps.runTool`, `nodesDeps.getClient`,
// `nodesDeps.buildQueryContext`, and `nodesDeps.toResolverDict` so the
// graph runs end-to-end without any external service. Same monkeypatch
// pattern the Python tests used, adapted to Vitest's vi.spyOn.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { runGraph } from "@/lib/server/agents/graph";
import { nodesDeps } from "@/lib/server/agents/nodes";
import {
  GraphCitation,
  GraphDecisionFrame,
  GraphDomainReport,
  GraphNextStep,
  GraphPanel,
  GraphSynthOutput,
} from "@/lib/server/agents/schemasGraph";

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
    context: {
      importance: "critical",
      completenessScore: 85.0,
      completenessMeets80: true,
    },
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
    catalog_course: { course_code: course.code as string },
    downstream: prereqs.downstream as string[],
    importance: ctx.importance as string,
    completeness_score: (ctx.completenessScore as number) ?? 0,
    completeness_meets_80: (ctx.completenessMeets80 as boolean) ?? false,
  };
}

function patchContext(resolver: Record<string, unknown>) {
  vi.spyOn(nodesDeps, "buildQueryContext").mockImplementation(async () =>
    makeBundle(resolver),
  );
  vi.spyOn(nodesDeps, "toResolverDict").mockImplementation(() => resolver);
}

function patchLlm(opts: { noKey?: boolean } = {}) {
  if (opts.noKey) {
    vi.spyOn(nodesDeps, "getClient").mockReturnValue(null);
    return;
  }
  vi.spyOn(nodesDeps, "getClient").mockReturnValue({} as never);
  vi.spyOn(nodesDeps, "runTool").mockImplementation(async ({ schema }) => {
    if (schema === GraphDecisionFrame) {
      return GraphDecisionFrame.parse({
        restatement: "Dropping CS 410.",
        ambiguities: [],
        focus_domains: ["academic", "financial", "status"],
      }) as never;
    }
    if (schema === GraphDomainReport) {
      return GraphDomainReport.parse({
        verdict: "significant",
        headline: "This affects your plan.",
        reasoning: "Cited afterDrop.belowFullTime.",
        citations: [
          GraphCitation.parse({ source: "resolver", field: "afterDrop.belowFullTime" }),
        ],
        next_step: GraphNextStep.parse({
          label: "Talk to your advisor",
          detail: "Confirm before the deadline.",
          contact: null,
        }),
      }) as never;
    }
    if (schema === GraphSynthOutput) {
      return GraphSynthOutput.parse({
        headline: "You'd feel this drop.",
        bottom_line: "Confirm with advising + financial aid.",
        confidence: "medium",
        panels: [
          GraphPanel.parse({
            domain: "academic",
            verdict: "Delays graduation.",
            detail: "Only offered in Spring.",
            next_step: "Advisor",
            next_step_detail: null,
            has_impact: true,
          }),
          GraphPanel.parse({
            domain: "financial",
            verdict: "Below full-time.",
            detail: "10 credits after drop.",
            next_step: "Financial Aid",
            next_step_detail: null,
            has_impact: true,
          }),
          GraphPanel.parse({
            domain: "status",
            verdict: "No status impact.",
            detail: "n/a",
            next_step: null,
            next_step_detail: null,
            has_impact: false,
          }),
        ],
        sources: [
          GraphCitation.parse({ source: "resolver", field: "afterDrop.belowFullTime" }),
          GraphCitation.parse({ source: "resolver", field: "prereqs.blocksGraduation" }),
        ],
      }) as never;
    }
    throw new Error(`unexpected schema in test`);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("graph orchestrator", () => {
  it("happy_path_produces_final", async () => {
    patchContext(makeResolver(false, 10.0));
    patchLlm();

    const state = await runGraph({
      student_id: "stu-1",
      query: "Should I drop CS 410?",
      matched_course_id: "cat-cs410",
      trace_events: [],
    });

    expect(state.error).toBeFalsy();
    expect(state.final).not.toBeNull();
    expect(state.final?.panels).toHaveLength(3);
    const domains = new Set(state.final?.panels.map((p) => p.domain));
    expect(domains).toEqual(new Set(["academic", "financial", "status"]));

    const agents = new Set((state.trace_events ?? []).map((ev) => ev.agent));
    for (const a of [
      "router",
      "context",
      "intake",
      "academic",
      "financial",
      "status",
      "synthesis",
    ]) {
      expect(agents.has(a)).toBe(true);
    }
  });

  it("missing_student_id_short_circuits", async () => {
    patchContext(makeResolver());
    patchLlm();

    const state = await runGraph({
      query: "Q",
      matched_course_id: "cat-1",
      trace_events: [],
    });

    expect(state.error).toBe("missing student_id");
    expect(state.final).toBeFalsy();
  });

  it("status_short_circuit_when_not_international", async () => {
    patchContext(makeResolver(false));
    patchLlm();

    const state = await runGraph({
      student_id: "stu-1",
      query: "Q",
      matched_course_id: "cat-1",
      trace_events: [],
    });

    const statusEvents = (state.trace_events ?? []).filter(
      (ev) => ev.agent === "status",
    );
    expect(statusEvents.some((ev) => ev.status === "skipped")).toBe(true);
    expect(state.status_report).not.toBeNull();
    expect(state.status_report?.verdict).toBe("no_impact");
  });

  it("no_anthropic_key_skips_llm_nodes", async () => {
    patchContext(makeResolver());
    patchLlm({ noKey: true });

    const state = await runGraph({
      student_id: "stu-1",
      query: "Q",
      matched_course_id: "cat-1",
      trace_events: [],
    });

    const intakeEvents = (state.trace_events ?? []).filter(
      (ev) => ev.agent === "intake",
    );
    expect(intakeEvents.some((ev) => ev.status === "skipped")).toBe(true);
    expect(state.final).toBeFalsy();
  });

  it("grounding_violations_flagged", async () => {
    patchContext(makeResolver(false, 10.0));
    vi.spyOn(nodesDeps, "getClient").mockReturnValue({} as never);
    vi.spyOn(nodesDeps, "runTool").mockImplementation(async ({ schema }) => {
      if (schema === GraphDecisionFrame) {
        return GraphDecisionFrame.parse({
          restatement: "x",
          ambiguities: [],
          focus_domains: ["academic", "financial", "status"],
        }) as never;
      }
      if (schema === GraphDomainReport) {
        return GraphDomainReport.parse({
          verdict: "watch",
          headline: "ok",
          reasoning: "ok",
          citations: [
            GraphCitation.parse({ source: "resolver", field: "afterDrop.credits" }),
          ],
        }) as never;
      }
      if (schema === GraphSynthOutput) {
        return GraphSynthOutput.parse({
          headline: "h",
          bottom_line: "b",
          confidence: "high",
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
          sources: [
            GraphCitation.parse({ source: "resolver", field: "totally.fake.field" }),
          ],
        }) as never;
      }
      throw new Error("unexpected schema");
    });

    const state = await runGraph({
      student_id: "stu-1",
      query: "Q",
      matched_course_id: "cat-1",
      trace_events: [],
    });

    expect(state.grounding_violations).toBeTruthy();
    expect(state.grounding_violations?.[0]?.field).toBe("totally.fake.field");
  });
});
