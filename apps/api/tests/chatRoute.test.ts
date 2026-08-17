// Chat-route tests. Mocks the SDK's `query()` with a canned async
// iterable so we exercise the SSE encoding without touching Anthropic
// or Supabase. Every event shape the frontend depends on is verified.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks --------------------------------------------------------------

vi.mock("@/lib/server/cookies", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/cookies")>();
  return {
    ...actual,
    requireStudent: vi.fn(async () => ({
      id: "stu-chat",
      session_id: "sid-1",
    })),
  };
});

vi.mock("@/lib/server/agent/session", () => ({
  buildAgentOptions: vi.fn(async () => ({
    systemPrompt: "test",
    mcpServers: {},
    allowedTools: [],
  })),
  captureSessionId: vi.fn(async () => undefined),
}));

let scriptedMessages: Array<Record<string, unknown>> = [];
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    // async iterable that yields the scripted messages in order
    return {
      async *[Symbol.asyncIterator]() {
        for (const msg of scriptedMessages) yield msg;
      },
    } as AsyncIterable<Record<string, unknown>>;
  }),
}));

// --- SSE parsing helper -------------------------------------------------

async function collectSseEvents(
  res: Response,
): Promise<Array<{ event: string; data: unknown }>> {
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
      const parsed = parseFrame(frame);
      if (parsed) events.push(parsed);
      idx = buffer.indexOf("\n\n");
    }
  }
  return events;
}

function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (!event || dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  scriptedMessages = [];
});

// --- Tests -------------------------------------------------------------

