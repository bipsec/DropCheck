// Tests for the queryRun orchestration helpers.
// Ported 1:1 from backend/tests/test_query_run.py — 5 cases.
//
// Stubs Supabase via queryDeps.getSupabase so we can exercise the
// persistence + follow-up loading without any external service.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConversation,
  listConversations,
  loadPriorTurn,
  QueryError,
  queryDeps,
} from "@/lib/server/services/queryRun";

// A chainable fake matching what services/queryRun uses: builder methods
// return `this`, terminals resolve to `{data, error}`. `select` after
// `insert` also acts as a terminal.
class FakeQuery {
  private rows: Array<Record<string, unknown>>;
  constructor(rows?: Array<Record<string, unknown>>) {
    this.rows = rows ?? [];
  }
  select() {
    // Two roles for select():
    //   sb.from("x").select("...").eq(...).limit(...) → terminal via await
    //   sb.from("x").insert(payload).select("id")     → terminal (thenable)
    return this;
  }
  eq() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  insert(payload: Record<string, unknown>) {
    this.rows = [{ id: "generated", ...payload }];
    return this;
  }
  // Makes the builder awaitable — return the current rows.
  then<T>(
    onFulfilled: (value: { data: Array<Record<string, unknown>>; error: null }) => T,
  ): Promise<T> {
    return Promise.resolve(onFulfilled({ data: this.rows, error: null }));
  }
}

class FakeSupabase {
  private tables: Record<string, Array<Record<string, unknown>>>;
  constructor(tables: Record<string, Array<Record<string, unknown>>>) {
    this.tables = tables;
  }
  from(name: string): FakeQuery {
    return new FakeQuery(this.tables[name] ?? []);
  }
}

function patchSb(tables: Record<string, Array<Record<string, unknown>>>) {
  const sb = new FakeSupabase(tables) as unknown as ReturnType<typeof queryDeps.getSupabase>;
  vi.spyOn(queryDeps, "getSupabase").mockReturnValue(sb);
  return sb;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("queryRun helpers", () => {
  it("load_prior_turn_reads_reports_snapshot", async () => {
    patchSb({
      conversations: [
        { id: "c-1", student_id: "stu-1", course_code: "CS 410" },
      ],
      conversation_turns: [
        {
          id: "t-2",
          role: "assistant",
          response: {
            course: "CS 410",
            headline: "h",
            bottomLine: "b",
            _reports: {
              matched_course_id: "cat-cs410",
              course_code: "CS 410",
              academic_report: { verdict: "significant" },
              financial_report: { verdict: "watch" },
              status_report: { verdict: "no_impact" },
            },
          },
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const prior = await loadPriorTurn("stu-1", "c-1");
    expect(prior.matched_course_id).toBe("cat-cs410");
    expect((prior.academic_report as Record<string, unknown>).verdict).toBe(
      "significant",
    );
    const final = prior.final as Record<string, unknown>;
    expect("_reports" in final).toBe(false);
  });

  it("load_prior_turn_rejects_wrong_student", async () => {
    patchSb({
      conversations: [
        { id: "c-1", student_id: "other-stu", course_code: "CS 410" },
      ],
    });
    await expect(loadPriorTurn("stu-1", "c-1")).rejects.toThrow(/different student/);
  });

  it("load_prior_turn_when_no_assistant_turn", async () => {
    patchSb({
      conversations: [
        { id: "c-1", student_id: "stu-1", course_code: "CS 410" },
      ],
      conversation_turns: [],
    });
    await expect(loadPriorTurn("stu-1", "c-1")).rejects.toThrow(
      /no assistant turn/,
    );
    // Sanity-check the error type as well.
    await expect(loadPriorTurn("stu-1", "c-1")).rejects.toBeInstanceOf(QueryError);
  });

  it("list_conversations_returns_rows", async () => {
    patchSb({
      conversations: [
        { id: "c-1", course_code: "CS 410", created_at: "..." },
        { id: "c-2", course_code: "PSY 101", created_at: "..." },
      ],
    });
    const rows = await listConversations("stu-1");
    expect(rows.map((r) => r.id)).toEqual(["c-1", "c-2"]);
  });

  it("get_conversation_strips_reports_from_response", async () => {
    patchSb({
      conversations: [
        { id: "c-1", student_id: "stu-1", course_code: "CS 410" },
      ],
      conversation_turns: [
        { id: "u-1", role: "user", query: "q", response: null, created_at: "..." },
        {
          id: "a-1",
          role: "assistant",
          query: null,
          response: {
            course: "CS 410",
            headline: "h",
            _reports: { academic_report: { verdict: "watch" } },
          },
          created_at: "...",
        },
      ],
    });
    const detail = await getConversation("stu-1", "c-1");
    const assistantResponse = detail.turns[1].response as Record<string, unknown>;
    expect("headline" in assistantResponse).toBe(true);
    expect("_reports" in assistantResponse).toBe(false);
  });
});
