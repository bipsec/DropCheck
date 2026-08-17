// In-process concurrency gate for chat turns.
//
// WHY THIS EXISTS: every /api/chat turn spawns a native `claude` CLI
// subprocess with a multi-hundred-MB resident set. On Cloud Run that was
// bounded by `--concurrency 2`, a platform flag that capped how many
// requests one instance would accept at once. Render has no equivalent
// knob — a single instance takes all traffic, and Node happily accepts
// unlimited concurrent requests — so the OOM protection has to live in
// the application. Without it, the third simultaneous student kills the
// container for everyone.
//
// Deliberately not a queue: see the note in src/routes/chat.ts.

import { getSettings } from "@/lib/server/config";

let inFlight = 0;

/**
 * Non-blocking acquire. Returns a **release function** on success (so a
 * caller can only ever release its own slot) or `null` when the server
 * is already at `MAX_CONCURRENT_TURNS`.
 *
 * The returned function is idempotent: /api/chat releases from both the
 * stream's `finally` and its `cancel()` handler, because a client that
 * disconnects mid-turn may only trigger one of them. A double release
 * would leak capacity upward; a missing one would leak it downward until
 * the server permanently answered 503.
 */
export function tryAcquireTurn(): (() => void) | null {
  if (inFlight >= getSettings().max_concurrent_turns) return null;
  inFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
}

/** Current occupancy. Surfaced by /api/health for "busy vs wedged". */
export function turnsInFlight(): number {
  return inFlight;
}

/** Test-only: drop all slots so one suite can't strand the next. */
export function _resetGateForTests(): void {
  inFlight = 0;
}