describe("POST /api/chat", () => {
  it("test_chat_streams_assistant_text_as_sse", async () => {
    scriptedMessages = [
      {
        type: "assistant",
        session_id: "sess-1",
        message: {
          content: [
            { type: "text", text: "Hi there," },
            { type: "text", text: "how can I help?" },
          ],
        },
      },
      { type: "result", subtype: "success", is_error: false, num_turns: 1 },
    ];
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(jsonRequest({ prompt: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await collectSseEvents(res);
    const kinds = events.map((e) => e.event);
    expect(kinds).toContain("assistant_text");
    expect(kinds).toContain("run_result");
    expect(kinds[kinds.length - 1]).toBe("done");
    const textEvents = events.filter((e) => e.event === "assistant_text");
    expect(textEvents.length).toBe(2);
    expect((textEvents[0].data as { text: string }).text).toBe("Hi there,");
    expect((textEvents[1].data as { text: string }).text).toBe("how can I help?");
  });

  it("test_chat_maps_tool_use_and_tool_result_blocks", async () => {
    scriptedMessages = [
      {
        type: "assistant",
        session_id: "s",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t-1",
              name: "mcp__rules-engine__build_track",
              input: { program_id: "cs_bs" },
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
              is_error: false,
              content: [{ type: "text", text: "{\"terms\":[]}" }],
            },
          ],
        },
      },
      { type: "result", is_error: false },
    ];
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(jsonRequest({ prompt: "plan me" }));
    const events = await collectSseEvents(res);
    const use = events.find((e) => e.event === "tool_use");
    const result = events.find((e) => e.event === "tool_result");
    expect(use).toBeDefined();
    expect((use!.data as { tool_name: string }).tool_name).toBe(
      "mcp__rules-engine__build_track",
    );
    expect(result).toBeDefined();
    expect((result!.data as { tool_use_id: string }).tool_use_id).toBe("t-1");
    expect((result!.data as { is_error: boolean }).is_error).toBe(false);
  });

  it("test_chat_terminates_with_done_event", async () => {
    scriptedMessages = [
      {
        type: "assistant",
        session_id: "s",
        message: { content: [{ type: "text", text: "ok" }] },
      },
    ];
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(jsonRequest({ prompt: "hi" }));
    const events = await collectSseEvents(res);
    expect(events[events.length - 1].event).toBe("done");
  });

  it("test_chat_rejects_empty_prompt_with_error_event", async () => {
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(jsonRequest({ prompt: "   " }));
    expect(res.status).toBe(400);
    const events = await collectSseEvents(res);
    const err = events.find((e) => e.event === "error");
    expect(err).toBeDefined();
    expect((err!.data as { error: string }).error).toBe("invalid_body");
  });

  it("test_chat_rejects_missing_prompt_field", async () => {
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(jsonRequest({}));
    expect(res.status).toBe(400);
    const events = await collectSseEvents(res);
    expect(events.some((e) => e.event === "error")).toBe(true);
  });

  it("test_chat_maps_sdk_stream_failure_to_error_event", async () => {
    // Make the mocked query throw partway through.
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    vi.mocked(sdk.query).mockImplementationOnce(
      () =>
        ({
          async *[Symbol.asyncIterator]() {
            yield {
              type: "assistant",
              session_id: "s",
              message: { content: [{ type: "text", text: "partial" }] },
            };
            throw new Error("boom from sdk");
          },
        }) as never,
    );
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(jsonRequest({ prompt: "go" }));
    const events = await collectSseEvents(res);
    // We saw the partial text AND the error, then done.
    expect(events.some((e) => e.event === "assistant_text")).toBe(true);
    const err = events.find((e) => e.event === "error");
    expect(err).toBeDefined();
    expect((err!.data as { error: string }).error).toBe("sdk_stream_failed");
    expect(events[events.length - 1].event).toBe("done");
  });

  it("test_chat_emits_heartbeat_comment_frames_invisible_to_the_client", async () => {
    // A real turn can go a minute between tool results. The heartbeat is
    // what stops a proxy from reaping the connection in that gap — and it
    // has to be a *comment* frame, so the client discards it rather than
    // rendering an empty message.
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    vi.mocked(sdk.query).mockImplementationOnce(
      () =>
        ({
          async *[Symbol.asyncIterator]() {
            yield {
              type: "assistant",
              session_id: "s",
              message: { content: [{ type: "text", text: "thinking" }] },
            };
            // Stand in for a slow tool call.
            await new Promise((r) => setTimeout(r, 40));
            yield { type: "result", subtype: "success", is_error: false };
          },
        }) as never,
    );

    process.env.SSE_HEARTBEAT_MS = "5";
    try {
      const { handleChat } = await import("@/src/routes/chat");
      const res = await handleChat(jsonRequest({ prompt: "slow one" }));
      const raw = await new Response(res.body).text();

      expect(raw).toContain(": ping\n\n");
      // Same bytes through the real frame parser: zero events.
      const frames = raw.split("\n\n").filter((f) => f.trim() !== "");
      const pings = frames.filter((f) => f.startsWith(":"));
      expect(pings.length).toBeGreaterThan(0);
      expect(pings.every((f) => parseFrame(f) === null)).toBe(true);
      // …and the real events still arrive intact alongside them.
      const events = frames
        .map(parseFrame)
        .filter((e): e is { event: string; data: unknown } => e !== null);
      expect(events.map((e) => e.event)).toContain("assistant_text");
      expect(events[events.length - 1].event).toBe("done");
    } finally {
      delete process.env.SSE_HEARTBEAT_MS;
    }
  });

  it("test_chat_401_when_no_student", async () => {
    const cookies = await import("@/lib/server/cookies");
    vi.mocked(cookies.requireStudent).mockRejectedValueOnce(
      new cookies.HttpError(401, "no cookie"),
    );
    const { handleChat } = await import("@/src/routes/chat");
    const res = await handleChat(jsonRequest({ prompt: "hi" }));
    expect(res.status).toBe(401);
    const events = await collectSseEvents(res);
    const err = events.find((e) => e.event === "error");
    expect(err).toBeDefined();
    expect((err!.data as { error: string }).error).toBe("unauthenticated");
  });
});
