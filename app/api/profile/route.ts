// GET /api/profile   — read profile + completeness
// PATCH /api/profile — update student and/or finance fields
// Ported from backend/app/api/routes/profile.py.

import { ProfilePatchIn } from "@/lib/server/schemas/profile";
import { getProfile, patchStudent, upsertFinance } from "@/lib/server/services/profile";
import { requireStudent } from "@/lib/server/cookies";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: Request) => {
  const student = await requireStudent(req);
  const bundle = await getProfile(student.id!);
  return jsonResponse(bundle);
});

export const PATCH = withErrorHandling(async (req: Request) => {
  const student = await requireStudent(req);
  const body = ProfilePatchIn.parse(await req.json());
  if (body.student) await patchStudent(student.id!, body.student);
  if (body.finance) await upsertFinance(student.id!, body.finance);
  return jsonResponse(await getProfile(student.id!));
});
