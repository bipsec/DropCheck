import { describe, expect, it } from "vitest";
import {
  ChooseTagCategory,
  Course,
  FixedCategory,
  PlannedTerm,
  ProgramRequirements,
  RequirementCategory,
  Season,
  Term,
  Track,
  termLabel,
} from "@/lib/server/schemas/track";
import {
  CompletedCourse,
  StudentRecord,
} from "@/lib/server/schemas/studentRecord";

describe("Track + StudentRecord schemas", () => {
  it("test_normalize_course_applied_on_parse", () => {
    // normalizeCourse trims, uppercases, and collapses whitespace.
    // It does NOT insert a space between letters and digits — that's
    // deliberate; a code like "cs101" round-trips as "CS101" and
    // matches whatever canonical form the catalog stored.
    const a = CompletedCourse.parse({
      course_code: "  cs  201 ",
      source: "manual",
    });
    expect(a.course_code).toBe("CS 201");
    const b = CompletedCourse.parse({
      course_code: "math210",
      source: "waiver",
    });
    expect(b.course_code).toBe("MATH210");
  });

  it("test_student_record_schema_rejects_unknown_source", () => {
    expect(() =>
      CompletedCourse.parse({
        course_code: "CS 101",
        source: "invented" as unknown as "manual",
      }),
    ).toThrow();
  });

  it("test_student_record_defaults_arrays_to_empty", () => {
    const r = StudentRecord.parse({
      student_id: "stu-1",
      program_id: "cs_bs",
      entry_type: "fresh",
      max_credits_per_term: 15,
    });
    expect(r.completed_courses).toEqual([]);
    expect(r.in_progress_courses).toEqual([]);
    expect(r.transfer_credits).toEqual([]);
    expect(r.waivers).toEqual([]);
    expect(r.institution_id).toBe("generic");
  });

  it("test_term_label_stable", () => {
    const t: Term = { season: "Fall", year: 2026 };
    expect(termLabel(t)).toBe("Fall 2026");
    expect(Season.parse("Spring")).toBe("Spring");
  });

  it("test_course_defaults_prereqs_coreqs_and_tags_to_empty", () => {
    const c = Course.parse({
      course_code: "CS 101",
      title: "Intro",
      credits: 3,
      terms_offered: ["Fall", "Spring"],
    });
    expect(c.prerequisites).toEqual([]);
    expect(c.corequisites).toEqual([]);
    expect(c.tags).toEqual([]);
  });

  it("test_requirement_category_discriminates_on_kind", () => {
    const fixed: FixedCategory = {
      kind: "fixed",
      id: "core",
      label: "Core",
      credits_required: 12,
      courses: ["CS 101"],
    };
    const tag: ChooseTagCategory = {
      kind: "choose_tag",
      id: "ge",
      label: "General ed",
      credits_required: 6,
      choose_from: { tags: ["ge-writing"] },
    };
    expect(() => RequirementCategory.parse(fixed)).not.toThrow();
    expect(() => RequirementCategory.parse(tag)).not.toThrow();
    // Missing kind → rejection.
    expect(() =>
      RequirementCategory.parse({ ...fixed, kind: "surprise" }),
    ).toThrow();
  });

  it("test_program_requirements_requires_at_least_one_category", () => {
    expect(() =>
      ProgramRequirements.parse({
        program_id: "x",
        institution_id: "y",
        total_credits_required: 1,
        categories: [],
      }),
    ).toThrow();
  });

  it("test_track_planned_term_accepts_valid_shape", () => {
    const pt: PlannedTerm = {
      term: { season: "Fall", year: 2026 },
      courses: [
        {
          course_code: "CS 101",
          credits: 3,
          category_id: "cs_core",
          chosen_reason: "required",
        },
      ],
      credits_this_term: 3,
      cumulative_credits: 3,
    };
    expect(() => PlannedTerm.parse(pt)).not.toThrow();

    const track: Track = {
      program_id: "cs_bs",
      generated_for: "fresh",
      terms: [pt],
      total_terms: 1,
      projected_grad_term: { season: "Fall", year: 2026 },
      unresolved: [],
    };
    expect(() => Track.parse(track)).not.toThrow();
  });
});
