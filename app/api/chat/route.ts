// POST /api/chat — the single endpoint that drives the Academic
// Companion. Reads the student cookie, builds SDK options via
// `buildAgentOptions`, invokes `query()`, and streams every SDK
// message back to the browser as Server-Sent Events. The browser
// (Phase 5's <ChatView>) branches on event.type to render assistant
// text, tool_use notices, tool_result payloads (Phase 6 renders
// these as embedded viz), and errors.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { requireStudent, HttpError } from "@/lib/server/cookies";
import {
  buildAgentOptions,
  captureSessionId,
} from "@/lib/server/agent/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Multi-turn tool loops can run 30–90s against Claude + Purdue.io.
export const maxDuration = 300;

interface ChatBody {
  prompt?: string;
}

export async function POST(req: Request): Promise<Response> {
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

  const encoder = new TextEncoder();
  const captured: { current: string | null } = { current: null };
  const studentId = student.id;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const line =
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

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
        send("done", { session_id: captured.current });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no", // hint to any reverse proxy
    },
  });
}

// --- SSE event mapping ---------------------------------------------------
// Every SDK message becomes zero-or-more SSE events. Assistant text is
// the interesting one — SDK delivers whole content blocks per message
// (not token deltas), so we emit one `assistant_text` event per text
// block. Tool calls become discrete `tool_use` / `tool_result` events
// the frontend can render inline (Phase 6).

type SseEvent = { event: string; data: unknown };

function toSseEvents(msg: unknown): SseEvent[] {
  if (!msg || typeof msg !== "object") return [];
  const m = msg as Record<string, unknown>;
  const type = String(m.type ?? "");

  if (type === "assistant") {
    const events: SseEvent[] = [];
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
            tool_use_id: block.id,
            tool_name: block.name,
            input: block.input ?? {},
          },
        });
      }
    }
    return events;
  }

  if (type === "user") {
    // The SDK re-emits user messages that carry tool_result blocks
    // when a tool completes. Surface these so Phase 6 can render.
    const events: SseEvent[] = [];
    const inner = (m.message as Record<string, unknown>) ?? {};
    const content = (inner.content as Array<Record<string, unknown>>) ?? [];
    for (const block of content) {
      if (block.type === "tool_result") {
        if (block.is_error === true) {
          // Server-side log so tool errors are visible in the dev
          // terminal without having to expand each step in the UI.
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
            tool_use_id: block.tool_use_id,
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
          subtype: m.subtype,
          is_error: m.is_error === true,
          num_turns: m.num_turns,
        },
      },
    ];
  }

  // system/init and other internal frames aren't surfaced to the UI —
  // they'd clutter the message log. The browser has enough from the
  // `assistant_text` / `tool_*` streams.
  return [];
}

// --- Error response helper -----------------------------------------------
// For hard-fail cases we can't stream (bad auth / bad body). Return a
// single-event SSE stream so the frontend's parser doesn't have to
// branch on content-type — every chat request produces SSE.

function sseError(status: number, error: string, detail: string): Response {
  const payload = `event: error\ndata: ${JSON.stringify({ error, detail })}\n\nevent: done\ndata: {}\n\n`;
  return new Response(payload, {
    status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
