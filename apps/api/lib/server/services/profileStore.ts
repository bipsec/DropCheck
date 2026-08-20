// Supabase read/write layer for the profile-memory MCP server.
//
// Deliberately thin: one function per SQL round trip, no business
// logic. The MCP tools in lib/server/mcp/profileMemory.ts compose these
// into user-facing operations. Every function throws `ProfileStoreError`
// on Supabase failure — the tool layer catches + converts to the
// `{ error, detail }` MCP shape.
//
// Priority order for merges (updated_plan.md §2.4):
//   waiver > transcript > manual > transfer
// A stronger source overwrites a weaker one on the same course_code.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCourse } from "@/lib/server/data/catalog";
import type {
  CompletedCourse,
  CompletedCourseSource,
  InProgressCourse,
  TransferCredit,
} from "@/lib/server/schemas/studentRecord";
import type {
  AdvisingNote,
  AdvisingNoteInput,
  AdvisingNoteStance,
  StudentPatch,
  StudentProfile,
} from "@/lib/server/schemas/studentProfile";
import { getSupabase } from "@/lib/server/supabase";

export class ProfileStoreError extends Error {
  constructor(
    message: string,
    public code: string = "profile_store_error",
  ) {
    super(message);
    this.name = "ProfileStoreError";
  }
}

function clientOrRaise(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) {
    throw new ProfileStoreError(
      "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      "unavailable",
    );
  }
  return sb;
}

// --- Supabase select unwrapping -------------------------------------------
//
// `readProfile` fans five selects out in parallel, and four of them used
// to end in `?? []`. That silently converts a failed query into an empty
// table — "no completed courses", "no waivers", "no advising notes" — a
// confident false statement, which is the exact failure class the
// advising guardrails exist to prevent. Worse, it's invisible: the
// advisor rebuilds a plan from scratch, or loses every note, with no
// error anywhere. A forgotten migration is the likeliest cause, so the
// error names the file that fixes it.
//
// Failing loudly costs less availability than it appears to. All five
// queries share one client, so a genuine Supabase outage fails the
// `students` lookup and throws before reaching here. One table failing
// while the other four succeed is structural — a missing column or an
// RLS policy — and it will not clear on its own.

type SelectResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function isSchemaError(message: string): boolean {
  return /schema cache|does not exist|not found/i.test(message);
}

/**
 * Which SQL file adds the advising-note fields this code selects. The
 * columns arrived in phase 5 while the table itself predates it, so the
 * hint has to distinguish them or it sends you to the wrong file.
 */
function advisingNotesMigration(message: string): string {
  return /stance|retracted_at|retraction_reason/i.test(message)
    ? "phase5_migration.sql"
    : "schema.sql";
}

function rowsOrRaise(
  result: SelectResult,
  table: string,
  migrationFile: string,
): Array<Record<string, unknown>> {
  const { data, error } = result;
  if (error) {
    if (isSchemaError(error.message)) {
      throw new ProfileStoreError(
        `${table} is missing expected columns (or the table itself). Apply ` +
          `db/${migrationFile} via the Supabase SQL editor once, then retry. ` +
          `Raw error: ${error.message}`,
        "migration_needed",
      );
    }
    throw new ProfileStoreError(`${table} lookup failed: ${error.message}`);
  }
  return (data ?? []) as Array<Record<string, unknown>>;
}

// --- Priority ranking (updated_plan.md §2.4) ------------------------------

const SOURCE_RANK: Record<CompletedCourseSource, number> = {
  waiver: 0,
  transcript: 1,
  manual: 2,
  transfer: 3,
};

// --- readProfile ----------------------------------------------------------

const RECENT_NOTE_LIMIT = 8;

