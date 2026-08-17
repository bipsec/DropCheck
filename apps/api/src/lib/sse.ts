// Server-Sent Events response helpers.
//
// Split out of the chat route so the error path can be reused by any
// endpoint that has to fail *inside* an SSE contract — the browser's
// parser in `apps/web/lib/api-chat.ts` assumes every /api/chat response
// is `text/event-stream`, success or failure, so it never has to branch
// on content-type.

export function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "x-accel-buffering": "no", // hint to any reverse proxy
  };
}

/**
 * A comment frame — valid SSE that carries no event, so a compliant
 * client discards it. Ours does: `parseFrame` in
 * apps/web/lib/api-chat.ts skips any line starting with `:`.
 *
 * This exists to keep the connection warm. A long advising turn can go
 * 30–60 s between tool results with zero bytes on the wire, and every
 * layer between the browser and this process (Render's proxy, corporate
 * middleboxes, any CDN) is entitled to reap an idle connection. Periodic
 * bytes make the whole class of problem go away without depending on any
 * one host's documented timeout.
 */
export const HEARTBEAT_FRAME = ": ping\n\n";

/**
 * Heartbeat period. `SSE_HEARTBEAT_MS` exists so tests can assert a
 * heartbeat lands without sleeping 15 s; it is also the escape hatch if
 * something in front of this service reaps faster than 15 s.
 */
export function heartbeatMs(): number {
  const raw = Number(process.env.SSE_HEARTBEAT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
}

/**
 * For hard-fail cases we can't stream (bad auth / bad body / missing
 * config). Returns a single-event SSE stream carrying `{error, detail}`
 * followed by `done`, so the client's reducer closes the assistant
 * bubble and shows an error row.
 */
export function sseError(
  status: number,
  error: string,
  detail: string,
): Response {
  const payload =
    `event: error\ndata: ${JSON.stringify({ error, detail })}\n\n` +
    `event: done\ndata: {}\n\n`;
  return new Response(payload, {
    status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
