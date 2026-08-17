// POST /api/chat — the single endpoint that drives the Academic
// Companion. Reads the student session, builds SDK options via
// `buildAgentOptions`, invokes `query()`, and streams every SDK message
// back to the browser as Server-Sent Events. The browser's <ChatView>
// branches on event type to render assistant text, tool_use notices,
// tool_result payloads (embedded visualizations), and errors.
//
// WHY THIS ISN'T A NEXT.JS ROUTE ANY MORE:
//
// `@anthropic-ai/claude-agent-sdk` spawns a native `claude` CLI
// subprocess resolved from a platform-specific optional dependency
// (`@anthropic-ai/claude-agent-sdk-linux-x64` and friends). That binary
// is ~300 MB — larger on its own than Vercel's 250 MB uncompressed
// function limit — and it writes session transcripts to
// CLAUDE_CONFIG_DIR, which is read-only on Vercel. So the agent runs on
// a container host (Render) while Vercel serves only the frontend.
//
// That subprocess is also why this route is gated: see src/lib/gate.ts.
//
// The handler signature is deliberately `(req: Request) =>
// Promise<Response>`: identical to what the Next.js route exported, and
// identical to what Hono passes through as `c.req.raw`. That's why the
// move required no rewrite of the streaming logic.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ChatStreamEvent } from "@dropcheck/shared";
import { requireStudent, HttpError } from "@/lib/server/cookies";
import {
  buildAgentOptions,
  captureSessionId,
} from "@/lib/server/agent/session";
import {
  HEARTBEAT_FRAME,
  heartbeatMs,
  sseError,
  sseHeaders,
} from "../lib/sse";
import { tryAcquireTurn } from "../lib/gate";

interface ChatBody {
  prompt?: string;
}

export async function handleChat(req: Request): Promise<Response> {
  let student;
  try {
    student = await requireStudent(req);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 401;
    const detail = err instanceof Error ? err.message : "unauthenticated";
    return sseError(status, "unauthenticated", detail);
  }
  if (!student.id) {
    return sseError(401, "unauthenticated", "student row missing an id");
  }

  let body: ChatBody = {};
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return sseError(400, "invalid_body", "Request body was not JSON.");
  }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return sseError(400, "invalid_body", "`prompt` must be a non-empty string.");
  }

  const options = await buildAgentOptions(student.id).catch((err) => {
    console.warn("[chat] buildAgentOptions failed:", err);
    return null;
  });
  if (!options) {
    return sseError(
      500,
      "agent_bootstrap_failed",
      "Could not assemble agent options.",
    );
  }

  // Claim a turn slot *after* validation — no point holding capacity for
  // a request that was about to 400. Rejecting rather than queueing is
  // deliberate: on a small instance behind multi-minute turns, a queue
  // just relocates the failure to a browser timeout, where the student
  // gets no message at all. A 503 arrives as a normal `error` event that
  // <ChatView> already renders.
  const release = tryAcquireTurn();
  if (!release) {
    return sseError(
      503,
      "server_busy",
      "The advisor is handling another conversation right now. Try again in a moment.",
    );
  }

  const encoder = new TextEncoder();
  const captured: { current: string | null } = { current: null };
  const studentId = student.id;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Once the client is gone, `enqueue` throws. Latch that instead of
      // letting it unwind — the `finally` below still has to release the
      // turn slot, and an exception on the way there would leak it.
      let live = true;
      const write = (chunk: string) => {
        if (!live) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          live = false;
        }
      };
      const send = (event: string, data: unknown) => {
        write(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`);
      };

      const heartbeat = setInterval(() => write(HEARTBEAT_FRAME), heartbeatMs());

      try {
        const q = query({ prompt, options });
        for await (const msg of q) {
          // Persist session_id on first message that carries one.
          await captureSessionId(studentId, msg, captured).catch(
            () => undefined,
          );

          // Translate SDK message → SSE event(s).
          for (const ev of toSseEvents(msg)) {
            send(ev.event, ev.data);
          }
        }
      } catch (err) {
        console.error("[chat] SDK stream failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        send("error", { error: "sdk_stream_failed", detail });
      } finally {
        // Order matters: free the timer and the slot before touching the
        // controller, so a throw from close() can't strand either.
        clearInterval(heartbeat);
        release();
        send("done", { session_id: captured.current });
        if (live) {
          try {
            controller.close();
          } catch {
            // Already closed by cancel(); nothing left to do.
          }
        }
      }
    },
    cancel() {
      // The student closed the tab or navigated away. `start`'s finally
      // may not run for a while (it's still awaiting the SDK), and a slot
      // that never comes back turns a MAX_CONCURRENT_TURNS=1 server into
      // a permanent 503. release() is idempotent, so the double call from
      // finally is harmless.
      release();
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders() });
}

// --- SSE event mapping ---------------------------------------------------
// Every SDK message becomes zero-or-more SSE events. Assistant text is
// the interesting one — the SDK delivers whole content blocks per
// message (not token deltas), so we emit one `assistant_text` event per
// text block. Tool calls become discrete `tool_use` / `tool_result`
// events the frontend renders inline as embedded visualizations.
//
// Typed against ChatStreamEvent from @dropcheck/shared so the emitter
// and the browser's parser can't drift apart silently.

export function toSseEvents(msg: unknown): ChatStreamEvent[] {
  if (!msg || typeof msg !== "object") return [];
  const m = msg as Record<string, unknown>;
  const type = String(m.type ?? "");

  if (type === "assistant") {
    const events: ChatStreamEvent[] = [];
    const inner = (m.message as Record<string, unknown>) ?? {};
    const content = (inner.content as Array<Record<string, unknown>>) ?? [];
    for (const block of content) {
      if (block.type === "text") {
        events.push({
          event: "assistant_text",
          data: { text: String(block.text ?? "") },
        });
      } else if (block.type === "tool_use") {
        events.push({
          event: "tool_use",
          data: {
            tool_use_id: String(block.id ?? ""),
            tool_name: String(block.name ?? ""),
            input: (block.input as Record<string, unknown>) ?? {},
          },
        });
      }
    }
    return events;
  }

  if (type === "user") {
    // The SDK re-emits user messages that carry tool_result blocks when
    // a tool completes. Surface these so the browser can render them.
    const events: ChatStreamEvent[] = [];
    const inner = (m.message as Record<string, unknown>) ?? {};
    const content = (inner.content as Array<Record<string, unknown>>) ?? [];
    for (const block of content) {
      if (block.type === "tool_result") {
        if (block.is_error === true) {
          // Server-side log so tool errors are visible in the host's
          // logs without expanding each step in the UI.
          console.warn(
            `[chat] tool_error tool_use_id=${String(block.tool_use_id ?? "")}`,
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content).slice(0, 500),
          );
        }
        events.push({
          event: "tool_result",
          data: {
            tool_use_id: String(block.tool_use_id ?? ""),
            is_error: block.is_error === true,
            content: block.content,
          },
        });
      }
    }
    return events;
  }

  if (type === "result") {
    return [
      {
        event: "run_result",
        data: {
          subtype: m.subtype as string | undefined,
          is_error: m.is_error === true,
          num_turns: m.num_turns as number | undefined,
        },
      },
    ];
  }

  // system/init and other internal frames aren't surfaced to the UI —
  // they'd clutter the message log. The browser has enough from the
  // `assistant_text` / `tool_*` streams.
  return [];
}