export async function readProfile(studentId: string): Promise<StudentProfile> {
  const sb = clientOrRaise();

  const [studentRow, coursesRow, waiversRow, transfersRow, notesRow] =
    await Promise.all([
      sb.from("students").select("*").eq("id", studentId).limit(1),
      sb
        .from("courses_taken")
        .select(
          "course_code, grade, credits, semester, source, is_in_progress",
        )
        .eq("student_id", studentId),
      sb
        .from("student_waivers")
        .select("course_code")
        .eq("student_id", studentId),
      sb
        .from("student_transfers")
        .select("external_course, equivalent_course_code, credits")
        .eq("student_id", studentId),
      sb
        .from("advising_notes")
        .select("id, topic, reasoning, outcome, stance, created_at")
        .eq("student_id", studentId)
        // Retracted notes are soft-deleted: the row stays for the audit
        // trail but must never resurface as advisor context, or a note
        // the student already corrected keeps steering future turns.
        .is("retracted_at", null)
        .order("created_at", { ascending: false })
        .limit(RECENT_NOTE_LIMIT),
    ]);

  if (studentRow.error) {
    throw new ProfileStoreError(
      `students lookup failed: ${studentRow.error.message}`,
    );
  }
  if (!studentRow.data || studentRow.data.length === 0) {
    throw new ProfileStoreError(
      `student ${JSON.stringify(studentId)} not found`,
      "not_found",
    );
  }
  const s = studentRow.data[0] as Record<string, unknown>;

  const coursesRaw = rowsOrRaise(coursesRow, "courses_taken", "schema.sql");
  const completed: CompletedCourse[] = [];
  const inProgress: InProgressCourse[] = [];
  for (const row of coursesRaw) {
    const code = normalizeCourse(String(row.course_code ?? ""));
    if (!code) continue;
    if (row.is_in_progress) {
      inProgress.push({
        course_code: code,
        term: String(row.semester ?? ""),
      });
      continue;
    }
    completed.push({
      course_code: code,
      grade: (row.grade as string | null) ?? null,
      term: (row.semester as string | null) ?? null,
      credits:
        row.credits === null || row.credits === undefined
          ? null
          : Number(row.credits),
      source: coalesceSource(row.source),
    });
  }

  const waivers = rowsOrRaise(waiversRow, "student_waivers", "schema.sql").map(
    (w) => normalizeCourse(String(w.course_code ?? "")),
  );

  const transfers = rowsOrRaise(
    transfersRow,
    "student_transfers",
    "schema.sql",
  ).map<TransferCredit>((t) => ({
    external_course: String(t.external_course ?? ""),
    equivalent_course_code: normalizeCourse(
      String(t.equivalent_course_code ?? ""),
    ),
    credits: Number(t.credits ?? 0),
  }));

  const notes = rowsOrRaise(
    notesRow,
    "advising_notes",
    advisingNotesMigration(notesRow.error?.message ?? ""),
  ).map<AdvisingNote>((n) => ({
    id: String(n.id ?? ""),
    topic: String(n.topic ?? ""),
    reasoning: String(n.reasoning ?? ""),
    outcome: (n.outcome as string | null) ?? null,
    stance: coalesceStance(n.stance),
    created_at: String(n.created_at ?? ""),
  }));

  return {
    student_id: String(s.id),
    program_id: (s.program_id as string | null) ?? "",
    entry_type: ((s.entry_type as string | null) ?? "fresh") as
      | "fresh"
      | "transcript"
      | "manual",
    completed_courses: completed,
    in_progress_courses: inProgress,
    transfer_credits: transfers,
    waivers,
    target_grad_term: (s.target_grad_term as string | null) ?? null,
    max_credits_per_term: Number(s.max_credits_per_term ?? 15),
    institution_id: (s.institution_id as string | null) ?? "generic",
    name: (s.name as string | null) ?? null,
    program_label: (s.program as string | null) ?? null,
    major: (s.major as string | null) ?? null,
    gpa: s.gpa === null || s.gpa === undefined ? null : Number(s.gpa),
    expected_grad_semester:
      (s.expected_grad_semester as string | null) ?? null,
    future_plan: (s.future_plan as string | null) ?? null,
    international: (s.international as boolean | null) ?? null,
    recent_advising_notes: notes,
  };
}

function coalesceSource(raw: unknown): CompletedCourseSource {
  const s = String(raw ?? "").toLowerCase();
  if (s === "transcript" || s.includes("transcript")) return "transcript";
  if (s === "waiver") return "waiver";
  if (s === "transfer") return "transfer";
  return "manual";
}

/**
 * Rows written before phase5_migration.sql have no `stance` column, and
 * we can't retroactively know whether those notes recorded a decision.
 * `exploring` is the safe read: it under-claims the student's commitment
 * rather than over-claiming it.
 */
function coalesceStance(raw: unknown): AdvisingNoteStance {
  const s = String(raw ?? "").toLowerCase();
  if (s === "decided") return "decided";
  if (s === "advised") return "advised";
  return "exploring";
}

// --- applyPatch -----------------------------------------------------------
// Overwrite scalar fields (with `null` explicitly clearing). Merge
// arrays with priority-aware dedup on completed_courses; append + dedup
// on waivers, transfers, in_progress_courses.

