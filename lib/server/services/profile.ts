// Profile service — Supabase reads/writes for students / student_finance /
// courses_taken tables, plus the transcript upload orchestration.
// Ported 1:1 from backend/app/services/profile.py.
//
// Every query is scoped by `student_id` (from the session cookie) — one
// row per Supabase call, no cross-student leakage possible.

import { matchCourse } from "@/lib/server/agents/courseMatcher";
import { normalizeCourse } from "@/lib/server/data/catalog";
import type { ExtractedProfile } from "@/lib/server/schemas/profile";
import type { CompletenessOut } from "@/lib/server/schemas/profile";
import { computeCompleteness } from "@/lib/server/services/completeness";
import { getSupabase } from "@/lib/server/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

type Row = Record<string, unknown>;

function clientOrRaise(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) {
    throw new ProfileError(
      "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return sb;
}

/** Drop fields whose value is `null` or `undefined`. Preserves `false` / `0` / `""`. */
function dropNil<T extends Row>(fields: T): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch

async function fetchStudent(studentId: string): Promise<Row> {
  const sb = clientOrRaise();
  const { data, error } = await sb.from("students").select("*").eq("id", studentId).limit(1);
  if (error) throw new ProfileError(`student fetch failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new ProfileError(`student ${JSON.stringify(studentId)} not found`);
  }
  return data[0] as Row;
}

async function fetchFinance(studentId: string): Promise<Row | null> {
  const sb = clientOrRaise();
  const { data, error } = await sb
    .from("student_finance")
    .select("*")
    .eq("student_id", studentId)
    .limit(1);
  if (error) throw new ProfileError(`finance fetch failed: ${error.message}`);
  return data && data.length > 0 ? (data[0] as Row) : null;
}

async function fetchCourses(studentId: string): Promise<Row[]> {
  const sb = clientOrRaise();
  const { data, error } = await sb
    .from("courses_taken")
    .select("*")
    .eq("student_id", studentId)
    .order("semester", { ascending: true });
  if (error) throw new ProfileError(`courses fetch failed: ${error.message}`);
  return (data ?? []) as Row[];
}

export interface ProfileBundle {
  student_id: string;
  student: Row;
  finance: Row | null;
  courses: Row[];
  completeness: {
    score: number;
    missing_fields: string[];
    meets_80: boolean;
  };
}

export async function getProfile(studentId: string): Promise<ProfileBundle> {
  const [student, finance, courses] = await Promise.all([
    fetchStudent(studentId),
    fetchFinance(studentId),
    fetchCourses(studentId),
  ]);
  const completeness = computeCompleteness(student, finance, courses);
  return { student_id: studentId, student, finance, courses, completeness };
}

// ---------------------------------------------------------------------------
// Update

export async function patchStudent(studentId: string, fields: Row): Promise<Row> {
  const sb = clientOrRaise();
  const payload = dropNil(fields);
  if (Object.keys(payload).length === 0) return fetchStudent(studentId);
  const { data, error } = await sb
    .from("students")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", studentId)
    .select("*");
  if (error) throw new ProfileError(`student update failed: ${error.message}`);
  if (!data || data.length === 0) throw new ProfileError("student update returned no rows");
  return data[0] as Row;
}

export async function upsertFinance(studentId: string, fields: Row): Promise<Row | null> {
  const sb = clientOrRaise();
  const payload = dropNil(fields);
  if (Object.keys(payload).length === 0) return fetchFinance(studentId);
  const merged = { ...payload, student_id: studentId, updated_at: new Date().toISOString() };
  const { data, error } = await sb
    .from("student_finance")
    .upsert(merged, { onConflict: "student_id" })
    .select("*");
  if (error) throw new ProfileError(`finance upsert failed: ${error.message}`);
  return data && data.length > 0 ? (data[0] as Row) : null;
}

// ---------------------------------------------------------------------------
// Courses

export async function addCourse(studentId: string, fields: Row): Promise<Row> {
  const sb = clientOrRaise();
  const rawCode = fields.course_code;
  if (typeof rawCode !== "string" || !rawCode.trim()) {
    throw new ProfileError("course_code is required");
  }
  const payload = {
    student_id: studentId,
    course_code: normalizeCourse(rawCode),
    title: fields.title ?? null,
    grade: fields.grade ?? null,
    credits: fields.credits ?? null,
    semester: fields.semester ?? null,
    source: "manual_edit",
    confirmed_by_student: true,
  };
  const { data, error } = await sb.from("courses_taken").insert(payload).select("*");
  if (error) throw new ProfileError(`course insert failed: ${error.message}`);
  if (!data || data.length === 0) throw new ProfileError("courses_taken insert returned no rows");
  return data[0] as Row;
}

export async function patchCourse(
  studentId: string,
  courseId: string,
  fields: Row,
): Promise<Row> {
  const sb = clientOrRaise();
  const payload = dropNil(fields);
  const rawCode = payload.course_code;
  if (typeof rawCode === "string") payload.course_code = normalizeCourse(rawCode);
  if (!("confirmed_by_student" in payload)) {
    // Any manual edit implies confirmation unless the caller explicitly said otherwise.
    payload.confirmed_by_student = true;
  }
  const { data, error } = await sb
    .from("courses_taken")
    .update(payload)
    .eq("id", courseId)
    .eq("student_id", studentId)
    .select("*");
  if (error) throw new ProfileError(`course update failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new ProfileError(
      `course ${JSON.stringify(courseId)} not found for student ${JSON.stringify(studentId)}`,
    );
  }
  return data[0] as Row;
}

export async function deleteCourse(studentId: string, courseId: string): Promise<void> {
  const sb = clientOrRaise();
  await sb
    .from("courses_taken")
    .delete()
    .eq("id", courseId)
    .eq("student_id", studentId);
}

// ---------------------------------------------------------------------------
// Upload orchestration

/**
 * Merge an ExtractedProfile into students/finance/courses tables.
 * Non-null fields overwrite; null fields are left alone (so a student's
 * manual edits survive a re-upload).
 */
export async function applyExtraction(
  studentId: string,
  profile: ExtractedProfile,
): Promise<void> {
  const studentUpdates = dropNil({
    name: profile.name,
    program: profile.program,
    major: profile.major,
    expected_grad_semester: profile.expected_grad_semester,
    gpa: profile.gpa,
    total_credits_completed: profile.total_credits_completed,
    international: profile.international,
  });
  if (Object.keys(studentUpdates).length > 0) {
    await patchStudent(studentId, studentUpdates);
  }

  if (profile.finance_hints) {
    const financeUpdates = dropNil({
      tuition_per_term: profile.finance_hints.tuition_per_term,
      current_aid_amount: profile.finance_hints.current_aid_amount,
      aid_types: profile.finance_hints.aid_types,
    });
    if (Object.keys(financeUpdates).length > 0) {
      await upsertFinance(studentId, financeUpdates);
    }
  }

  // Replace this student's parse-sourced, unconfirmed courses with the
  // fresh batch. Manual rows + student-confirmed rows are kept.
  const sb = clientOrRaise();
  const del = await sb
    .from("courses_taken")
    .delete()
    .eq("student_id", studentId)
    .eq("source", "transcript_parse")
    .eq("confirmed_by_student", false);
  if (del.error) throw new ProfileError(`course sweep failed: ${del.error.message}`);

  const rows = profile.courses
    .filter((c) => c.code)
    .map((c) => ({
      student_id: studentId,
      course_code: normalizeCourse(c.code!),
      title: c.title ?? null,
      grade: c.grade ?? null,
      credits: c.credits ?? null,
      semester: c.semester ?? null,
      source: "transcript_parse",
      confirmed_by_student: false,
    }));

  if (rows.length > 0) {
    const ins = await sb.from("courses_taken").insert(rows);
    if (ins.error) throw new ProfileError(`course batch insert failed: ${ins.error.message}`);
  }
}

/**
 * Run the matcher over every unmatched row for this student. Returns the
 * number of rows whose confidence lands ≥ 0.5. Single-row failures are
 * logged and skipped; the upload never crashes on matcher errors.
 */
export async function matchNewCourses(studentId: string): Promise<number> {
  const sb = clientOrRaise();
  const { data, error } = await sb
    .from("courses_taken")
    .select("id, course_code, title")
    .eq("student_id", studentId)
    .is("catalog_course_id", null);
  if (error) throw new ProfileError(`unmatched fetch failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; course_code: string | null; title: string | null }>;
  let matched = 0;

  for (const row of rows) {
    const query = [row.course_code, row.title].filter(Boolean).join(" ").trim();
    if (!query) continue;

    let result: Awaited<ReturnType<typeof matchCourse>>;
    try {
      result = await matchCourse(query, 5);
    } catch (err) {
      console.warn(
        `[profile] matcher failed for course ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    if (result.match === null) continue;

    const update = await sb
      .from("courses_taken")
      .update({
        catalog_course_id: result.match.id,
        match_confidence: result.confidence,
      })
      .eq("id", row.id);
    if (update.error) {
      console.warn(
        `[profile] could not persist match for ${row.id}:`,
        update.error.message,
      );
      continue;
    }
    if (result.confidence >= 0.5) matched += 1;
  }

  return matched;
}

/** Persist the raw markdown + extraction JSON. Returns the transcript_id. */
export async function recordTranscript(
  studentId: string,
  parsedMarkdown: string,
  extractionJson: Record<string, unknown> | null,
  rawFilePath: string | null = null,
): Promise<string> {
  const sb = clientOrRaise();
  const { data, error } = await sb
    .from("transcripts")
    .insert({
      student_id: studentId,
      parsed_markdown: parsedMarkdown.slice(0, 200_000),
      extraction_json: extractionJson,
      raw_file_path: rawFilePath,
    })
    .select("id");
  if (error) throw new ProfileError(`transcript insert failed: ${error.message}`);
  if (!data || data.length === 0) throw new ProfileError("transcript insert returned no rows");
  return (data[0] as { id: string }).id;
}

export async function completenessFor(studentId: string): Promise<CompletenessOut> {
  const [student, finance, courses] = await Promise.all([
    fetchStudent(studentId),
    fetchFinance(studentId),
    fetchCourses(studentId),
  ]);
  const r = computeCompleteness(student, finance, courses);
  return { score: r.score, missing_fields: r.missing_fields, meets_80: r.meets_80 };
}
