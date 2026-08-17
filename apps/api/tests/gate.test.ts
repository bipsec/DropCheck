// Concurrency-gate tests.
//
// The gate is what stops a second chat turn from spawning a second
// ~300 MB `claude` subprocess on a 512 MB instance. Two properties matter
// and neither is visible by reading the happy path:
//
//   1. A turn in flight makes the next one 503 rather than accept it.
//   2. Every way a turn can end gives the slot back. A slot that leaks
//      turns MAX_CONCURRENT_TURNS=1 into a permanent outage, and the
//      leaky path is the one nobody drives by hand: the student closing
//      the tab, which cancels the stream instead of draining it.
//
// Mocks mirror chatRoute.test.ts — no Anthropic, no Supabase.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/cookies", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/cookies")>();
  return {
    ...actual,
    requireStudent: vi.fn(async () => ({
      id: "stu-gate",
      session_id: "sid-gate",
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

/**
 * A turn we can hold open for as long as the test needs. The mocked SDK
 * yields one assistant message and then parks on `gate`, which is exactly
 * the shape of a real turn waiting on a tool call.
 */
let holdTurn: { promise: Promise<void>; release: () => void };
function deferred(): typeof holdTurn {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: "assistant",
        session_id: "s",
        message: { content: [{ type: "text", text: "working" }] },
      };
      await holdTurn.promise;
      yield { type: "result", subtype: "success", is_error: false };
    },
  })),
}));

function chatRequest(prompt: string): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

async function drain(res: Response): Promise<string> {
  if (!res.body) return "";
  return await new Response(res.body).text();
}

/** Let the stream's `finally` (and therefore `release()`) actually run. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

async function errorCodeOf(res: Response): Promise<string | null> {
  const text = await drain(res);
  const m = /data: (\{.*?\})/.exec(text);
  if (!m) return null;
  return (JSON.parse(m[1]) as { error?: string }).error ?? null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  holdTurn = deferred();
  process.env.MAX_CONCURRENT_TURNS = "1";
  const { _resetSettingsForTests } = await import("@/lib/server/config");
  _resetSettingsForTests();
  const { _resetGateForTests } = await import("@/src/lib/gate");
  _resetGateForTests();
});

afterEach(async () => {
  // Never leave a parked turn behind: its heartbeat interval would keep
  // the event loop alive.
  holdTurn.release();
  await settle();
  delete process.env.MAX_CONCURRENT_TURNS;
  const { _resetSettingsForTests } = await import("@/lib/server/config");
  _resetSettingsForTests();
});

describe("chat concurrency gate", () => {
  it("test_gate_second_turn_gets_503_server_busy", async () => {
    const { handleChat } = await import("@/src/routes/chat");
    const { turnsInFlight } = await import("@/src/lib/gate");

    const first = await handleChat(chatRequest("turn one"));
    expect(first.status).toBe(200);
    expect(turnsInFlight()).toBe(1);

    const second = await handleChat(chatRequest("turn two"));
    expect(second.status).toBe(503);
    // Failure stays inside the SSE contract, so the browser's parser
    // never has to branch on content-type.
    expect(second.headers.get("content-type")).toContain("text/event-stream");
    expect(await errorCodeOf(second)).toBe("server_busy");

    holdTurn.release();
    await drain(first);
  });

  it("test_gate_releases_slot_after_turn_completes", async () => {
    const { handleChat } = await import("@/src/routes/chat");
    const { turnsInFlight } = await import("@/src/lib/gate");

    const first = await handleChat(chatRequest("turn one"));
    holdTurn.release();
    await drain(first);
    await settle();
    expect(turnsInFlight()).toBe(0);

    const next = await handleChat(chatRequest("turn two"));
    expect(next.status).toBe(200);
    holdTurn.release();
    await drain(next);
  });

  it("test_gate_releases_slot_when_client_disconnects", async () => {
    // The leak that matters. `start()` is still parked on the SDK, so its
    // `finally` hasn't run — only cancel() can free the slot here.
    const { handleChat } = await import("@/src/routes/chat");
    const { turnsInFlight } = await import("@/src/lib/gate");

    const abandoned = await handleChat(chatRequest("turn one"));
    expect(turnsInFlight()).toBe(1);
    await abandoned.body!.cancel();
    expect(turnsInFlight()).toBe(0);

    const next = await handleChat(chatRequest("turn two"));
    expect(next.status).toBe(200);

    // The abandoned turn's own `finally` still runs when the SDK finally
    // returns; its release must be a no-op, not a second decrement that
    // hands out capacity the process doesn't have.
    holdTurn.release();
    await drain(next);
    await settle();
    expect(turnsInFlight()).toBe(0);
  });

  it("test_gate_honours_max_concurrent_turns", async () => {
    process.env.MAX_CONCURRENT_TURNS = "2";
    const { _resetSettingsForTests } = await import("@/lib/server/config");
    _resetSettingsForTests();

    const { handleChat } = await import("@/src/routes/chat");
    const a = await handleChat(chatRequest("a"));
    const b = await handleChat(chatRequest("b"));
    const c = await handleChat(chatRequest("c"));
    expect([a.status, b.status, c.status]).toEqual([200, 200, 503]);

    holdTurn.release();
    await Promise.all([drain(a), drain(b), drain(c)]);
  });

  it("test_gate_rejects_bogus_max_concurrent_turns_value", async () => {
    // `MAX_CONCURRENT_TURNS=0` would 503 every request forever, so a
    // non-positive or unparseable value falls back to the default.
    process.env.MAX_CONCURRENT_TURNS = "0";
    const { _resetSettingsForTests, getSettings } = await import(
      "@/lib/server/config"
    );
    _resetSettingsForTests();
    expect(getSettings().max_concurrent_turns).toBe(1);

    process.env.MAX_CONCURRENT_TURNS = "lots";
    _resetSettingsForTests();
    expect(getSettings().max_concurrent_turns).toBe(1);
  });

  it("test_health_is_never_gated", async () => {
    // A saturated server must still pass Render's health check, or a
    // normal busy moment gets the container restarted mid-conversation.
    const { handleChat } = await import("@/src/routes/chat");
    const { handleHealth } = await import("@/src/routes/health");

    const busy = await handleChat(chatRequest("turn one"));
    const health = handleHealth();
    expect(health.status).toBe(200);
    const body = (await health.json()) as {
      ok: boolean;
      turns_in_flight: number;
    };
    expect(body.ok).toBe(true);
    expect(body.turns_in_flight).toBe(1);

    holdTurn.release();
    await drain(busy);
  });
});
