// Fallback behavior — offline verification.
//
// The end-to-end "does Claude actually degrade politely" check requires
// a real Anthropic key and lives in scripts/smokeFallback.ts. This file
// covers everything we can verify without the LLM:
//   1. The mock catalog returns { error, detail } for every tool.
//   2. buildAgentOptions can swap in the mock catalog while keeping
//      rules-engine + profile-memory unchanged.
//   3. The chat SSE route correctly forwards a tool_result event with
//      is_error: true when the catalog fails.
//   4. The rules-engine tools run purely on student-reported courses,
//      with no catalog data required (plan §4 golden rule).

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invokeMockCatalogTool,
  mockCatalogTools,
  mockCatalogServer,
} from "@/lib/server/mcp/mockCatalog";
import { invokeRulesEngineTool } from "@/lib/server/mcp/rulesEngine";
import { CS_BS } from "@/lib/server/data/programs/cs_bs";

// --- 1. Mock catalog surface ---------------------------------------------

describe("mock catalog server", () => {
  it("test_mock_catalog_returns_unavailable_for_every_tool", async () => {
    const inputs: Record<string, Record<string, unknown>> = {
      get_course: { course_code: "CS 18000" },
      search_courses: { query: "CS" },
      get_program_requirements: { program_id: "cs_bs" },
      get_term_offerings: { course_code: "CS 18000", term: "Fall 2025" },
    };
    for (const t of mockCatalogTools) {
      const res = await invokeMockCatalogTool(t.name, inputs[t.name] ?? {});
      expect(res.isError, `${t.name} should be error`).toBe(true);
      const s = res.structuredContent as { error: string; detail: string };
      expect(s.error).toBe("unavailable");
      expect(s.detail).toContain("api.purdue.io");
    }
  });

  it("test_mock_catalog_exposes_expected_tool_names", () => {
    const names = mockCatalogTools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_course",
      "get_program_requirements",
      "get_term_offerings",
      "search_courses",
    ]);
  });

  it("test_mock_catalog_server_registers_under_correct_name", () => {
    // The server name has to match the real one so `allowedTools`
    // and the tool-render registry keep working during fallback runs.
    expect(mockCatalogServer.name).toBe("university-catalog");
  });
});

// --- 2. buildAgentOptions override ---------------------------------------

// Vi mock of supabase used by buildAgentOptions (readSessionId).
vi.mock("@/lib/server/supabase", async () => {
  const original = await import("@/lib/server/supabase");
  return {
    ...original,
    getSupabase: vi.fn(() => null), // no session_state — force fresh
  };
});

import { buildAgentOptions } from "@/lib/server/agent/session";

describe("buildAgentOptions with catalog override", () => {
  beforeEach(() => vi.clearAllMocks());

  it("test_build_agent_options_can_swap_catalog_server", async () => {
    const opts = await buildAgentOptions("stu-fallback", {
      catalogServer: mockCatalogServer,
    });
    expect(opts.mcpServers?.["university-catalog"]).toBe(mockCatalogServer);
    // Rules-engine + profile-memory stay production wiring.
    expect(opts.mcpServers?.["rules-engine"]).toBeDefined();
    expect(opts.mcpServers?.["profile-memory"]).toBeDefined();
    // Allowed tools list is unchanged.
    expect(opts.allowedTools?.length).toBe(12);
  });

  it("test_build_agent_options_uses_real_catalog_by_default", async () => {
    const opts = await buildAgentOptions("stu-fallback");
    // The default catalog is the real Purdue.io server — asserted by
    // its `name` matching the same string, but referring to a
    // different object identity than the mock.
    expect(opts.mcpServers?.["university-catalog"]).not.toBe(mockCatalogServer);
  });
});

// --- 3. Chat route forwards catalog errors -------------------------------

// Same mock harness as chatRoute.test.ts.

vi.mock("@/lib/server/cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/cookies")>();
  return {
    ...actual,
    requireStudent: vi.fn(async () => ({
      id: "stu-fallback-chat",
      session_id: "sid",
    })),
  };
});

// NOTE: We do NOT mock buildAgentOptions here. The chat-route test
// scripts SDK messages directly (via the mocked `query`), so the
// options object passed in doesn't matter — the mocked query ignores
// it. `captureSessionId` still gets a no-op so it doesn't touch
// Supabase.
vi.mock("@/lib/server/agent/session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/agent/session")>();
  return {
    ...actual,
    captureSessionId: vi.fn(async () => undefined),
  };
});

