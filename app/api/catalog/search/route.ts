// GET /api/catalog/search?q=…&limit=…
// Ported from backend/app/api/routes/catalog.py.

import { z } from "zod";
import { searchCatalog } from "@/lib/server/services/catalog";
import { jsonResponse, withErrorHandling } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const GET = withErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const { q, limit } = QuerySchema.parse({
    q: url.searchParams.get("q") ?? "",
    limit: url.searchParams.get("limit") ?? undefined,
  });
  const hits = await searchCatalog(q, limit);
  return jsonResponse(hits);
});
