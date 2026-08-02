// Shared-secret gate for admin-only routes.
// Ported 1:1 from backend/app/services/admin.py.
//
// Not real auth — the header only exists to keep /api/catalog/upload
// from being posted to by random traffic. Rotate ADMIN_SECRET in .env.local
// to invalidate all clients.

import { getSettings } from "@/lib/server/config";
import { HttpError } from "@/lib/server/cookies";

export function requireAdmin(req: Request): void {
  const provided = req.headers.get("x-admin-secret");
  const expected = getSettings().admin_secret;
  if (!provided || provided !== expected) {
    throw new HttpError(401, "Missing or invalid x-admin-secret header.");
  }
}
