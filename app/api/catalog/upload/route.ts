// POST /api/catalog/upload — admin-only catalog ingest.
// Ported from backend/app/api/routes/catalog.py.

import { CatalogUploadIn } from "@/lib/server/schemas/catalog";
import { upsertCatalog } from "@/lib/server/services/catalog";
import { requireAdmin } from "@/lib/server/services/admin";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Ingesting a 500-row catalog + embeddings can take a minute or two.
export const maxDuration = 300;

export const POST = withErrorHandling(async (req: Request) => {
  requireAdmin(req);
  const body = CatalogUploadIn.parse(await req.json());
  const result = await upsertCatalog(body.courses);
  return jsonResponse(result);
});
