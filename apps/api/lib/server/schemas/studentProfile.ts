// Schemas for the profile-memory MCP server (Phase 2).
//
// `StudentProfile` is what `get_student_profile` returns: everything in
// `StudentRecord` plus the recent advising notes the advisor has
// accumulated for this student. `StudentPatch` is what
// `update_student_profile` accepts — every field optional so the agent
// can nudge one thing at a time.

import { z } from "zod";
import {
  CompletedCourse,
  EntryType,
  InProgressCourse,
  StudentRecord,
  TransferCredit,
} from "@/lib/server/schemas/studentRecord";
import { normalizeCourse } from "@/lib/server/data/catalog";

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();
const courseCode = trim.min(1).max(32).transform(normalizeCourse);

export const AdvisingNote = strict({
  id: trim.min(1),
  topic: trim.min(1).max(120),
  reasoning: trim.min(1),
  outcome: trim.nullable().optional(),
  created_at: trim,
});
export type AdvisingNote = z.infer<typeof AdvisingNote>;

export const StudentProfile = StudentRecord.extend({
  // Extra display-only fields — the underlying `students` row has more
  // than what StudentRecord surfaces; keep them here so the advisor's
  // "get_student_profile" answer feels like the whole picture.
  name: trim.nullable().optional(),
  program_label: trim.nullable().optional(),
  major: trim.nullable().optional(),
  gpa: z.number().nullable().optional(),
  expected_grad_semester: trim.nullable().optional(),
  future_plan: trim.nullable().optional(),
  international: z.boolean().nullable().optional(),

  // Notes surfaced from the `advising_notes` table, newest first, capped.
  recent_advising_notes: z.array(AdvisingNote).default([]),
});
export type StudentProfile = z.infer<typeof StudentProfile>;

// --- Patch shape -----------------------------------------------------------

// Every field optional. `null` explicitly clears; `undefined` leaves the
// column alone. Additive on completed_courses / waivers /
// transfer_credits / in_progress_courses (never removes).
export const StudentPatch = strict({
  name: trim.nullable().optional(),
  program_id: trim.max(48).nullable().optional(),
  entry_type: EntryType.nullable().optional(),
  major: trim.nullable().optional(),
  program_label: trim.nullable().optional(),
  target_grad_term: trim.max(24).nullable().optional(),
  max_credits_per_term: z.number().int().min(1).max(30).nullable().optional(),
  institution_id: trim.max(48).nullable().optional(),
  gpa: z.number().min(0).max(5).nullable().optional(),
  expected_grad_semester: trim.max(24).nullable().optional(),
  future_plan: trim.max(1000).nullable().optional(),
  international: z.boolean().nullable().optional(),

  // Additive arrays — items are merged (dedup by course_code / course).
  completed_courses: z.array(CompletedCourse).max(200).optional(),
  in_progress_courses: z.array(InProgressCourse).max(20).optional(),
  transfer_credits: z.array(TransferCredit).max(60).optional(),
  waivers: z.array(courseCode).max(40).optional(),
});
export type StudentPatch = z.infer<typeof StudentPatch>;

export const AdvisingNoteInput = strict({
  topic: trim.min(1).max(120),
  reasoning: trim.min(1).max(4000),
  outcome: trim.max(2000).nullable().optional(),
});
export type AdvisingNoteInput = z.infer<typeof AdvisingNoteInput>;
