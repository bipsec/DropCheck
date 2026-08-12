// Wire schemas for the Degree Track & Course Advisor.
// See plan/updated_plan.md and plan/read-the-plan-and-floating-mango.md.
//
// Splits into Phase-1 contracts (Term, Course, RequirementCategory,
// ProgramRequirements) and Phase-3 additions (PlannedCourse, PlannedTerm,
// UnresolvedSlot, Track). Kept together because the two sets share the
// `Term` primitive and the Phase-3 pieces reference Phase-1 codes.

import { z } from "zod";
import { normalizeCourse } from "@/lib/server/data/catalog";

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();

// Course-code fields — normalize on parse so downstream comparators are
// case- and whitespace-invariant. "cs101" -> "CS 101".
const courseCode = trim.min(1).max(32).transform(normalizeCourse);

// --- Term ------------------------------------------------------------------

export const Season = z.enum(["Fall", "Spring", "Summer"]);
export type Season = z.infer<typeof Season>;

export const Term = strict({
  season: Season,
  year: z.number().int().min(1900).max(3000),
});
export type Term = z.infer<typeof Term>;

/** Stable string form: "Fall 2026". Used as a dict key and in URLs. */
export function termLabel(t: Term): string {
  return `${t.season} ${t.year}`;
}

// --- Course ----------------------------------------------------------------
// Superset of updated_plan.md §2.2. Mirrors CatalogCourse in
// lib/server/data/catalog.ts but wire-serializable.

export const Course = strict({
  course_code: courseCode,
  title: trim.min(1).max(200),
  credits: z.number().min(0).max(30),
  terms_offered: z.array(Season).max(4),
  prerequisites: z.array(courseCode).default([]),
  corequisites: z.array(courseCode).default([]),
  level: trim.max(32).nullable().optional(),
  tags: z.array(trim.max(32)).default([]),
});
export type Course = z.infer<typeof Course>;

// --- RequirementCategory ---------------------------------------------------
// updated_plan.md §2.1 uses three variants: an explicit course list
// ("core"), a count of picks from a pool ("choose 5 CS electives"), and
// a tag pool ("30 credits of gen ed, mixed tags"). Model as a
// discriminated union on `kind` so the scheduler can dispatch cleanly.

export const FixedCategory = strict({
  kind: z.literal("fixed"),
  id: trim.min(1).max(32),
  label: trim.min(1).max(80),
  credits_required: z.number().int().min(0).max(240),
  courses: z.array(courseCode).min(1).max(60),
});
export type FixedCategory = z.infer<typeof FixedCategory>;

export const ChooseCountCategory = strict({
  kind: z.literal("choose_count"),
  id: trim.min(1).max(32),
  label: trim.min(1).max(80),
  credits_required: z.number().int().min(0).max(240),
  choose_from: strict({
    any_of: z.array(courseCode).min(1).max(60),
    count: z.number().int().min(1).max(20),
  }),
});
export type ChooseCountCategory = z.infer<typeof ChooseCountCategory>;

export const ChooseTagCategory = strict({
  kind: z.literal("choose_tag"),
  id: trim.min(1).max(32),
  label: trim.min(1).max(80),
  credits_required: z.number().int().min(0).max(240),
  choose_from: strict({
    tags: z.array(trim.max(32)).min(1).max(12),
  }),
});
export type ChooseTagCategory = z.infer<typeof ChooseTagCategory>;

export const RequirementCategory = z.discriminatedUnion("kind", [
  FixedCategory,
  ChooseCountCategory,
  ChooseTagCategory,
]);
export type RequirementCategory = z.infer<typeof RequirementCategory>;

// --- ProgramRequirements ---------------------------------------------------

export const ProgramRequirements = strict({
  program_id: trim.min(1).max(48),
  institution_id: trim.min(1).max(48),
  total_credits_required: z.number().int().min(1).max(240),
  categories: z.array(RequirementCategory).min(1).max(24),
});
export type ProgramRequirements = z.infer<typeof ProgramRequirements>;

// --- Phase-3 additions (populated by the track builder) --------------------

export const ChosenReason = z.enum(["required", "pool_fill", "gen_ed_fill"]);
export type ChosenReason = z.infer<typeof ChosenReason>;

export const PlannedCourse = strict({
  course_code: courseCode,
  credits: z.number().min(0).max(30),
  category_id: trim.min(1).max(32),
  chosen_reason: ChosenReason,
});
export type PlannedCourse = z.infer<typeof PlannedCourse>;

export const PlannedTerm = strict({
  term: Term,
  courses: z.array(PlannedCourse).max(12),
  credits_this_term: z.number().min(0).max(30),
  cumulative_credits: z.number().min(0).max(360),
});
export type PlannedTerm = z.infer<typeof PlannedTerm>;

export const UnresolvedSlot = strict({
  category_id: trim.min(1).max(32),
  credits_needed: z.number().min(0).max(240),
  options: z.array(courseCode).max(60),
});
export type UnresolvedSlot = z.infer<typeof UnresolvedSlot>;

export const Track = strict({
  program_id: trim.min(1).max(48),
  generated_for: z.enum(["fresh", "in_progress"]),
  terms: z.array(PlannedTerm).max(40),
  total_terms: z.number().int().min(0).max(40),
  projected_grad_term: Term,
  unresolved: z.array(UnresolvedSlot).max(24),
});
export type Track = z.infer<typeof Track>;