const SCALAR_FIELDS: Record<string, string> = {
  // patch field -> students column name
  name: "name",
  program_id: "program_id",
  entry_type: "entry_type",
  major: "major",
  program_label: "program",
  target_grad_term: "target_grad_term",
  max_credits_per_term: "max_credits_per_term",
  institution_id: "institution_id",
  gpa: "gpa",
  expected_grad_semester: "expected_grad_semester",
  future_plan: "future_plan",
  international: "international",
};

export async function applyPatch(
  studentId: string,
  patch: StudentPatch,
): Promise<void> {
  const sb = clientOrRaise();

  // 1. Scalar columns on the students row.
  const scalarUpdate: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(SCALAR_FIELDS)) {
    if (key in patch) {
      scalarUpdate[column] =
        (patch as Record<string, unknown>)[key] ?? null;
    }
  }
  if (Object.keys(scalarUpdate).length > 0) {
    scalarUpdate.updated_at = new Date().toISOString();
    const upd = await sb
      .from("students")
      .update(scalarUpdate)
      .eq("id", studentId);
    if (upd.error) {
      throw new ProfileStoreError(
        `students update failed: ${upd.error.message}`,
      );
    }
  }

  // 2. Completed courses — priority-aware merge. Read current rows,
  // decide keep vs. replace based on §2.4 rank, then upsert.
  if (patch.completed_courses && patch.completed_courses.length > 0) {
    const existing = await sb
      .from("courses_taken")
      .select("course_code, source")
      .eq("student_id", studentId);
    if (existing.error) {
      throw new ProfileStoreError(
        `courses_taken read failed: ${existing.error.message}`,
      );
    }
    const currentRank = new Map<string, number>();
    for (const row of (existing.data ?? []) as Array<{
      course_code: string;
      source: string;
    }>) {
      currentRank.set(
        normalizeCourse(row.course_code),
        SOURCE_RANK[coalesceSource(row.source)] ?? 99,
      );
    }
    const toInsert: Array<Record<string, unknown>> = [];
    const toDelete: string[] = [];
    for (const c of patch.completed_courses) {
      const code = normalizeCourse(c.course_code);
      const incomingRank = SOURCE_RANK[c.source];
      const existingRankVal = currentRank.get(code);
      if (existingRankVal === undefined) {
        toInsert.push(courseRow(studentId, code, c));
      } else if (incomingRank <= existingRankVal) {
        // Stronger (or same) source: replace the existing row.
        toDelete.push(code);
        toInsert.push(courseRow(studentId, code, c));
      }
      // Weaker source than what's already there: silently skip. The
      // student's stronger record wins per §2.4.
    }
    if (toDelete.length > 0) {
      const del = await sb
        .from("courses_taken")
        .delete()
        .eq("student_id", studentId)
        .in("course_code", toDelete);
      if (del.error) {
        throw new ProfileStoreError(
          `courses_taken delete failed: ${del.error.message}`,
        );
      }
    }
    if (toInsert.length > 0) {
      const ins = await sb.from("courses_taken").insert(toInsert);
      if (ins.error) {
        throw new ProfileStoreError(
          `courses_taken insert failed: ${ins.error.message}`,
        );
      }
    }
  }

  // 3. Waivers — additive; onConflict on the (student, course) unique key.
  if (patch.waivers && patch.waivers.length > 0) {
    const rows = patch.waivers.map((w) => ({
      student_id: studentId,
      course_code: normalizeCourse(w),
    }));
    const up = await sb
      .from("student_waivers")
      .upsert(rows, { onConflict: "student_id,course_code" });
    if (up.error) {
      throw new ProfileStoreError(
        `student_waivers upsert failed: ${up.error.message}`,
      );
    }
  }

  // 4. Transfers — additive insert.
  if (patch.transfer_credits && patch.transfer_credits.length > 0) {
    const rows = patch.transfer_credits.map((t) => ({
      student_id: studentId,
      external_course: t.external_course,
      equivalent_course_code: normalizeCourse(t.equivalent_course_code),
      credits: t.credits,
    }));
    const ins = await sb.from("student_transfers").insert(rows);
    if (ins.error) {
      throw new ProfileStoreError(
        `student_transfers insert failed: ${ins.error.message}`,
      );
    }
  }

  // 5. In-progress courses — additive; write with `is_in_progress: true`.
  if (patch.in_progress_courses && patch.in_progress_courses.length > 0) {
    const rows = patch.in_progress_courses.map((c) => ({
      student_id: studentId,
      course_code: normalizeCourse(c.course_code),
      semester: c.term,
      is_in_progress: true,
      source: "manual",
    }));
    const ins = await sb.from("courses_taken").insert(rows);
    if (ins.error) {
      throw new ProfileStoreError(
        `courses_taken (in-progress) insert failed: ${ins.error.message}`,
      );
    }
  }
}

