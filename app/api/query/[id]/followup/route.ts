// POST /api/query/{id}/followup — router-classified follow-up.
// Ported from backend/app/api/routes/query.py.

import { FollowupIn } from "@/lib/server/schemas/query";
import { requireStudent } from "@/lib/server/cookies";
import { runFollowup } from "@/lib/server/services/queryRun";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const student = await requireStudent(req);
  const { id } = await ctx.params;
  const body = FollowupIn.parse(await req.json());
  const result = await runFollowup(student.id!, id, body.question);
  return jsonResponse(result);
});
