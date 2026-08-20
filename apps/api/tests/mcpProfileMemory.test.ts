// Profile-memory MCP tool tests.
//
// Uses an in-memory Supabase fake (chainable, thenable) so we exercise
// the real read/write shapes without a live database. Same pattern the
// old queryRun tests used; the fake mimics the surface area profileStore
// actually touches — nothing more.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Supabase fake --------------------------------------------------------

type Row = Record<string, unknown>;

class FakeQuery {
  private table: string;
  private db: FakeDB;
  private filters: Array<[string, unknown]> = [];
  private inFilters: Array<[string, unknown[]]> = [];
  private isFilters: Array<[string, unknown]> = [];
  private orderKey: string | null = null;
  private orderDesc = false;
  private limitN: number | null = null;
  // Pending mutation captured until `then`/`await` fires.
  private pending:
    | { kind: "select"; columns: string[] }
    | { kind: "insert"; rows: Row[] }
    | { kind: "upsert"; rows: Row[] }
    | { kind: "update"; fields: Row }
    | { kind: "delete" }
    | null = null;

  constructor(table: string, db: FakeDB) {
    this.table = table;
    this.db = db;
  }

  select(cols?: string) {
    // Real Supabase chains: `.insert(...).select(...)` inserts THEN
    // returns the inserted rows. Only overwrite `pending` if we're
    // starting a fresh select — otherwise the mutation is preserved.
    if (this.pending == null) {
      this.pending = {
        kind: "select",
        columns: (cols ?? "*").split(",").map((c) => c.trim()),
      };
    }
    return this;
  }
  eq(field: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }
  in(field: string, values: unknown[]) {
    this.inFilters.push([field, values]);
    return this;
  }
  // `.is(col, null)` is SQL `col IS NULL`. Seeded rows that predate the
  // phase-5 migration simply lack the column, so `undefined` has to
  // count as null here — otherwise every pre-migration fixture row would
  // be filtered out of `readProfile`.
  is(field: string, value: unknown) {
    this.isFilters.push([field, value]);
    return this;
  }
  order(key: string, opts?: { ascending?: boolean }) {
    this.orderKey = key;
    this.orderDesc = opts?.ascending === false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.pending = { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  upsert(rows: Row | Row[], _opts?: { onConflict?: string }) {
    this.pending = { kind: "upsert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  update(fields: Row) {
    this.pending = { kind: "update", fields };
    return this;
  }
  delete() {
    this.pending = { kind: "delete" };
    return this;
  }

  private matches(r: Row): boolean {
    for (const [k, v] of this.filters) if (r[k] !== v) return false;
    for (const [k, vs] of this.inFilters) {
      if (!vs.includes(r[k])) return false;
    }
    for (const [k, v] of this.isFilters) {
      if (v === null) {
        if (r[k] != null) return false;
      } else if (r[k] !== v) return false;
    }
    return true;
  }

  private applyFilters(rows: Row[]): Row[] {
    return rows.filter((r) => this.matches(r));
  }

  private applyOrderLimit(rows: Row[]): Row[] {
    let out = rows.slice();
    if (this.orderKey) {
      const key = this.orderKey;
      out.sort((a, b) => {
        const av = String(a[key] ?? "");
        const bv = String(b[key] ?? "");
        return this.orderDesc ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  private execute(): { data: Row[] | null; error: { message: string } | null } {
    // Injected per-table failure, so a test can assert the read path
    // refuses to mistake a failed query for an empty table.
    const failure = this.db.failures[this.table];
    if (failure) return { data: null, error: { message: failure } };
    const store = this.db.tables[this.table] ?? [];
    if (!this.pending || this.pending.kind === "select") {
      const filtered = this.applyOrderLimit(this.applyFilters(store));
      return { data: filtered, error: null };
    }
    if (this.pending.kind === "insert") {
      const withIds = this.pending.rows.map((r) => ({
        id: r.id ?? this.db.nextId(),
        created_at: r.created_at ?? new Date().toISOString(),
        ...r,
      }));
      this.db.tables[this.table] = [...store, ...withIds];
      return { data: withIds, error: null };
    }
    if (this.pending.kind === "upsert") {
      // Simple upsert: replace where every filter key matches; else append.
      const key = "course_code"; // enough for waivers upsert
      const kept = store.filter(
        (r) =>
          !this.pending!.kind ||
          this.pending!.kind !== "upsert" ||
          !(this.pending as { rows: Row[] }).rows.some(
            (n) => r.student_id === n.student_id && r[key] === n[key],
          ),
      );
      const withIds = (this.pending as { rows: Row[] }).rows.map((r) => ({
        id: r.id ?? this.db.nextId(),
        created_at: r.created_at ?? new Date().toISOString(),
        ...r,
      }));
      this.db.tables[this.table] = [...kept, ...withIds];
      return { data: withIds, error: null };
    }
    if (this.pending.kind === "update") {
      const fields = this.pending.fields;
      // Postgres evaluates the WHERE against the pre-update row and
      // returns the post-update row. Matching after the write would miss
      // any update whose own fields break its predicate — exactly what
      // `set retracted_at = now() where retracted_at is null` does.
      const updated: Row[] = [];
      const next = store.map((r) => {
        if (!this.matches(r)) return r;
        const merged = { ...r, ...fields };
        updated.push(merged);
        return merged;
      });
      this.db.tables[this.table] = next;
      return { data: updated, error: null };
    }
    if (this.pending.kind === "delete") {
      const filtered = this.applyFilters(store);
      const kept = store.filter((r) => !filtered.includes(r));
      this.db.tables[this.table] = kept;
      return { data: filtered, error: null };
    }
    return { data: [], error: null };
  }

  then<T>(
    onFulfilled: (v: {
      data: Row[] | null;
      error: { message: string } | null;
    }) => T,
  ): Promise<T> {
    return Promise.resolve(onFulfilled(this.execute()));
  }
}

class FakeDB {
  tables: Record<string, Row[]> = {};
  /** table name → PostgREST-style error message to return instead of rows. */
  failures: Record<string, string> = {};
  private nextIdCounter = 1;

  constructor(initial: Record<string, Row[]>) {
    this.tables = Object.fromEntries(
      Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
    );
  }
  nextId() {
    return `fake-${this.nextIdCounter++}`;
  }
  from(name: string): FakeQuery {
    return new FakeQuery(name, this);
  }
}

// --- Vi mock of getSupabase ----------------------------------------------

let fakeDb: FakeDB;
vi.mock("@/lib/server/supabase", async () => {
  const original = await import("@/lib/server/supabase");
  return {
    ...original,
    getSupabase: vi.fn(() => fakeDb),
  };
});

import { invokeProfileMemoryTool } from "@/lib/server/mcp/profileMemory";

function seed(tables: Record<string, Row[]>) {
  fakeDb = new FakeDB(tables);
}

function structured<T>(res: { structuredContent?: Record<string, unknown> }): T {
  return res.structuredContent as T;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---------------------------------------------------------------

describe("profile-memory MCP tools", () => {
  it("test_get_student_profile_returns_merged_shape", async () => {
    seed({
      students: [
        {
          id: "stu-1",
          program_id: "cs_bs",
          entry_type: "manual",
          target_grad_term: "Spring 2029",
          max_credits_per_term: 15,
          institution_id: "generic",
          name: "Test Student",
          major: "CS",
        },
      ],
      courses_taken: [
        {
          student_id: "stu-1",
          course_code: "CS 101",
          credits: 3,
          source: "transcript",
          is_in_progress: false,
        },
        {
          student_id: "stu-1",
          course_code: "CS 201",
          credits: 3,
          source: "manual",
          is_in_progress: false,
        },
        {
          student_id: "stu-1",
          course_code: "CS 301",
          semester: "Fall 2026",
          source: "manual",
          is_in_progress: true,
        },
      ],
      student_waivers: [{ student_id: "stu-1", course_code: "ENG 150" }],
      student_transfers: [
        {
          student_id: "stu-1",
          external_course: "CC Programming",
          equivalent_course_code: "MATH 210",
          credits: 3,
        },
      ],
      advising_notes: [
        {
          id: "note-1",
          student_id: "stu-1",
          topic: "CS 301 timing",
          reasoning: "Fall-only; front-load.",
          outcome: null,
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    });

    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "stu-1",
    });
    expect(res.isError).toBeFalsy();
    const p = structured<{
      program_id: string;
      completed_courses: Array<{ course_code: string; source: string }>;
      in_progress_courses: Array<{ course_code: string; term: string }>;
      waivers: string[];
      transfer_credits: Array<{ equivalent_course_code: string }>;
      recent_advising_notes: Array<{ topic: string }>;
      name: string | null;
    }>(res);
    expect(p.program_id).toBe("cs_bs");
    expect(p.completed_courses.map((c) => c.course_code).sort()).toEqual([
      "CS 101",
      "CS 201",
    ]);
    expect(p.in_progress_courses[0].course_code).toBe("CS 301");
    expect(p.waivers).toEqual(["ENG 150"]);
    expect(p.transfer_credits[0].equivalent_course_code).toBe("MATH 210");
    expect(p.recent_advising_notes[0].topic).toBe("CS 301 timing");
    expect(p.name).toBe("Test Student");
  });

  it("test_get_student_profile_handles_missing_student_gracefully", async () => {
    seed({ students: [] });
    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "ghost",
    });
    expect(res.isError).toBe(true);
    const p = structured<{ error: string; detail: string }>(res);
    expect(p.error).toBe("not_found");
    expect(p.detail).toContain("ghost");
  });

  it("test_update_student_profile_additive_on_courses", async () => {
    seed({
      students: [
        {
          id: "stu-1",
          program_id: "cs_bs",
          entry_type: "manual",
          max_credits_per_term: 15,
        },
      ],
      courses_taken: [
        {
          course_code: "CS 101",
          credits: 3,
          source: "manual",
          is_in_progress: false,
          student_id: "stu-1",
        },
      ],
    });
    const res = await invokeProfileMemoryTool("update_student_profile", {
      student_id: "stu-1",
      patch: {
        completed_courses: [
          { course_code: "CS 201", credits: 3, source: "manual" },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const p = structured<{
      completed_courses: Array<{ course_code: string }>;
    }>(res);
    // Original CS 101 preserved + CS 201 added.
    const codes = p.completed_courses.map((c) => c.course_code).sort();
    expect(codes).toEqual(["CS 101", "CS 201"]);
  });

  it("test_update_student_profile_priority_stronger_source_wins", async () => {
    seed({
      students: [
        {
          id: "stu-1",
          program_id: "cs_bs",
          entry_type: "manual",
          max_credits_per_term: 15,
        },
      ],
      courses_taken: [
        {
          course_code: "CS 101",
          credits: 3,
          source: "manual", // rank 2
          is_in_progress: false,
          student_id: "stu-1",
        },
      ],
    });
    // Waiver (rank 0) beats manual (rank 2).
    const res = await invokeProfileMemoryTool("update_student_profile", {
      student_id: "stu-1",
      patch: {
        completed_courses: [
          {
            course_code: "CS 101",
            credits: 3,
            source: "waiver",
            grade: "P",
          },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const p = structured<{
      completed_courses: Array<{ course_code: string; source: string; grade: string | null }>;
    }>(res);
    const cs101 = p.completed_courses.find((c) => c.course_code === "CS 101")!;
    expect(cs101.source).toBe("waiver");
    expect(cs101.grade).toBe("P");
  });

  it("test_update_student_profile_priority_weaker_source_ignored", async () => {
    seed({
      students: [
        {
          id: "stu-1",
          program_id: "cs_bs",
          entry_type: "manual",
          max_credits_per_term: 15,
        },
      ],
      courses_taken: [
        {
          course_code: "CS 101",
          credits: 3,
          source: "transcript", // rank 1
          grade: "A",
          is_in_progress: false,
          student_id: "stu-1",
        },
      ],
    });
    // Manual (rank 2) is weaker than transcript (rank 1); should be ignored.
    const res = await invokeProfileMemoryTool("update_student_profile", {
      student_id: "stu-1",
      patch: {
        completed_courses: [
          { course_code: "CS 101", credits: 3, source: "manual", grade: "F" },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const p = structured<{
      completed_courses: Array<{ course_code: string; grade: string | null }>;
    }>(res);
    const cs101 = p.completed_courses.find((c) => c.course_code === "CS 101")!;
    // Transcript-grade "A" wins.
    expect(cs101.grade).toBe("A");
  });

  it("test_update_student_profile_scalar_write", async () => {
    seed({
      students: [
        {
          id: "stu-1",
          program_id: "cs_bs",
          entry_type: "manual",
          max_credits_per_term: 15,
          major: null,
          international: null,
        },
      ],
    });
    const res = await invokeProfileMemoryTool("update_student_profile", {
      student_id: "stu-1",
      patch: { major: "Computer Science", international: false },
    });
    expect(res.isError).toBeFalsy();
    const p = structured<{ major: string; international: boolean }>(res);
    expect(p.major).toBe("Computer Science");
    expect(p.international).toBe(false);
  });

  it("test_update_student_profile_accepts_stringified_patch", async () => {
    // The LLM sometimes serializes tool args as JSON strings instead of
    // structured objects — the tool must handle both without complaint.
    seed({
      students: [
        {
          id: "stu-1",
          program_id: null,
          entry_type: "manual",
          max_credits_per_term: 15,
          major: null,
        },
      ],
    });
    const res = await invokeProfileMemoryTool("update_student_profile", {
      student_id: "stu-1",
      patch: JSON.stringify({
        major: "Mathematics",
        program_id: "math_bs",
        program_label: "Mathematics BS",
      }),
    });
    expect(res.isError).toBeFalsy();
    const p = structured<{
      major: string;
      program_id: string;
      program_label: string;
    }>(res);
    expect(p.major).toBe("Mathematics");
    expect(p.program_id).toBe("math_bs");
    expect(p.program_label).toBe("Mathematics BS");
  });

  it("test_record_advising_note_appears_in_next_get", async () => {
    seed({
      students: [
        {
          id: "stu-1",
          program_id: "cs_bs",
          entry_type: "manual",
          max_credits_per_term: 15,
        },
      ],
    });
    const writeRes = await invokeProfileMemoryTool("record_advising_note", {
      student_id: "stu-1",
      topic: "CS 301 timing",
      reasoning: "Fall-only; front-load MATH 210.",
      // `outcome` now requires an explicit commitment — the student
      // agreeing IS the decision, so the stance has to say so.
      stance: "decided",
      outcome: "student agreed",
    });
    expect(writeRes.isError).toBeFalsy();

    const readRes = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "stu-1",
    });
    const p = structured<{
      recent_advising_notes: Array<{ topic: string; outcome: string | null }>;
    }>(readRes);
    expect(p.recent_advising_notes.length).toBe(1);
    expect(p.recent_advising_notes[0].topic).toBe("CS 301 timing");
    expect(p.recent_advising_notes[0].outcome).toBe("student agreed");
  });

  it("test_update_student_profile_rejects_invalid_patch", async () => {
    seed({
      students: [{ id: "stu-1", program_id: "cs_bs", entry_type: "manual" }],
    });
    const res = await invokeProfileMemoryTool("update_student_profile", {
      student_id: "stu-1",
      patch: { gpa: "not a number" }, // wrong type
    });
    expect(res.isError).toBe(true);
    const p = structured<{ error: string }>(res);
    expect(p.error).toBe("invalid_patch");
  });

  // --- Note stance & retraction -----------------------------------------
  //
  // Live testing: "I want to drop CS 25000, give me replacement options"
  // came back as "Noted — I've recorded the drop decision," and the note
  // then couldn't be withdrawn. `stance` makes recording a decision
  // require declaring one; retraction makes a wrong record removable.

  function seedOneStudent() {
    seed({
      students: [
        {
          id: "stu-1",
          program_id: "cs_bs",
          entry_type: "manual",
          max_credits_per_term: 15,
        },
      ],
    });
  }

  async function notesOf(studentId: string) {
    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: studentId,
    });
    return structured<{
      recent_advising_notes: Array<{
        id: string;
        topic: string;
        stance: string;
        outcome: string | null;
      }>;
    }>(res).recent_advising_notes;
  }

  it("test_record_advising_note_defaults_stance_to_exploring", async () => {
    seedOneStudent();
    const res = await invokeProfileMemoryTool("record_advising_note", {
      student_id: "stu-1",
      topic: "CS 25000 drop options",
      reasoning: "Student asked for replacements; nothing committed.",
    });
    expect(res.isError).toBeFalsy();
    // Under-claiming the student's commitment is the safe direction.
    expect(structured<{ stance: string }>(res).stance).toBe("exploring");
    const notes = await notesOf("stu-1");
    expect(notes[0].stance).toBe("exploring");
    expect(notes[0].outcome).toBeNull();
  });

  it("test_record_advising_note_rejects_outcome_without_decided_stance", async () => {
    seedOneStudent();
    for (const stance of [undefined, "exploring", "advised"]) {
      const res = await invokeProfileMemoryTool("record_advising_note", {
        student_id: "stu-1",
        topic: "CS 25000 drop",
        reasoning: "Student was weighing options.",
        ...(stance ? { stance } : {}),
        outcome: "dropped CS 25000",
      });
      expect(res.isError).toBe(true);
      expect(structured<{ error: string }>(res).error).toBe("invalid_note");
    }
    // Nothing was persisted by any of the rejected attempts.
    expect(await notesOf("stu-1")).toEqual([]);
  });

  it("test_record_advising_note_accepts_outcome_when_decided", async () => {
    seedOneStudent();
    const res = await invokeProfileMemoryTool("record_advising_note", {
      student_id: "stu-1",
      topic: "CS 25000 drop",
      reasoning: "Student confirmed the drop this turn.",
      stance: "decided",
      outcome: "dropped CS 25000",
    });
    expect(res.isError).toBeFalsy();
    const notes = await notesOf("stu-1");
    expect(notes[0].stance).toBe("decided");
    expect(notes[0].outcome).toBe("dropped CS 25000");
  });

  it("test_record_advising_note_rejects_unknown_stance", async () => {
    seedOneStudent();
    const res = await invokeProfileMemoryTool("record_advising_note", {
      student_id: "stu-1",
      topic: "topic",
      reasoning: "reasoning",
      stance: "committed", // not one of the three
    });
    expect(res.isError).toBe(true);
    expect(structured<{ error: string }>(res).error).toBe("invalid_note");
  });

  it("test_retract_advising_note_removes_it_from_next_get", async () => {
    seedOneStudent();
    const write = await invokeProfileMemoryTool("record_advising_note", {
      student_id: "stu-1",
      topic: "CS 25000 drop decision",
      reasoning: "Recorded in error — the student was exploring.",
    });
    const noteId = structured<{ id: string }>(write).id;
    expect(noteId).toBeTruthy();
    expect((await notesOf("stu-1")).length).toBe(1);

    const res = await invokeProfileMemoryTool("retract_advising_note", {
      student_id: "stu-1",
      note_id: noteId,
      reason: "student was exploring, not deciding",
    });
    expect(res.isError).toBeFalsy();
    expect(structured<{ retracted: boolean }>(res).retracted).toBe(true);

    // Gone from the profile the next turn reads...
    expect(await notesOf("stu-1")).toEqual([]);
    // ...but still on the table: soft delete keeps the advising trail.
    const row = fakeDb.tables.advising_notes.find((r) => r.id === noteId)!;
    expect(row).toBeDefined();
    expect(row.retracted_at).toBeTruthy();
    expect(row.retraction_reason).toBe("student was exploring, not deciding");
  });

  it("test_retract_advising_note_returns_not_found_for_unknown_id", async () => {
    seedOneStudent();
    const res = await invokeProfileMemoryTool("retract_advising_note", {
      student_id: "stu-1",
      note_id: "note-that-never-existed",
      reason: "wrong",
    });
    expect(res.isError).toBe(true);
    expect(structured<{ error: string }>(res).error).toBe("not_found");
  });

  it("test_retract_advising_note_cannot_reach_another_students_note", async () => {
    // `note_id` arrives from an LLM tool call, so the student_id predicate
    // is the authorization boundary — not a convenience filter.
    seed({
      students: [
        { id: "stu-1", program_id: "cs_bs", entry_type: "manual" },
        { id: "stu-2", program_id: "cs_bs", entry_type: "manual" },
      ],
      advising_notes: [
        {
          id: "note-owned-by-2",
          student_id: "stu-2",
          topic: "someone else's note",
          reasoning: "not stu-1's business",
          outcome: null,
          stance: "exploring",
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    });

    const res = await invokeProfileMemoryTool("retract_advising_note", {
      student_id: "stu-1",
      note_id: "note-owned-by-2",
      reason: "trying to reach across students",
    });
    expect(res.isError).toBe(true);
    expect(structured<{ error: string }>(res).error).toBe("not_found");
    // stu-2's note is untouched and still live.
    const row = fakeDb.tables.advising_notes[0];
    expect(row.retracted_at == null).toBe(true);
    expect((await notesOf("stu-2")).length).toBe(1);
  });

  it("test_retract_advising_note_is_not_repeatable", async () => {
    // Retracting twice must not report a second success — the `is null`
    // guard is what makes the operation idempotent-but-honest.
    seedOneStudent();
    const write = await invokeProfileMemoryTool("record_advising_note", {
      student_id: "stu-1",
      topic: "note",
      reasoning: "reasoning",
    });
    const noteId = structured<{ id: string }>(write).id;
    const first = await invokeProfileMemoryTool("retract_advising_note", {
      student_id: "stu-1",
      note_id: noteId,
      reason: "first",
    });
    expect(first.isError).toBeFalsy();
    const second = await invokeProfileMemoryTool("retract_advising_note", {
      student_id: "stu-1",
      note_id: noteId,
      reason: "second",
    });
    expect(second.isError).toBe(true);
    expect(structured<{ error: string }>(second).error).toBe("not_found");
    // The first reason stands — a repeat attempt can't rewrite the record.
    const row = fakeDb.tables.advising_notes.find((r) => r.id === noteId)!;
    expect(row.retraction_reason).toBe("first");
  });

  it("test_read_profile_coalesces_missing_stance_on_legacy_rows", async () => {
    // Rows written before phase 5 have no `stance` column value at all.
    seed({
      students: [{ id: "stu-1", program_id: "cs_bs", entry_type: "manual" }],
      advising_notes: [
        {
          id: "legacy-note",
          student_id: "stu-1",
          topic: "pre-migration note",
          reasoning: "written before stance existed",
          outcome: null,
          created_at: "2026-07-01T00:00:00Z",
        },
      ],
    });
    const notes = await notesOf("stu-1");
    expect(notes.length).toBe(1);
    expect(notes[0].stance).toBe("exploring");
  });

  // --- Failed reads must not read as empty tables -----------------------
  //
  // Every one of these selects used to end in `?? []`, so a schema or RLS
  // error surfaced as "this student has nothing" — no completed courses,
  // no waivers, no notes — with no error anywhere. Silently stating
  // something false is the failure class this whole pass exists to close,
  // and a forgotten migration is the likeliest trigger.

  it("test_failed_notes_read_names_phase5_migration", async () => {
    seedOneStudent();
    // Exactly what PostgREST returns when phase 5 was never applied.
    fakeDb.failures.advising_notes =
      'column advising_notes.stance does not exist';

    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "stu-1",
    });
    expect(res.isError).toBe(true);
    const p = structured<{ error: string; detail: string }>(res);
    expect(p.error).toBe("migration_needed");
    expect(p.detail).toMatch(/phase5_migration\.sql/);
  });

  it("test_failed_notes_read_names_base_schema_when_table_missing", async () => {
    seedOneStudent();
    fakeDb.failures.advising_notes =
      "relation \"public.advising_notes\" does not exist";
    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "stu-1",
    });
    const p = structured<{ error: string; detail: string }>(res);
    expect(p.error).toBe("migration_needed");
    // A missing table isn't a phase-5 problem — don't send them to the
    // wrong file.
    expect(p.detail).toMatch(/schema\.sql/);
    expect(p.detail).not.toMatch(/phase5/);
  });

  it("test_failed_courses_read_does_not_report_zero_courses", async () => {
    // The worst instance: the advisor would rebuild an entire degree plan
    // from scratch for a student who has completed half of it.
    seedOneStudent();
    fakeDb.failures.courses_taken =
      "column courses_taken.is_in_progress does not exist";
    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "stu-1",
    });
    expect(res.isError).toBe(true);
    const p = structured<{ error: string; detail: string }>(res);
    expect(p.error).toBe("migration_needed");
    expect(p.detail).toMatch(/courses_taken/);
  });

  it("test_failed_waivers_read_surfaces_error", async () => {
    seedOneStudent();
    fakeDb.failures.student_waivers = "permission denied for table student_waivers";
    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "stu-1",
    });
    expect(res.isError).toBe(true);
    // Not a schema shape, so it must NOT be mislabelled as a migration.
    const p = structured<{ error: string; detail: string }>(res);
    expect(p.error).not.toBe("migration_needed");
    expect(p.detail).toMatch(/student_waivers/);
  });

  it("test_failed_transfers_read_surfaces_error", async () => {
    seedOneStudent();
    fakeDb.failures.student_transfers =
      "column student_transfers.credits does not exist";
    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "stu-1",
    });
    expect(res.isError).toBe(true);
    expect(structured<{ error: string }>(res).error).toBe("migration_needed");
  });

  it("test_healthy_read_still_returns_empty_arrays_for_empty_tables", async () => {
    // The guard must not turn a genuinely empty profile into an error —
    // a brand-new student has no courses, waivers, or notes.
    seedOneStudent();
    const res = await invokeProfileMemoryTool("get_student_profile", {
      student_id: "stu-1",
    });
    expect(res.isError).toBeFalsy();
    const p = structured<{
      completed_courses: unknown[];
      waivers: unknown[];
      transfer_credits: unknown[];
      recent_advising_notes: unknown[];
    }>(res);
    expect(p.completed_courses).toEqual([]);
    expect(p.waivers).toEqual([]);
    expect(p.transfer_credits).toEqual([]);
    expect(p.recent_advising_notes).toEqual([]);
  });

  it("test_record_advising_note_rejects_empty_reasoning", async () => {
    seed({
      students: [{ id: "stu-1", program_id: "cs_bs", entry_type: "manual" }],
    });
    const res = await invokeProfileMemoryTool("record_advising_note", {
      student_id: "stu-1",
      topic: "topic",
      reasoning: "",
    });
    expect(res.isError).toBe(true);
    const p = structured<{ error: string }>(res);
    expect(p.error).toBe("invalid_note");
  });

  it("test_unknown_tool_name_returns_structured_error", async () => {
    seed({});
    const res = await invokeProfileMemoryTool("no_such_tool", {});
    expect(res.isError).toBe(true);
    const p = structured<{ error: string }>(res);
    expect(p.error).toBe("unknown_tool");
  });
});