function courseRow(
  studentId: string,
  code: string,
  c: CompletedCourse,
): Record<string, unknown> {
  return {
    student_id: studentId,
    course_code: code,
    grade: c.grade ?? null,
    credits: c.credits ?? null,
    semester: c.term ?? null,
    source: c.source,
    is_in_progress: false,
  };
}

// --- writeAdvisingNote ----------------------------------------------------

export async function writeAdvisingNote(
  studentId: string,
  note: AdvisingNoteInput,
): Promise<AdvisingNote> {
  const sb = clientOrRaise();
  const { data, error } = await sb
    .from("advising_notes")
    .insert({
      student_id: studentId,
      topic: note.topic,
      reasoning: note.reasoning,
      outcome: note.outcome ?? null,
      stance: note.stance,
    })
    .select("id, topic, reasoning, outcome, stance, created_at");
  if (error) {
    // Common footgun: Phase 2 migration hasn't been applied to this
    // Supabase project. Translate the raw PostgREST error into an
    // actionable message the LLM (and dev) can act on.
    if (
      /advising_notes/i.test(error.message) &&
      /schema cache|does not exist|not found/i.test(error.message)
    ) {
      throw new ProfileStoreError(
        "advising_notes table is missing. Apply db/phase2_migration.sql via the Supabase SQL editor once, then retry.",
        "migration_needed",
      );
    }
    throw new ProfileStoreError(
      `advising_notes insert failed: ${error.message}`,
    );
  }
  if (!data || data.length === 0) {
    throw new ProfileStoreError("advising_notes insert returned no rows");
  }
  const row = data[0] as Record<string, unknown>;
  return toAdvisingNote(row);
}

function toAdvisingNote(row: Record<string, unknown>): AdvisingNote {
  return {
    id: String(row.id),
    topic: String(row.topic),
    reasoning: String(row.reasoning),
    outcome: (row.outcome as string | null) ?? null,
    stance: coalesceStance(row.stance),
    created_at: String(row.created_at),
  };
}

// --- retractAdvisingNote --------------------------------------------------

/**
 * Soft-delete one note so it stops surfacing as advisor context.
 *
 * The `student_id` predicate is the authorization boundary, not an
 * optimization: `note_id` reaches this function from an LLM tool call, so
 * without it a hallucinated or copied UUID could retract another
 * student's note. Scoping the UPDATE means a wrong id simply matches
 * nothing.
 */
export async function retractAdvisingNote(
  studentId: string,
  noteId: string,
  reason: string,
): Promise<AdvisingNote> {
  const sb = clientOrRaise();
  const { data, error } = await sb
    .from("advising_notes")
    .update({
      retracted_at: new Date().toISOString(),
      retraction_reason: reason,
    })
    .eq("id", noteId)
    .eq("student_id", studentId)
    .is("retracted_at", null)
    .select("id, topic, reasoning, outcome, stance, created_at");
  if (error) {
    if (
      /retracted_at|retraction_reason/i.test(error.message) &&
      /schema cache|does not exist|not found|column/i.test(error.message)
    ) {
      throw new ProfileStoreError(
        "advising_notes is missing the retraction columns. Apply db/phase5_migration.sql via the Supabase SQL editor once, then retry.",
        "migration_needed",
      );
    }
    throw new ProfileStoreError(
      `advising_notes retract failed: ${error.message}`,
    );
  }
  // Zero rows means the id doesn't exist, belongs to another student, or
  // was already retracted. All three are `not_found` from the caller's
  // point of view — and none of them may report success, or the advisor
  // will tell the student a note is gone when it isn't.
  if (!data || data.length === 0) {
    throw new ProfileStoreError(
      `No live advising note ${JSON.stringify(noteId)} for this student. ` +
        "Read the ids from get_student_profile's recent_advising_notes.",
      "not_found",
    );
  }
  return toAdvisingNote(data[0] as Record<string, unknown>);
}
