// Ported 1:1 from backend/tests/test_completeness.py.
import { describe, expect, it } from "vitest";
import { WEIGHTS, computeCompleteness } from "@/lib/server/services/completeness";

function fullStudent(): Record<string, unknown> {
  return {
    program: "Computer Science",
    major: "cs",
    expected_grad_semester: "Spring 2027",
    gpa: 3.4,
    total_credits_completed: 65,
    international: false,
    future_plan: "grad school",
    preferences: { prioritize: "graduate_fast" },
  };
}

function fullFinance(): Record<string, unknown> {
  return {
    tuition_per_term: 12500,
    current_aid_amount: 8000,
    aid_types: ["pell", "loan"],
    employment_hours_week: 15,
    dependent_status: "independent",
  };
}

function matchedCourses(n = 6): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    course_code: `CS ${200 + i}`,
    catalog_course_id: `cat-${i}`,
  }));
}

describe("completeness", () => {
  it("weights_sum_to_100", () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it("full_profile_hits_100", () => {
    const r = computeCompleteness(fullStudent(), fullFinance(), matchedCourses());
    expect(r.score).toBe(100);
    expect(r.missing_fields).toEqual([]);
    expect(r.meets_80).toBe(true);
  });

  it("empty_profile_zero", () => {
    const r = computeCompleteness({}, {}, []);
    expect(r.score).toBe(0);
    expect(new Set(r.missing_fields)).toEqual(new Set(Object.keys(WEIGHTS)));
    expect(r.meets_80).toBe(false);
  });

  it("international_false_counts_as_answered", () => {
    const r = computeCompleteness({ international: false }, {}, []);
    // `international` is worth 4 points and false is a valid answer.
    expect(r.score).toBe(4);
    expect(r.missing_fields).not.toContain("international");
  });

  it("courses_matched_80pct_check", () => {
    // 5 courses total, 4 matched → 80% exactly, counts.
    const courses = [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `c${i}`,
        catalog_course_id: `cat-${i}`,
      })),
      { id: "c4" },
    ];
    const r = computeCompleteness(fullStudent(), fullFinance(), courses);
    expect(r.missing_fields).not.toContain("courses_matched_80pct");
    expect(r.missing_fields).not.toContain("courses_min_5");
  });

  it("courses_below_5_flagged", () => {
    const r = computeCompleteness(fullStudent(), fullFinance(), matchedCourses(3));
    expect(r.missing_fields).toContain("courses_min_5");
  });

  it("meets_80_threshold", () => {
    const s = fullStudent();
    delete s.future_plan; // −6
    delete s.preferences; // −4
    const r = computeCompleteness(s, fullFinance(), matchedCourses());
    expect(r.score).toBe(90);
    expect(r.meets_80).toBe(true);
  });

  it("just_below_80", () => {
    // Drop enough fields to land at 78 exactly.
    const s = fullStudent();
    delete s.future_plan; // −6
    delete s.preferences; // −4
    delete s.gpa; // −6
    delete s.expected_grad_semester; // −6
    const r = computeCompleteness(s, fullFinance(), matchedCourses());
    expect(r.score).toBe(78);
    expect(r.meets_80).toBe(false);
  });
});
