// POST /api/session — mints or reuses the anonymous dropcheck_sid cookie
// and ensures a `students` row exists for it. Mirrors the Python
// backend/app/api/routes/session.py behavior 1:1.

import { resolveOrMintSession } from "@/lib/server/cookies";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: Request) => {
  const { student, setCookieHeader } = await resolveOrMintSession(req);
  const body = {
    student_id: student.id,
    session_id: student.session_id,
    no_db: student.no_db === true,
  };
  const headers = setCookieHeader ? { "set-cookie": setCookieHeader } : undefined;
  return jsonResponse(body, 200, headers);
});
