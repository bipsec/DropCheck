// POST /api/query — first-turn multi-agent pipeline.
// Ported from backend/app/api/routes/query.py.

import { QueryIn } from "@/lib/server/schemas/query";
import { requireStudent } from "@/lib/server/cookies";
import { runQuery } from "@/lib/server/services/queryRun";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Full agent pipeline can run 40-70s; give the route headroom.
export const maxDuration = 300;

export const POST = withErrorHandling(async (req: Request) => {
  const student = await requireStudent(req);
  const body = QueryIn.parse(await req.json());
  const result = await runQuery(student.id!, body.question, body.course);
  return jsonResponse(result);
});
