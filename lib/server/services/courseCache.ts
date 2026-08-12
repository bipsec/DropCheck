// Supabase `course_cache` read/write helpers.
//
// Cache TTL is one term (~90 days). Every read decides "cache hit" vs
// "stale — refetch" using `fetched_at`. The MCP tool composes these
// with `purdueClient` calls to implement cache-through semantics.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PurdueCourseNormalized } from "@/lib/server/services/purdueClient";
import { getSupabase } from "@/lib/server/supabase";
import { normalizeCourse } from "@/lib/server/data/catalog";

const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function clientOrNull(): SupabaseClient | null {
  return getSupabase();
}

export function isFresh(fetchedAt: string | null | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return false;
  const parsed = Date.parse(fetchedAt);
  if (!Number.isFinite(parsed)) return false;
  return now - parsed < CACHE_TTL_MS;
}

export interface CacheHit {
  course: PurdueCourseNormalized;
  fetched_at: string;
  fresh: boolean;
}

/**
 * Read one course from cache. Returns null on cache miss, an error
 * marker on Supabase failure (the caller falls through to a live
 * fetch), or a `CacheHit` on success.
 */
export async function readCached(courseCode: string): Promise<CacheHit | null> {
  const sb = clientOrNull();
  if (!sb) return null;

  const code = normalizeCourse(courseCode);
  const { data, error } = await sb
    .from("course_cache")
    .select("*")
    .eq("course_code", code)
    .limit(1);
  if (error || !data || data.length === 0) return null;

  const row = data[0] as Record<string, unknown>;
  return {
    course: rowToCourse(row),
    fetched_at: String(row.fetched_at ?? ""),
    fresh: isFresh(row.fetched_at as string | null | undefined),
  };
}

/** Bulk read all cached rows for a subject. */
export async function readSubjectCached(subject: string): Promise<PurdueCourseNormalized[]> {
  const sb = clientOrNull();
  if (!sb) return [];
  const abbr = subject.trim().toUpperCase();
  const { data, error } = await sb
    .from("course_cache")
    .select("*")
    .eq("subject", abbr);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(rowToCourse);
}

/**
 * Write-through: upsert a normalized course + refresh `fetched_at`.
 * onConflict on the `course_code` primary key.
 */
export async function writeCache(course: PurdueCourseNormalized): Promise<void> {
  const sb = clientOrNull();
  if (!sb) return;
  const row = {
    course_code: course.course_code,
    subject: course.subject,
    number: course.number,
    title: course.title,
    credits: course.credits,
    description: course.description,
    prerequisites_hint: course.prerequisites_hint,
    prerequisites_confidence: course.prerequisites_confidence,
    terms_seen_historically: course.terms_seen_historically,
    source: course.source,
    source_course_id: course.source_course_id,
    fetched_at: new Date().toISOString(),
  };
  await sb.from("course_cache").upsert(row, { onConflict: "course_code" });
}

/** Bulk write — used by the ingest script. */
export async function writeCacheBatch(courses: PurdueCourseNormalized[]): Promise<void> {
  const sb = clientOrNull();
  if (!sb || courses.length === 0) return;
  const now = new Date().toISOString();
  const rows = courses.map((c) => ({
    course_code: c.course_code,
    subject: c.subject,
    number: c.number,
    title: c.title,
    credits: c.credits,
    description: c.description,
    prerequisites_hint: c.prerequisites_hint,
    prerequisites_confidence: c.prerequisites_confidence,
    terms_seen_historically: c.terms_seen_historically,
    source: c.source,
    source_course_id: c.source_course_id,
    fetched_at: now,
  }));
  await sb.from("course_cache").upsert(rows, { onConflict: "course_code" });
}

function rowToCourse(row: Record<string, unknown>): PurdueCourseNormalized {
  return {
    course_code: String(row.course_code ?? ""),
    subject: String(row.subject ?? ""),
    number: String(row.number ?? ""),
    title: String(row.title ?? ""),
    credits:
      row.credits === null || row.credits === undefined
        ? null
        : Number(row.credits),
    description: String(row.description ?? ""),
    prerequisites_hint: (row.prerequisites_hint as string[] | null) ?? [],
    prerequisites_confidence: "low_unstructured_hint",
    terms_seen_historically:
      (row.terms_seen_historically as string[] | null) ?? [],
    source: "purdue_io_odata",
    source_course_id: (row.source_course_id as string | null) ?? null,
  };
}
