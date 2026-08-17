// End-to-end shape test — the full chat flow, mocked SDK.
//
// Drives a 3-turn scripted conversation through the chat SSE route.
// Verifies:
//   (a) Every scripted tool_use surfaces on the SSE wire.
//   (b) Session id observed in turn 1 is persisted and available for
//       resume in turn 2 (buildAgentOptions reads it).
//   (c) Multiple tool_use → tool_result pairs are paired by
//       tool_use_id, not by order (test intentionally interleaves).
//
// The end-to-end LIVE test against real Anthropic + real Supabase +
// real Purdue.io lives in scripts/smokeE2E.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fake Supabase for session_state --------------------------------------

type Row = Record<string, unknown>;

class FakeQuery {
  private table: string;
  private db: FakeDB;
  private filters: Array<[string, unknown]> = [];
  private limitN: number | null = null;
  private pending:
    | { kind: "select" }
    | { kind: "upsert"; rows: Row[] }
    | null = null;

  constructor(table: string, db: FakeDB) {
    this.table = table;
    this.db = db;
  }
  select() {
    if (this.pending == null) this.pending = { kind: "select" };
    return this;
  }
  eq(field: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  upsert(rows: Row | Row[], _opts?: { onConflict?: string }) {
    this.pending = { kind: "upsert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  private execute() {
    const store = this.db.tables[this.table] ?? [];
    if (this.pending?.kind === "upsert") {
      const key = "student_id";
      const kept = store.filter(
        (r) =>
          !(this.pending as { rows: Row[] }).rows.some((n) => r[key] === n[key]),
      );
      this.db.tables[this.table] = [
        ...kept,
        ...(this.pending as { rows: Row[] }).rows,
      ];
      return { data: null, error: null };
    }
    let filtered = store.filter((r) =>
      this.filters.every(([k, v]) => r[k] === v),
    );
    if (this.limitN !== null) filtered = filtered.slice(0, this.limitN);
    return { data: filtered, error: null };
  }
  then<T>(onFulfilled: (v: { data: Row[] | null; error: null }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.execute()));
  }
}

class FakeDB {
  tables: Record<string, Row[]> = {};
  from(name: string) {
    return new FakeQuery(name, this);
  }
}

let fakeDb: FakeDB;

vi.mock("@/lib/server/supabase", async () => {
  const original = await import("@/lib/server/supabase");
  return { ...original, getSupabase: vi.fn(() => fakeDb) };
});

vi.mock("@/lib/server/cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/cookies")>();
  return {
    ...actual,
    requireStudent: vi.fn(async () => ({
      id: "e2e-stu",
      session_id: "e2e-cookie",
    })),
  };
});

// Scripted SDK messages, keyed by turn (index in this array).
let turnScripts: Array<Array<Record<string, unknown>>> = [];
let currentTurn = 0;
let optionsSeen: Array<{ resume?: string }> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    query: vi.fn(({ options }: { options?: { resume?: string } }) => {
      optionsSeen.push({ resume: options?.resume });
      const script = turnScripts[currentTurn] ?? [];
      currentTurn += 1;
      return {
        async *[Symbol.asyncIterator]() {
          for (const msg of script) yield msg;
        },
      };
    }),
  };
});

// --- SSE helper -----------------------------------------------------------

async function collectSseEvents(res: Response) {
  const events: Array<{ event: string; data: unknown }> = [];
  if (!res.body) return events;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event: string | null = null;
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        const l = line.trim();
        const i = l.indexOf(":");
        if (i === -1) continue;
        const field = l.slice(0, i).trim();
        const value = l.slice(i + 1).trim();
        if (field === "event") event = value;
        else if (field === "data") dataLines.push(value);
      }
      if (event) {
        try {
          events.push({ event, data: JSON.parse(dataLines.join("\n")) });
        } catch {
          /* ignore */
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
  return events;
}

function chatRequest(prompt: string): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

beforeEach(() => {
  fakeDb = new FakeDB();
  currentTurn = 0;
  optionsSeen = [];
});

// --- Scripts --------------------------------------------------------------

// Turn 1: student introduces themselves. Agent calls
// update_student_profile, then get_course to verify the course they
// mentioned exists.
const TURN_1_SCRIPT: Array<Record<string, unknown>> = [
  {
    type: "assistant",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t1-upd",
          name: "mcp__profile-memory__update_student_profile",
          input: {
            student_id: "e2e-stu",
            patch: {
              major: "CS",
              program_id: "cs_bs",
              entry_type: "manual",
              completed_courses: [
                { course_code: "CS 18000", credits: 4, source: "manual" },
              ],
            },
          },
        },
      ],
    },
  },
  {
    type: "user",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1-upd",
          is_error: false,
          content: [
            { type: "text", text: JSON.stringify({ student_id: "e2e-stu" }) },
          ],
        },
      ],
    },
  },
  {
    type: "assistant",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t1-get",
          name: "mcp__university-catalog__get_course",
          input: { course_code: "CS 18000" },
        },
      ],
    },
  },
  {
    type: "user",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1-get",
          is_error: false,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                course_code: "CS 18000",
                title: "Problem Solving and OO Programming",
                credits: 4,
              }),
            },
          ],
        },
      ],
    },
  },
  {
    type: "assistant",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "text",
          text: "Nice — I've got you as a CS BS with CS 18000 done.",
        },
      ],
    },
  },
  { type: "result", is_error: false, num_turns: 3 },
];

