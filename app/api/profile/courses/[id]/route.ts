// PATCH  /api/profile/courses/{id} — edit a course row.
// DELETE /api/profile/courses/{id} — remove a course row.
// Ported from backend/app/api/routes/profile.py.

import { NextResponse } from "next/server";
import { CoursePatch } from "@/lib/server/schemas/profile";
import { deleteCourse, patchCourse, ProfileError } from "@/lib/server/services/profile";
import { requireStudent } from "@/lib/server/cookies";
import { errorResponse, jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const student = await requireStudent(req);
  const { id } = await ctx.params;
  const body = CoursePatch.parse(await req.json());
  try {
    const row = await patchCourse(student.id!, id, body);
    return jsonResponse(row);
  } catch (err) {
    // "course not found" is a 404, everything else lands in withErrorHandling.
    if (err instanceof ProfileError && err.message.includes("not found")) {
      return errorResponse(404, err.message);
    }
    throw err;
  }
});

export const DELETE = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const student = await requireStudent(req);
  const { id } = await ctx.params;
  await deleteCourse(student.id!, id);
  return new NextResponse(null, { status: 204 });
});
