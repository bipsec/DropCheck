// Profile wire schemas — ported 1:1 from backend/app/schemas/profile.py.
//
// The Extracted* schemas are load-bearing: they define what the
// extraction agent tool_call input_schema looks like. Anthropic's
// structured-output validator rejects nested `Field(max_length=N)`
// constraints as "Schema too complex", so we mirror the Python decision
// and keep these deliberately loose. Runtime Zod parse still catches
// wrong types / extras.

import { z } from "zod";

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();

// --- Extraction agent I/O --------------------------------------------------

export const ExtractedCourse = strict({
  code: trim.nullable().optional(),
  title: trim.nullable().optional(),
  grade: trim.nullable().optional(),
  credits: z.number().nullable().optional(),
  semester: trim.nullable().optional(),
});
export type ExtractedCourse = z.infer<typeof ExtractedCourse>;

export const ExtractedFinance = strict({
  tuition_per_term: z.number().nullable().optional(),
  current_aid_amount: z.number().nullable().optional(),
  aid_types: z.array(z.string()).nullable().optional(),
});
export type ExtractedFinance = z.infer<typeof ExtractedFinance>;

// Opus sometimes returns "Domestic" / "International" / "yes" / "no" for the
// international flag when the transcript reads "Enrollment Status: Domestic".
// Coerce the common variants; leave `null` for anything unrecognized so the
// ProfileEditor treats it as "needs your input" rather than defaulting.
const InternationalFlag = z.preprocess((v) => {
  if (v === null || v === undefined || typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "y", "international", "f1", "f-1"].includes(s)) return true;
    if (["false", "no", "n", "domestic", "us", "usa"].includes(s)) return false;
    return null;
  }
  return v;
}, z.boolean().nullable().optional());

export const ExtractedProfile = strict({
  name: trim.nullable().optional(),
  program: trim.nullable().optional(),
  major: trim.nullable().optional(),
  expected_grad_semester: trim.nullable().optional(),
  gpa: z.number().nullable().optional(),
  total_credits_completed: z.number().nullable().optional(),
  international: InternationalFlag,
  finance_hints: ExtractedFinance.nullable().optional(),
  courses: z.array(ExtractedCourse).default([]),
});
export type ExtractedProfile = z.infer<typeof ExtractedProfile>;

// --- Patch / read models used by /profile routes ---------------------------

export const SapStatus = z.enum(["good", "warning", "probation"]);
export type SapStatus = z.infer<typeof SapStatus>;

export const DependentStatus = z.enum(["dependent", "independent"]);
export type DependentStatus = z.infer<typeof DependentStatus>;

export const StudentPatch = strict({
  name: trim.nullable().optional(),
  program: trim.nullable().optional(),
  major: trim.nullable().optional(),
  expected_grad_semester: trim.nullable().optional(),
  gpa: z.number().min(0).max(5).nullable().optional(),
  total_credits_completed: z.number().min(0).max(400).nullable().optional(),
  future_plan: trim.max(1000).nullable().optional(),
  preferences: z.record(z.string(), z.unknown()).nullable().optional(),
  international: z.boolean().nullable().optional(),
});
export type StudentPatch = z.infer<typeof StudentPatch>;

export const FinancePatch = strict({
  tuition_per_term: z.number().min(0).nullable().optional(),
  current_aid_amount: z.number().min(0).nullable().optional(),
  aid_types: z.array(z.string()).max(8).nullable().optional(),
  sap_status: SapStatus.nullable().optional(),
  employment_hours_week: z.number().int().min(0).max(168).nullable().optional(),
  dependent_status: DependentStatus.nullable().optional(),
  max_out_of_pocket: z.number().min(0).nullable().optional(),
});
export type FinancePatch = z.infer<typeof FinancePatch>;

export const ProfilePatchIn = strict({
  student: StudentPatch.optional(),
  finance: FinancePatch.optional(),
});
export type ProfilePatchIn = z.infer<typeof ProfilePatchIn>;

export const CourseIn = strict({
  course_code: trim.min(1).max(32),
  title: trim.max(200).nullable().optional(),
  grade: trim.max(8).nullable().optional(),
  credits: z.number().min(0).max(30).nullable().optional(),
  semester: trim.max(32).nullable().optional(),
});
export type CourseIn = z.infer<typeof CourseIn>;

export const CoursePatch = strict({
  course_code: trim.min(1).max(32).optional(),
  title: trim.max(200).nullable().optional(),
  grade: trim.max(8).nullable().optional(),
  credits: z.number().min(0).max(30).nullable().optional(),
  semester: trim.max(32).nullable().optional(),
  confirmed_by_student: z.boolean().optional(),
});
export type CoursePatch = z.infer<typeof CoursePatch>;

// CourseRow is what the API returns — permissive on inputs since the DB
// occasionally emits fields the schema didn't anticipate.
export const CourseRow = z.object({
  id: z.string(),
  course_code: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  credits: z.number().nullable().optional(),
  semester: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  confirmed_by_student: z.boolean().default(false),
  match_confidence: z.number().nullable().optional(),
  catalog_course_id: z.string().nullable().optional(),
});
export type CourseRow = z.infer<typeof CourseRow>;

export const CompletenessOut = z.object({
  score: z.number().min(0).max(100),
  missing_fields: z.array(z.string()),
  meets_80: z.boolean(),
});
export type CompletenessOut = z.infer<typeof CompletenessOut>;

// Read schemas — same intent as ProfileOut / UploadResult in Python.
// Kept as plain type aliases; the route handlers construct these directly.
export type ProfileOut = {
  student_id: string;
  student: Record<string, unknown>;
  finance: Record<string, unknown> | null;
  courses: CourseRow[];
  completeness: CompletenessOut;
};

export type UploadResult = {
  student_id: string;
  transcript_id: string;
  parse_method: string;
  ocr_available: boolean;
  courses_parsed: number;
  courses_matched: number;
  completeness: CompletenessOut;
  warning: string | null;
};
