// Catalog service — ingest + fuzzy search.
// Ported 1:1 from backend/app/services/catalog.py.
//
// Ingest is idempotent on `course_code` (upsert). Every row is embedded
// from title + description via services/embeddings. Search hits the
// pgvector RPC `match_catalog_courses` defined in db/schema.sql.

import { normalizeCourse } from "@/lib/server/data/catalog";
import { getSupabase } from "@/lib/server/supabase";
import {
  catalogEmbeddingText,
  embedMany,
  embedOne,
} from "@/lib/server/services/embeddings";

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

/**
 * Row shape we store in the `course_catalog` table (minus id / imported_at
 * / embedding, which the DB fills in). Exported so `normalizeRow` has a
 * well-known return type callers can plug into supabase-js typings.
 */
export interface NormalizedCatalogRow {
  course_code: string;
  title: string;
  description: string | null;
  credits: number | null | undefined;
  terms_offered: string[];
  prerequisites: string[];
  required_for_programs: string[];
  level: string | null | undefined;
}

function clientOrRaise() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new CatalogError(
      "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return supabase;
}

/**
 * Enforce the wire schema for a raw row (before it hits the DB). This
 * runs *after* zod validation — it's here to normalize course codes
 * and defend against non-string values sneaking through when callers
 * skip the zod layer (e.g. the ingest script's `--limit`).
 */
export function normalizeRow(row: Record<string, unknown>): NormalizedCatalogRow {
  const code = row.course_code;
  if (typeof code !== "string" || code.trim() === "") {
    throw new CatalogError("Each catalog row must include a non-empty course_code.");
  }
  const title = row.title;
  if (typeof title !== "string" || title.trim() === "") {
    throw new CatalogError(`Row ${code} must include a title.`);
  }

  const rawTerms = row.terms_offered ?? [];
  if (!Array.isArray(rawTerms)) {
    throw new CatalogError(`terms_offered for ${code} must be a list.`);
  }
  const rawPrereqs = Array.isArray(row.prerequisites) ? row.prerequisites : [];
  const rawPrograms = Array.isArray(row.required_for_programs)
    ? row.required_for_programs
    : [];
  const desc = typeof row.description === "string" ? row.description : null;

  return {
    course_code: normalizeCourse(code),
    title: title.trim(),
    description: desc ?? null,
    credits: (row.credits as number | null | undefined) ?? null,
    terms_offered: rawTerms.map((t) => String(t)),
    prerequisites: rawPrereqs.map((p) => normalizeCourse(String(p))),
    required_for_programs: rawPrograms.map((p) => String(p)),
    level: (row.level as string | null | undefined) ?? null,
  };
}

/** Embed + upsert a batch of catalog rows. Returns count + emitted codes. */
export async function upsertCatalog(rows: Iterable<Record<string, unknown>>): Promise<{
  count: number;
  course_codes: string[];
}> {
  const supabase = clientOrRaise();

  const normalized = Array.from(rows).map(normalizeRow);
  if (normalized.length === 0) {
    return { count: 0, course_codes: [] };
  }

  const texts = normalized.map((r) => catalogEmbeddingText(r.title, r.description));
  const vectors = await embedMany(texts);
  if (vectors.length !== normalized.length) {
    throw new CatalogError(
      `Embedding count mismatch (${vectors.length} vs ${normalized.length}).`,
    );
  }

  const payload = normalized.map((r, i) => ({ ...r, embedding: vectors[i] }));

  const { data, error } = await supabase
    .from("course_catalog")
    .upsert(payload, { onConflict: "course_code" })
    .select("course_code");
  if (error) {
    throw new CatalogError(`Upsert failed: ${error.message}`);
  }

  return {
    count: (data ?? []).length,
    course_codes: normalized.map((r) => r.course_code),
  };
}

/** Top-`limit` catalog rows most similar to `query`. */
export async function searchCatalog(query: string, limit = 5): Promise<Array<Record<string, unknown>>> {
  const supabase = clientOrRaise();
  if (!query.trim()) return [];

  const vector = await embedOne(query);
  const { data, error } = await supabase.rpc("match_catalog_courses", {
    query_embedding: vector,
    match_count: limit,
  });
  if (error) {
    throw new CatalogError(`Search RPC failed: ${error.message}`);
  }
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function getByCode(courseCode: string): Promise<Record<string, unknown> | null> {
  const supabase = clientOrRaise();
  const { data, error } = await supabase
    .from("course_catalog")
    .select(
      "id, course_code, title, description, credits, terms_offered, " +
        "prerequisites, required_for_programs, level, imported_at",
    )
    .eq("course_code", normalizeCourse(courseCode))
    .limit(1);
  if (error) {
    throw new CatalogError(`Lookup failed: ${error.message}`);
  }
  return data && data.length > 0 ? (data[0] as unknown as Record<string, unknown>) : null;
}
