// POST /api/profile/courses — manual add.
// Ported from backend/app/api/routes/profile.py.

import { CourseIn } from "@/lib/server/schemas/profile";
import { addCourse } from "@/lib/server/services/profile";
import { requireStudent } from "@/lib/server/cookies";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: Request) => {
  const student = await requireStudent(req);
  const body = CourseIn.parse(await req.json());
  const row = await addCourse(student.id!, body);
  return jsonResponse(row);
});
