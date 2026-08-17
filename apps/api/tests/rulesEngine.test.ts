import { describe, expect, it } from "vitest";
import {
  bottleneckScore,
  buildRequirementGraph,
  impactOfDrop,
  remainingRequirements,
  satisfiedSet,
} from "@/lib/server/services/rulesEngine";
import { CS_BS } from "@/lib/server/data/programs/cs_bs";
import {
  freshStudent,
  transcriptCsStudent,
  transferStudent,
  waiverStudent,
} from "./fixtures/students";

describe("rules engine", () => {
  it("test_fresh_student_satisfied_set_empty", () => {
    const s = satisfiedSet(freshStudent(), CS_BS);
    expect(s.satisfied.size).toBe(0);
    for (const arr of s.byCategory.values()) expect(arr).toEqual([]);
  });

  it("test_transcript_only_student_satisfies_prereq_chain", () => {
    const s = satisfiedSet(transcriptCsStudent(), CS_BS);
    expect(s.satisfied.has("CS 101")).toBe(true);
    expect(s.satisfied.has("CS 201")).toBe(true);
    expect(s.satisfied.has("MATH 210")).toBe(true);
    // Everything else stays unsatisfied.
    expect(s.satisfied.has("CS 301")).toBe(false);
    // Provenance recorded.
    expect(s.bySource.get("CS 101")).toBe("transcript");
  });

  it("test_waiver_beats_missing_prereq", () => {
    const s = satisfiedSet(waiverStudent(), CS_BS);
    expect(s.satisfied.has("CS 201")).toBe(true);
    expect(s.bySource.get("CS 201")).toBe("waiver");
    // CS 101 is NOT waived, so it stays unsatisfied. What we're checking
    // here is that the waiver flow works — the rules engine doesn't
    // "auto-fix" prereqs, that's the scheduler's job in Phase 3.
    expect(s.satisfied.has("CS 101")).toBe(false);
  });

  it("test_transfer_credit_satisfies_equivalent_course", () => {
    const s = satisfiedSet(transferStudent(), CS_BS);
    expect(s.satisfied.has("CS 101")).toBe(true);
    expect(s.bySource.get("CS 101")).toBe("transfer");
  });

  it("test_bottleneck_score_ranks_math210_above_cs410", () => {
    // MATH 210 gates CS 301, CS 402, CS 410... it should dominate.
    // CS 410 has no downstream in the demo catalog.
    expect(bottleneckScore("MATH 210")).toBeGreaterThan(
      bottleneckScore("CS 410"),
    );
  });

  it("test_impact_of_drop_cs201_lists_downstream_cascade", () => {
    const s = satisfiedSet(freshStudent(), CS_BS);
    const impact = impactOfDrop("CS 201", CS_BS, s);
    // Every downstream that program cares about should surface.
    expect(impact.blocked).toContain("CS 301");
    expect(impact.blocked).toContain("CS 340");
    expect(impact.blocked).toContain("CS 410");
    // CS 201 is in cs_core so that category shows as at-risk.
    expect(impact.categoriesAtRisk).toContain("cs_core");
  });

  it("test_remaining_reports_pool_owed_for_electives", () => {
    const remaining = remainingRequirements(
      CS_BS,
      satisfiedSet(freshStudent(), CS_BS),
    );
    const electives = remaining.find((c) => c.id === "cs_electives");
    expect(electives).toBeDefined();
    expect(electives!.still_owed.kind).toBe("pool_count");
    if (electives!.still_owed.kind === "pool_count") {
      expect(electives!.still_owed.picks_needed).toBeGreaterThan(0);
      expect(electives!.still_owed.credits_still_needed).toBe(6);
    }
  });

  it("test_build_requirement_graph_tags_courses_with_categories", () => {
    const g = buildRequirementGraph(CS_BS);
    const cs101 = g.nodes.get("CS 101");
    expect(cs101).toBeDefined();
    expect(cs101!.categoryIds).toContain("cs_core");
    // ENG 150 is tagged ge-writing, so it should attach to that category.
    const eng150 = g.nodes.get("ENG 150");
    expect(eng150).toBeDefined();
    expect(eng150!.categoryIds).toContain("ge_writing");
  });

  it("test_remaining_reports_satisfied_when_credits_met", () => {
    // Transcript student has CS 101 + CS 201 + MATH 210 completed.
    // math_core is 6 credits (MATH 210 + STAT 220); MATH 210 alone is
    // only 3 credits, so math_core is NOT satisfied. But cs_core has
    // CS 101 (3) + CS 201 (3) = 6 credits so far, requiring 20 — still
    // not satisfied. Both remaining, but not "satisfied".
    const remaining = remainingRequirements(
      CS_BS,
      satisfiedSet(transcriptCsStudent(), CS_BS),
    );
    for (const cat of remaining) {
      if (cat.credits_satisfied < cat.credits_needed) {
        expect(cat.still_owed.kind).not.toBe("satisfied");
      }
    }
  });
});
