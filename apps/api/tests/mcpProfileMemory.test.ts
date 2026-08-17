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

  private applyFilters(rows: Row[]): Row[] {
    return rows.filter((r) => {
      for (const [k, v] of this.filters) if (r[k] !== v) return false;
      for (const [k, vs] of this.inFilters) {
        if (!vs.includes(r[k])) return false;
      }
      return true;
    });
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

  private execute(): { data: Row[]; error: null } {
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
      const next = store.map((r) => {
        for (const [k, v] of this.filters) if (r[k] !== v) return r;
        return { ...r, ...fields };
      });
      this.db.tables[this.table] = next;
      return { data: next.filter((r) => this.filters.every(([k, v]) => r[k] === v)), error: null };
    }
    if (this.pending.kind === "delete") {
      const filtered = this.applyFilters(store);
      const kept = store.filter((r) => !filtered.includes(r));
      this.db.tables[this.table] = kept;
      return { data: filtered, error: null };
    }
    return { data: [], error: null };
  }

  then<T>(onFulfilled: (v: { data: Row[]; error: null }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.execute()));
  }
}

class FakeDB {
  tables: Record<string, Row[]> = {};
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
