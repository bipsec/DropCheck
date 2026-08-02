// GET /api/conversations/{id} — conversation detail (turns with _reports stripped).
// Ported from backend/app/api/routes/query.py.

import { requireStudent } from "@/lib/server/cookies";
import { getConversation, QueryError } from "@/lib/server/services/queryRun";
import { errorResponse, jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const student = await requireStudent(req);
  const { id } = await ctx.params;
  try {
    const detail = await getConversation(student.id!, id);
    return jsonResponse(detail);
  } catch (err) {
    // Match FastAPI parity: not-found on this route returns 404.
    if (err instanceof QueryError) return errorResponse(404, err.message);
    throw err;
  }
});
