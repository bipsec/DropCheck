// Rules-engine MCP tool tests. Every case invokes the tool through the
// wrapper (not the underlying pure function) so we exercise the
// CallToolResult shape end-to-end. Parity checks compare against direct
// calls into the underlying services to guarantee the wrapper doesn't
// silently drift.

import { describe, expect, it } from "vitest";
import { invokeRulesEngineTool } from "@/lib/server/mcp/rulesEngine";
import { CS_BS } from "@/lib/server/data/programs/cs_bs";
import { buildTrack } from "@/lib/server/services/trackBuilder";
import { satisfiedSet, remainingRequirements } from "@/lib/server/services/rulesEngine";
import { StudentRecord } from "@/lib/server/schemas/studentRecord";

function structured<T = Record<string, unknown>>(res: {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}): T {
  return res.structuredContent as T;
}

describe("rules-engine MCP tools", () => {
  it("test_check_prerequisites_returns_missing_list", async () => {
    // CS 301 needs CS 201 + MATH 210. Student has only CS 101.
    const res = await invokeRulesEngineTool("check_prerequisites", {
      course_code: "CS 301",
      prereqs: ["CS 201", "MATH 210"],
      completed_courses: ["CS 101"],
    });
    const out = structured<{
      satisfied: boolean;
      missing: string[];
      course_code: string;
    }>(res);
    expect(res.isError).toBeFalsy();
    expect(out.satisfied).toBe(false);
    expect(out.missing.sort()).toEqual(["CS 201", "MATH 210"]);
  });

  it("test_check_prerequisites_satisfied_when_all_present", async () => {
    const res = await invokeRulesEngineTool("check_prerequisites", {
      course_code: "CS 301",
      prereqs: ["CS 201", "MATH 210"],
      completed_courses: ["CS 101", "CS 201", "MATH 210", "ENG 150"],
    });
    const out = structured<{ satisfied: boolean; missing: string[] }>(res);
    expect(out.satisfied).toBe(true);
    expect(out.missing).toEqual([]);
  });

  it("test_check_prerequisites_normalizes_input_codes", async () => {
    // Mixed case + extra whitespace — must still match.
    const res = await invokeRulesEngineTool("check_prerequisites", {
      course_code: "cs  301",
      prereqs: ["cs 201", "math 210"],
      completed_courses: ["CS 201", "math  210"],
    });
    const out = structured<{ satisfied: boolean; course_code: string }>(res);
    expect(out.satisfied).toBe(true);
    expect(out.course_code).toBe("CS 301");
  });

  it("test_compute_degree_progress_matches_direct_call", async () => {
    // Golden parity: SDK-tool output ≡ direct rulesEngine call.
    const completed = [
      { course_code: "CS 101", credits: 3, source: "transcript" as const },
      { course_code: "MATH 210", credits: 3, source: "transcript" as const },
    ];
    const res = await invokeRulesEngineTool("compute_degree_progress", {
      program_requirements: CS_BS,
      completed_courses: completed,
      waivers: [],
    });
    const out = structured<{
      program_id: string;
      total_credits: number;
      by_category: Array<{ id: string; credits_satisfied: number }>;
    }>(res);
    expect(out.program_id).toBe("cs_bs");
    expect(out.total_credits).toBe(6); // 3 + 3

    // Compare with direct rulesEngine call.
    const student = StudentRecord.parse({
      student_id: "parity",
      program_id: "cs_bs",
      entry_type: "manual",
      max_credits_per_term: 15,
      completed_courses: completed,
    });
    const direct = remainingRequirements(CS_BS, satisfiedSet(student, CS_BS));
    for (let i = 0; i < direct.length; i += 1) {
      expect(out.by_category[i].credits_satisfied).toBe(direct[i].credits_satisfied);
    }
  });

  it("test_impact_of_dropping_cs201_lists_cascade", async () => {
    // Drop CS 201: transitively blocks CS 301 (→ CS 402), CS 340 (→ CS 402), CS 410.
    const remaining = [
      { course_code: "CS 301", prereqs: ["CS 201", "MATH 210"] },
      { course_code: "CS 340", prereqs: ["CS 201"] },
      { course_code: "CS 402", prereqs: ["CS 301", "CS 340"] },
      { course_code: "CS 410", prereqs: ["CS 201"] },
      { course_code: "MATH 220", prereqs: ["MATH 120"] }, // untouched
    ];
    const res = await invokeRulesEngineTool("impact_of_dropping", {
      course_code: "CS 201",
      remaining_courses: remaining,
    });
    const out = structured<{
      now_blocked: string[];
      unblocked_by_removal: string[];
    }>(res);
    expect(out.now_blocked.sort()).toEqual([
      "CS 301",
      "CS 340",
      "CS 402",
      "CS 410",
    ]);
    expect(out.now_blocked).not.toContain("MATH 220");
    expect(out.unblocked_by_removal).toEqual([]);
  });

  it("test_build_track_via_tool_produces_same_shape_as_direct", async () => {
    const completed = [
      { course_code: "CS 101", credits: 3, source: "transcript" as const },
      { course_code: "CS 201", credits: 3, source: "transcript" as const },
      { course_code: "MATH 210", credits: 3, source: "transcript" as const },
    ];
    const res = await invokeRulesEngineTool("build_track", {
      program_requirements: CS_BS,
      completed_courses: completed,
      waivers: [],
      max_credits_per_term: 15,
    });
    const out = structured<{
      program_id: string;
      terms: Array<{ credits_this_term: number; cumulative_credits: number }>;
      total_terms: number;
    }>(res);
    expect(out.program_id).toBe("cs_bs");
    expect(out.total_terms).toBeGreaterThan(0);
    // Invariants
    let prev = 0;
    for (const t of out.terms) {
      expect(t.credits_this_term).toBeLessThanOrEqual(15);
      expect(t.cumulative_credits).toBeGreaterThanOrEqual(prev);
      prev = t.cumulative_credits;
    }

    // Direct call parity
    const student = StudentRecord.parse({
      student_id: "parity",
      program_id: "cs_bs",
      entry_type: "manual",
      max_credits_per_term: 15,
      completed_courses: completed,
    });
    const direct = buildTrack({ student, program: CS_BS });
    expect(out.total_terms).toBe(direct.total_terms);
  });

  it("test_tool_returns_structured_error_on_bad_input", async () => {
    // Passing garbage as program_requirements — should return an
    // isError result with { error, detail } rather than throwing.
    const res = await invokeRulesEngineTool("compute_degree_progress", {
      program_requirements: { totally: "wrong shape" },
      completed_courses: [],
    });
    expect(res.isError).toBe(true);
    const out = structured<{ error: string; detail: string }>(res);
    expect(out.error).toBe("invalid_program");
    expect(out.detail).toBeTruthy();
  });

  it("test_unknown_tool_name_returns_structured_error", async () => {
    const res = await invokeRulesEngineTool("no_such_tool", {});
    expect(res.isError).toBe(true);
    const out = structured<{ error: string }>(res);
    expect(out.error).toBe("unknown_tool");
  });
});
