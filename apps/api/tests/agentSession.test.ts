// Phase 4 tests — verify the SDK is wired with all three MCP servers,
// the exhaustive `allowedTools` list, and the advisory system prompt.
// Session continuity: session_id persisted on first turn, resumed on
// subsequent turns.
//
// The SDK's `query()` itself is not invoked (that would need a real
// Anthropic key); we only assert what buildAgentOptions ships into
// `options`. captureSessionId is tested via a small stubbed message.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fake Supabase (session_state only) -----------------------------------

type Row = Record<string, unknown>;

class FakeQuery {
  private table: string;
  private db: FakeDB;
  private filters: Array<[string, unknown]> = [];
  private limitN: number | null = null;
  private pending:
    | { kind: "select" }
    | { kind: "upsert"; rows: Row[] }
    | { kind: "delete" }
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
  delete() {
    this.pending = { kind: "delete" };
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
    if (this.pending?.kind === "delete") {
      this.db.tables[this.table] = store.filter(
        (r) => !this.filters.every(([k, v]) => r[k] === v),
      );
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
  from(name: string): FakeQuery {
    return new FakeQuery(name, this);
  }
}

let fakeDb: FakeDB;

vi.mock("@/lib/server/supabase", async () => {
  const original = await import("@/lib/server/supabase");
  return {
    ...original,
    getSupabase: vi.fn(() => fakeDb),
  };
});

import {
  buildAgentOptions,
  captureSessionId,
} from "@/lib/server/agent/session";
import { ALLOWED_TOOLS } from "@/lib/server/agent/allowedTools";
import { ADVISOR_SYSTEM_PROMPT } from "@/lib/server/agent/systemPrompt";
import {
  readSessionId,
  writeSessionId,
  clearSessionId,
} from "@/lib/server/services/sessionStore";

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb = new FakeDB();
});

// --- Options wiring --------------------------------------------------------

describe("buildAgentOptions", () => {
  it("test_agent_options_include_all_three_mcp_servers", async () => {
    const opts = await buildAgentOptions("stu-1");
    expect(opts.mcpServers).toBeDefined();
    const keys = Object.keys(opts.mcpServers ?? {}).sort();
    expect(keys).toEqual(["profile-memory", "rules-engine", "university-catalog"]);
  });

  it("test_agent_options_include_exhaustive_allowed_tools", async () => {
    const opts = await buildAgentOptions("stu-1");
    // Every mcp__<server>__<tool> we declared is on the list.
    expect(opts.allowedTools).toBeDefined();
    for (const t of ALLOWED_TOOLS) {
      expect(opts.allowedTools).toContain(t);
    }
    // 4 rules + 3 profile + 4 catalog = 11 tools.
    expect(opts.allowedTools!.length).toBe(11);
  });

  it("test_agent_options_include_advisor_system_prompt", async () => {
    const opts = await buildAgentOptions("stu-1");
    // System prompt starts with the shared ADVISOR_SYSTEM_PROMPT then
    // appends a per-student CURRENT SESSION CONTEXT block carrying
    // the UUID — the LLM needs that to call profile-memory tools.
    const prompt = String(opts.systemPrompt);
    expect(prompt).toContain(ADVISOR_SYSTEM_PROMPT);
    expect(prompt).toMatch(/HARD RULES YOU MUST FOLLOW/);
    expect(prompt).toMatch(/CURRENT SESSION CONTEXT/);
    expect(prompt).toContain("stu-1");
  });

  it("test_agent_options_inject_student_id_into_prompt", async () => {
    const opts = await buildAgentOptions("00000000-0000-0000-0000-abcdef123456");
    // The exact UUID appears verbatim so the LLM can quote it into
    // tool calls without paraphrasing.
    expect(String(opts.systemPrompt)).toContain(
      "00000000-0000-0000-0000-abcdef123456",
    );
  });

  it("test_agent_options_omit_resume_when_no_prior_session", async () => {
    const opts = await buildAgentOptions("stu-1");
    expect(opts.resume).toBeUndefined();
  });

  it("test_agent_options_include_resume_when_session_persisted", async () => {
    fakeDb.tables.session_state = [
      { student_id: "stu-1", sdk_session_id: "sess-abc-123" },
    ];
    const opts = await buildAgentOptions("stu-1");
    expect(opts.resume).toBe("sess-abc-123");
  });

  it("test_agent_options_permission_mode_default", async () => {
    const opts = await buildAgentOptions("stu-1");
    expect(opts.permissionMode).toBe("default");
  });
});

// --- captureSessionId ------------------------------------------------------

describe("captureSessionId", () => {
  it("test_captures_first_session_id_from_message_stream", async () => {
    const captured = { current: null as string | null };
    // Simulate three streamed messages — session_id lands on all three
    // but we only write once.
    await captureSessionId(
      "stu-1",
      { type: "assistant", session_id: "sess-xyz-1" },
      captured,
    );
    await captureSessionId(
      "stu-1",
      { type: "assistant", session_id: "sess-xyz-1" },
      captured,
    );
    await captureSessionId(
      "stu-1",
      { type: "assistant", session_id: "sess-xyz-1" },
      captured,
    );
    expect(captured.current).toBe("sess-xyz-1");
    // Row persisted.
    const stored = await readSessionId("stu-1");
    expect(stored).toBe("sess-xyz-1");
  });

  it("test_capture_no_op_on_message_without_session_id", async () => {
    const captured = { current: null as string | null };
    await captureSessionId("stu-1", { type: "system" }, captured);
    expect(captured.current).toBeNull();
    expect(await readSessionId("stu-1")).toBeNull();
  });

  it("test_capture_no_op_on_non_object_message", async () => {
    const captured = { current: null as string | null };
    await captureSessionId("stu-1", "not a message", captured);
    await captureSessionId("stu-1", null, captured);
    expect(captured.current).toBeNull();
  });
});

// --- Session store round-trip ---------------------------------------------

describe("sessionStore", () => {
  it("test_session_state_persists_and_resumes", async () => {
    // Write, read, verify.
    await writeSessionId("stu-A", "sess-1");
    expect(await readSessionId("stu-A")).toBe("sess-1");

    // Overwriting is idempotent on the (student_id) PK.
    await writeSessionId("stu-A", "sess-2");
    expect(await readSessionId("stu-A")).toBe("sess-2");

    // Isolation between students.
    await writeSessionId("stu-B", "sess-B-1");
    expect(await readSessionId("stu-A")).toBe("sess-2");
    expect(await readSessionId("stu-B")).toBe("sess-B-1");
  });

  it("test_session_store_returns_null_on_miss", async () => {
    expect(await readSessionId("ghost")).toBeNull();
  });

  it("test_clear_session_drops_row", async () => {
    await writeSessionId("stu-C", "sess-C-1");
    expect(await readSessionId("stu-C")).toBe("sess-C-1");
    await clearSessionId("stu-C");
    expect(await readSessionId("stu-C")).toBeNull();
  });
});
