// Ported 1:1 from backend/tests/test_resolver.py.
// Every assertion mirrors the Python version so we know the invariants
// hold after the language shift.
import { describe, expect, it } from "vitest";
import {
  buildStudentContext,
  ctxToPromptDict,
} from "@/lib/server/services/resolver";

describe("resolver", () => {
  it("unknown_course_returns_none", () => {
    expect(buildStudentContext({ course: "XYZ 999", credits: 15 })).toBeNull();
  });

  it("cs301_cs_major_derives_required_and_blocks_graduation", () => {
    const ctx = buildStudentContext({ course: "CS 301", credits: 15, major: "cs" });
    expect(ctx).not.toBeNull();
    expect(ctx!.course.code).toBe("CS 301");
    expect(ctx!.course.credits).toBe(3);
    expect([...ctx!.course.terms_offered]).toEqual(["Fall"]);
    expect(ctx!.student.required_for_major).toBe(true);
    expect(ctx!.prereqs.only_offered_once).toBe(true);
    expect(ctx!.prereqs.blocks_graduation).toBe(true);
    // CS 402 requires CS 301; is downstream.
    expect(ctx!.prereqs.downstream).toContain("CS 402");
  });

  it("after_drop_math_at_15_credits_dropping_3", () => {
    const ctx = buildStudentContext({ course: "CS 301", credits: 15, major: "cs" });
    expect(ctx).not.toBeNull();
    expect(ctx!.after_drop.credits).toBe(12);
    expect(ctx!.after_drop.delta_from_full_time).toBe(0);
    expect(ctx!.after_drop.below_full_time).toBe(false);
  });

  it("after_drop_pushes_below_full_time", () => {
    // CS 340 = 4 credits; dropping from 14 → 10.
    const ctx = buildStudentContext({ course: "CS 340", credits: 14, major: "cs" });
    expect(ctx).not.toBeNull();
    expect(ctx!.after_drop.credits).toBe(10);
    expect(ctx!.after_drop.below_full_time).toBe(true);
    expect(ctx!.after_drop.below_half_time).toBe(false);
  });

  it("required_falls_back_to_self_report_when_major_unknown", () => {
    // BIO 210 isn't in the catalog — should be null.
    const ctx = buildStudentContext({
      course: "BIO 210",
      credits: 12,
      required_for_major: "yes",
      major: null,
    });
    expect(ctx).toBeNull();
  });

  it("self_report_yes_used_when_major_absent_but_course_known", () => {
    // ENG 150 exists but isn't in any MAJORS.required_courses, and major
    // is null → derived is "unknown", so self-report wins.
    const ctx = buildStudentContext({
      course: "ENG 150",
      credits: 15,
      required_for_major: "yes",
      major: null,
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.student.required_for_major).toBe(true);
  });

  it("self_report_unsure_leaves_unknown_when_major_absent", () => {
    const ctx = buildStudentContext({
      course: "ENG 150",
      credits: 15,
      required_for_major: "unsure",
      major: null,
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.student.required_for_major).toBe("unknown");
  });

  it("international_flag_flows_through", () => {
    const ctx = buildStudentContext({
      course: "CS 301",
      credits: 15,
      international: true,
      major: "cs",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.student.international).toBe(true);
  });

  it("normalization_handles_whitespace_and_case", () => {
    const ctx = buildStudentContext({ course: "  cs   301 ", credits: 15, major: "cs" });
    expect(ctx).not.toBeNull();
    expect(ctx!.course.code).toBe("CS 301");
  });

  it("ctx_to_prompt_dict_matches_ts_shape", () => {
    const ctx = buildStudentContext({ course: "CS 301", credits: 15, major: "cs" });
    expect(ctx).not.toBeNull();
    const d = ctxToPromptDict(ctx!) as {
      course: { termsOffered: string[] };
      afterDrop: { belowFullTime: boolean };
      prereqs: { blocksGraduation: boolean };
      policy: { FULL_TIME_MIN: number };
    };
    expect(d.course.termsOffered).toEqual(["Fall"]);
    expect(d.afterDrop.belowFullTime).toBe(false);
    expect(d.prereqs.blocksGraduation).toBe(true);
    expect(d.policy.FULL_TIME_MIN).toBe(12);
  });
});
