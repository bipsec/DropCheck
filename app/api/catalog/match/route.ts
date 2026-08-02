// POST /api/catalog/match — matcher pipeline (embedding + LLM disambiguation).
// Ported from backend/app/api/routes/catalog.py.

import { CourseMatchIn } from "@/lib/server/schemas/matcher";
import { matchCourse } from "@/lib/server/agents/courseMatcher";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// LLM disambiguation can add up to ~5s; give the handler headroom.
export const maxDuration = 60;

export const POST = withErrorHandling(async (req: Request) => {
  const body = CourseMatchIn.parse(await req.json());
  const result = await matchCourse(body.query, body.top_k);
  return jsonResponse(result);
});
