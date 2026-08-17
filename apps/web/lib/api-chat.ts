// Client-side SSE parser for `POST /api/chat`.
//
// EventSource can't do POST, so we roll our own fetch + ReadableStream
// reader. The wire format is standard SSE: `event: <name>\ndata: <json>\n\n`.
// Each event is dispatched through the supplied `onEvent` callback so
// the caller (chat-view) can route text / tool_use / tool_result / etc.
// to the right renderer.

// The event union lives in @dropcheck/shared so the API's SSE emitter
// and this parser typecheck against one definition — adding an event on
// the server without handling it here becomes a type error rather than a
// silently dropped frame. Re-exported so existing component imports from
// `@/lib/api-chat` keep working.
import type { ChatEventName, ChatStreamEvent } from "@dropcheck/shared";

import { apiUrl } from "@/lib/api-config";

export type {
  ChatEventName,
  ChatEvent,
  AssistantTextEvent,
  ToolUseEvent,
  ToolResultEvent,
  RunResultEvent,
  ErrorEvent,
  DoneEvent,
  ChatStreamEvent,
} from "@dropcheck/shared";

export interface ChatStreamOpts {
  prompt: string;
  signal?: AbortSignal;
  onEvent: (ev: ChatStreamEvent) => void;
}

/**
 * Open a POST /api/chat SSE stream and dispatch every parsed event.
 * Returns when the stream naturally ends (a `done` event or reader
 * close). Throws only on transport-level failures — SDK errors surface
 * as `event: error` events, not thrown.
 */
export async function streamChat(opts: ChatStreamOpts): Promise<void> {
  const res = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: opts.prompt }),
    credentials: "include",
    signal: opts.signal,
  });

  if (!res.body) {
    opts.onEvent({
      event: "error",
      data: { error: "no_stream", detail: "Response had no body." },
    });
    opts.onEvent({ event: "done", data: {} });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on double newline — SSE frame boundary.
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseFrame(frame);
      if (parsed) opts.onEvent(parsed);
      idx = buffer.indexOf("\n\n");
    }
  }
  // Flush a trailing frame if any (unlikely — servers should terminate cleanly).
  if (buffer.trim().length > 0) {
    const parsed = parseFrame(buffer);
    if (parsed) opts.onEvent(parsed);
  }
}

function parseFrame(frame: string): ChatStreamEvent | null {
  let eventName: string | null = null;
  const dataLines: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith(":")) continue; // SSE comment
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }
  if (!eventName || dataLines.length === 0) return null;
  try {
    const data = JSON.parse(dataLines.join("\n"));
    return { event: eventName as ChatEventName, data } as ChatStreamEvent;
  } catch {
    return null;
  }
}
