// GET /api/health — liveness probe for Render's `healthCheckPath`.
//
// Deliberately checks nothing external. If this pinged Supabase or
// Anthropic, a credential outage or third-party hiccup would make Render
// judge a perfectly healthy container unhealthy and recycle it, turning a
// degraded feature into a hard outage. "The process is up and serving
// HTTP" is the only claim this endpoint makes.
//
// For the same reason the concurrency gate must never cover this route:
// a saturated server still has to answer the probe, or a normal busy
// moment gets it restarted mid-conversation.

import { turnsInFlight } from "../lib/gate";

export function handleHealth(): Response {
  const body = {
    ok: true,
    uptime: Math.round(process.uptime()),
    // Cheap way to tell "busy" from "wedged" in the Render logs without
    // attaching a debugger: this should return to 0 after every turn.
    turns_in_flight: turnsInFlight(),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
