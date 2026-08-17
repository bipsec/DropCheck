// StudentRecord — the source-of-truth intake schema. Ported from
// updated_plan.md §2.3. Fields marked optional here are populated as
// the student progresses through intake; the resolver in Phase 4 walks
// them in the priority order documented in updated_plan.md §2.4.

import { z } from "zod";
import { normalizeCourse } from "@/lib/server/data/catalog";

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();

const courseCode = trim.min(1).max(32).transform(normalizeCourse);

// Where a completed-course record came from. Order here matters — the
// resolver's priority function assigns rank in this same order.
export const CompletedCourseSource = z.enum([
  "waiver",
  "transcript",
  "manual",
  "transfer",
]);
export type CompletedCourseSource = z.infer<typeof CompletedCourseSource>;

export const CompletedCourse = strict({
  course_code: courseCode,
  grade: trim.max(4).nullable().optional(),
  term: trim.max(24).nullable().optional(),
  credits: z.number().min(0).max(30).nullable().optional(),
  source: CompletedCourseSource,
});
export type CompletedCourse = z.infer<typeof CompletedCourse>;

export const InProgressCourse = strict({
  course_code: courseCode,
  term: trim.max(24),
});
export type InProgressCourse = z.infer<typeof InProgressCourse>;

export const TransferCredit = strict({
  external_course: trim.min(1).max(120),
  equivalent_course_code: courseCode,
  credits: z.number().min(0).max(30),
});
export type TransferCredit = z.infer<typeof TransferCredit>;

export const EntryType = z.enum(["fresh", "transcript", "manual"]);
export type EntryType = z.infer<typeof EntryType>;

export const StudentRecord = strict({
  student_id: trim.min(1).max(64),
  program_id: trim.min(1).max(48),
  entry_type: EntryType,
  completed_courses: z.array(CompletedCourse).max(200).default([]),
  in_progress_courses: z.array(InProgressCourse).max(20).default([]),
  transfer_credits: z.array(TransferCredit).max(60).default([]),
  waivers: z.array(courseCode).max(40).default([]),
  target_grad_term: trim.max(24).nullable().optional(),
  max_credits_per_term: z.number().int().min(1).max(30),
  institution_id: trim.min(1).max(48).default("generic"),
});
export type StudentRecord = z.infer<typeof StudentRecord>;