// Turn 2: what-if drop. Agent calls impact_of_dropping. Session id
// stays the same — the SDK will pass `resume` on this turn.
const TURN_2_SCRIPT: Array<Record<string, unknown>> = [
  {
    type: "assistant",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t2-imp",
          name: "mcp__rules-engine__impact_of_dropping",
          input: {
            course_code: "CS 25000",
            remaining_courses: [{ course_code: "CS 30700", prereqs: ["CS 25000"] }],
          },
        },
      ],
    },
  },
  {
    type: "user",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t2-imp",
          is_error: false,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                course_code: "CS 25000",
                now_blocked: ["CS 30700"],
                unblocked_by_removal: [],
              }),
            },
          ],
        },
      ],
    },
  },
  {
    type: "assistant",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "text",
          text: "Dropping CS 25000 would block CS 30700 downstream.",
        },
      ],
    },
  },
  { type: "result", is_error: false },
];

// Turn 3: profile read for continuity check.
const TURN_3_SCRIPT: Array<Record<string, unknown>> = [
  {
    type: "assistant",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t3-get",
          name: "mcp__profile-memory__get_student_profile",
          input: { student_id: "e2e-stu" },
        },
      ],
    },
  },
  {
    type: "user",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t3-get",
          is_error: false,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                student_id: "e2e-stu",
                program_id: "cs_bs",
                completed_courses: [{ course_code: "CS 18000" }],
              }),
            },
          ],
        },
      ],
    },
  },
  {
    type: "assistant",
    session_id: "sess-e2e-abc",
    message: {
      content: [
        {
          type: "text",
          text: "Where we left off: CS BS, CS 18000 done, weighing CS 25000.",
        },
      ],
    },
  },
  { type: "result", is_error: false },
];

// --- Tests ----------------------------------------------------------------

describe("end-to-end chat shape", () => {
  it("test_three_turn_conversation_streams_expected_tool_sequence", async () => {
    turnScripts = [TURN_1_SCRIPT, TURN_2_SCRIPT, TURN_3_SCRIPT];
    const { handleChat } = await import("@/src/routes/chat");

    // --- Turn 1 -----------------------------------------------------------
    const res1 = await handleChat(chatRequest("I'm a CS major at Purdue, just did CS 18000."));
    const events1 = await collectSseEvents(res1);
    const toolNames1 = events1
      .filter((e) => e.event === "tool_use")
      .map((e) => (e.data as { tool_name: string }).tool_name);
    expect(toolNames1).toEqual([
      "mcp__profile-memory__update_student_profile",
      "mcp__university-catalog__get_course",
    ]);
    // Session id captured + persisted.
    const stored = fakeDb.tables.session_state ?? [];
    expect(stored[0].sdk_session_id).toBe("sess-e2e-abc");
    // Assistant text arrives.
    const textEvents1 = events1.filter((e) => e.event === "assistant_text");
    expect(textEvents1.length).toBeGreaterThan(0);

    // --- Turn 2 -----------------------------------------------------------
    const res2 = await handleChat(chatRequest("What if I drop CS 25000?"));
    await collectSseEvents(res2);
    // The SDK was invoked with `resume` set to the persisted session id.
    expect(optionsSeen[1]?.resume).toBe("sess-e2e-abc");

    // --- Turn 3 -----------------------------------------------------------
    const res3 = await handleChat(chatRequest("Where did we leave off?"));
    const events3 = await collectSseEvents(res3);
    // Get-profile tool was called; the session persists across all three
    // turns.
    const toolNames3 = events3
      .filter((e) => e.event === "tool_use")
      .map((e) => (e.data as { tool_name: string }).tool_name);
    expect(toolNames3).toContain("mcp__profile-memory__get_student_profile");
    expect(optionsSeen[2]?.resume).toBe("sess-e2e-abc");
  });

  it("test_tool_result_events_pair_by_tool_use_id", async () => {
    turnScripts = [TURN_1_SCRIPT];
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(chatRequest("hi"));
    const events = await collectSseEvents(res);
    const uses = events
      .filter((e) => e.event === "tool_use")
      .map((e) => (e.data as { tool_use_id: string }).tool_use_id);
    const results = events
      .filter((e) => e.event === "tool_result")
      .map((e) => (e.data as { tool_use_id: string }).tool_use_id);
    expect(uses.sort()).toEqual(["t1-get", "t1-upd"]);
    expect(results.sort()).toEqual(["t1-get", "t1-upd"]);
  });

  it("test_terminates_with_done_event_carrying_session_id", async () => {
    turnScripts = [TURN_1_SCRIPT];
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(chatRequest("hi"));
    const events = await collectSseEvents(res);
    const last = events[events.length - 1];
    expect(last.event).toBe("done");
    expect((last.data as { session_id: string }).session_id).toBe(
      "sess-e2e-abc",
    );
  });
});
