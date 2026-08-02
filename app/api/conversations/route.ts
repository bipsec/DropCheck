// GET /api/conversations — list recent conversations for the caller.
// Ported from backend/app/api/routes/query.py.

import { requireStudent } from "@/lib/server/cookies";
import { listConversations } from "@/lib/server/services/queryRun";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: Request) => {
  const student = await requireStudent(req);
  const rows = await listConversations(student.id!);
  return jsonResponse(rows);
});