let scriptedMessages: Array<Record<string, unknown>> = [];
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  // Preserve the real `tool` + `createSdkMcpServer` so mockCatalog.ts
  // can build actual tool bindings; only replace `query` with our
  // scripted async iterable.
  const actual =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    query: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        for (const msg of scriptedMessages) yield msg;
      },
    })),
  };
});

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

describe("chat SSE route surfaces catalog fallback signal", () => {
  beforeEach(() => {
    scriptedMessages = [];
  });

  it("test_chat_route_forwards_catalog_error_tool_result", async () => {
    // Simulate the SDK's stream:
    // 1. Assistant asks catalog for a course.
    // 2. Catalog returns an error tool_result.
    // 3. Assistant honestly reports the outage in its next text.
    scriptedMessages = [
      {
        type: "assistant",
        session_id: "s",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t-1",
              name: "mcp__university-catalog__get_course",
              input: { course_code: "CS 25000" },
            },
          ],
        },
      },
      {
        type: "user",
        session_id: "s",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t-1",
              is_error: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "unavailable",
                    detail: "Mock catalog simulated outage.",
                  }),
                },
              ],
            },
          ],
        },
      },
      {
        type: "assistant",
        session_id: "s",
        message: {
          content: [
            {
              type: "text",
              text:
                "I don't have your school's catalog data available for CS 25000 right now.",
            },
          ],
        },
      },
      { type: "result", is_error: false },
    ];

    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(chatRequest("Tell me about CS 25000."));
    const events = await collectSseEvents(res);
    const toolResult = events.find((e) => e.event === "tool_result");
    expect(toolResult).toBeDefined();
    const data = toolResult!.data as {
      is_error: boolean;
      tool_use_id: string;
      content: unknown;
    };
    expect(data.is_error).toBe(true);
    expect(data.tool_use_id).toBe("t-1");

    const assistantTextEvent = events.find(
      (e) => e.event === "assistant_text",
    );
    expect(assistantTextEvent).toBeDefined();
    const text = (assistantTextEvent!.data as { text: string }).text;
    expect(text).toMatch(/don't have your school|catalog data/i);
  });
});

// --- 4. Rules engine standalone -----------------------------------------

describe("rules engine runs without catalog", () => {
  it("test_rules_engine_runs_without_catalog_when_student_reports_courses", async () => {
    // Zero catalog dependency: agent passes student-reported courses +
    // student-asserted prereqs. This is the plan §4 fallback path.
    const prereqRes = await invokeRulesEngineTool("check_prerequisites", {
      course_code: "CS 301",
      prereqs: ["CS 201", "MATH 210"],
      completed_courses: ["CS 101", "CS 201", "MATH 210"],
    });
    expect(prereqRes.isError).toBeFalsy();
    expect(
      (prereqRes.structuredContent as { satisfied: boolean }).satisfied,
    ).toBe(true);

    // Degree progress works against the archetype fixture — no catalog
    // needed at all, since archetypes are ground truth for the
    // fallback path.
    const progressRes = await invokeRulesEngineTool(
      "compute_degree_progress",
      {
        program_requirements: CS_BS,
        completed_courses: [
          { course_code: "CS 101", credits: 3, source: "manual" },
          { course_code: "CS 201", credits: 3, source: "manual" },
        ],
        waivers: [],
      },
    );
    expect(progressRes.isError).toBeFalsy();
    const p = progressRes.structuredContent as {
      program_id: string;
      total_credits: number;
    };
    expect(p.program_id).toBe("cs_bs");
    expect(p.total_credits).toBe(6);

    // Impact-of-dropping works against student-supplied remaining set —
    // no catalog dependency either.
    const impactRes = await invokeRulesEngineTool("impact_of_dropping", {
      course_code: "CS 201",
      remaining_courses: [
        { course_code: "CS 301", prereqs: ["CS 201", "MATH 210"] },
        { course_code: "CS 340", prereqs: ["CS 201"] },
      ],
    });
    expect(impactRes.isError).toBeFalsy();
    const impact = impactRes.structuredContent as { now_blocked: string[] };
    expect(impact.now_blocked.sort()).toEqual(["CS 301", "CS 340"]);
  });
});
