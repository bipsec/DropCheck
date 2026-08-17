// POST /api/session — mint or resolve the anonymous student session.
//
// Called once on chat-page mount by <SessionBootstrap>. Returns the
// student_id + session_id so the client can start talking. If a valid
// cookie already exists we reuse it (idempotent). If not, we mint a
// fresh HMAC-signed `dropcheck_sid` cookie + insert a Supabase
// `students` row.

import type { SessionResponse } from "@dropcheck/shared";
import { resolveOrMintSession } from "@/lib/server/cookies";

export async function handleSession(req: Request): Promise<Response> {
  try {
    const { student, setCookieHeader } = await resolveOrMintSession(req);
    const body: SessionResponse = {
      student_id: student.id,
      session_id: student.session_id,
      no_db: student.no_db === true,
    };
    const headers = new Headers({ "content-type": "application/json" });
    if (setCookieHeader) headers.set("set-cookie", setCookieHeader);
    return new Response(JSON.stringify(body), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "session_failed", detail: message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
