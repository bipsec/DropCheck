// Thin client for api.purdue.io/odata. Ported from temp/data_API.py.
//
// Two calls of interest:
//   - listSubjectCourses(abbr) — bulk, no $expand. Feeds `search_courses`.
//   - fetchCourseDetail(abbr, number) — expensive, resolves historical
//                                        term names via `$expand=Classes`.
//                                        Feeds `get_course` + `get_term_offerings`.
//
// Every call:
//   - Uses AbortController with a 15s timeout (per-request cap).
//   - Returns `{ error, detail }` on non-2xx / network / timeout — never
//     throws. That's how we contain the plan's "external API can fail /
//     rate-limit / go down independently" concern in-process.

import { normalizeCourse, type Term } from "@/lib/server/data/catalog";

export const PURDUE_BASE = "https://api.purdue.io/odata";
const DEFAULT_TIMEOUT_MS = 15_000;

// --- Normalized shape shared with course_cache -----------------------------

export interface PurdueCourseNormalized {
  course_code: string; // "CS 18000"
  subject: string; // "CS"
  number: string; // "18000"
  title: string;
  credits: number | null;
  description: string;
  prerequisites_hint: string[];
  prerequisites_confidence: "low_unstructured_hint";
  terms_seen_historically: string[]; // ["Fall 2024", ...] — from $expand
  source: "purdue_io_odata";
  source_course_id: string | null;
}

export type PurdueError = {
  error: string;
  detail: string;
};

export type PurdueResult<T> = T | PurdueError;

export function isPurdueError<T>(v: PurdueResult<T>): v is PurdueError {
  return typeof v === "object" && v !== null && "error" in v && "detail" in v;
}

// --- HTTP helpers ---------------------------------------------------------

async function purdueGet<T>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PurdueResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return {
        error: res.status === 404 ? "not_found" : "unavailable",
        detail: `purdue.io returned HTTP ${res.status} for ${url}`,
      };
    }
    return (await res.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: /aborted/i.test(message) ? "timeout" : "unavailable",
      detail: `purdue.io fetch failed: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- Terms map (cached in-memory) -----------------------------------------

let termsMap: Map<string, string> | null = null;

/** Load the TermId → human name mapping. Cached indefinitely. */
export async function loadTermsMap(): Promise<
  PurdueResult<Map<string, string>>
> {
  if (termsMap) return termsMap;
  const res = await purdueGet<{ value: Array<{ Id: string; Name?: string }> }>(
    `${PURDUE_BASE}/Terms`,
  );
  if (isPurdueError(res)) return res;
  const m = new Map<string, string>();
  for (const t of res.value ?? []) m.set(t.Id, t.Name ?? t.Id);
  termsMap = m;
  return m;
}

export function _resetTermsCacheForTests(): void {
  termsMap = null;
}

// --- Normalization -------------------------------------------------------

/**
 * Regex-scrape of course codes from a free-text description. LOW
 * CONFIDENCE — the rules engine never trusts this as prereq ground
 * truth. Matches temp/data_API.py's approach.
 */
export function extractPrereqHints(description: string | null | undefined): string[] {
  if (!description) return [];
  const hits = new Set<string>();
  const re = /\b([A-Z]{2,5})\s?-?\s?(\d{3,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    const num = Number(m[2]);
    // Loose guard against room numbers etc.
    if (num >= 100 && num <= 99999) {
      hits.add(`${m[1]} ${m[2]}`);
    }
  }
  return [...hits].sort();
}

interface RawCourse {
  Id?: string;
  Number?: string;
  Title?: string;
  CreditHours?: number | null;
  Description?: string | null;
  Classes?: Array<{ TermId?: string }>;
}

function normalizeRawCourse(
  subject: string,
  raw: RawCourse,
  termNames: string[] = [],
): PurdueCourseNormalized {
  const number = String(raw.Number ?? "");
  return {
    course_code: `${subject} ${number}`,
    subject,
    number,
    title: String(raw.Title ?? ""),
    credits: raw.CreditHours ?? null,
    description: raw.Description ?? "",
    prerequisites_hint: extractPrereqHints(raw.Description ?? ""),
    prerequisites_confidence: "low_unstructured_hint",
    terms_seen_historically: [...termNames].sort(),
    source: "purdue_io_odata",
    source_course_id: raw.Id ?? null,
  };
}

// --- Bulk listing ---------------------------------------------------------

/**
 * Fetch every course in a subject (e.g. "CS"). Collapses duplicate rows
 * (Purdue returns one per cross-listed title) to the row with the
 * longest description. Matches temp/data_API.py::search_courses.
 */
export async function listSubjectCourses(
  subjectAbbr: string,
  timeoutMs?: number,
): Promise<PurdueResult<PurdueCourseNormalized[]>> {
  const abbr = subjectAbbr.trim().toUpperCase();
  if (!abbr) return { error: "invalid_input", detail: "subject was empty." };

  const url =
    `${PURDUE_BASE}/Courses` +
    `?$filter=${encodeURIComponent(`Subject/Abbreviation eq '${abbr}'`)}` +
    `&$orderby=Number asc`;
  const res = await purdueGet<{ value: RawCourse[] }>(url, timeoutMs);
  if (isPurdueError(res)) return res;

  const byNumber = new Map<string, RawCourse>();
  for (const c of res.value ?? []) {
    const num = String(c.Number ?? "");
    if (!num) continue;
    const cur = byNumber.get(num);
    if (
      !cur ||
      (c.Description ?? "").length > (cur.Description ?? "").length
    ) {
      byNumber.set(num, c);
    }
  }
  return [...byNumber.values()].map((c) => normalizeRawCourse(abbr, c));
}

// --- Single-course detail (with historical term expansion) -----------------

export async function fetchCourseDetail(
  subjectAbbr: string,
  number: string,
  timeoutMs?: number,
): Promise<PurdueResult<PurdueCourseNormalized>> {
  const abbr = subjectAbbr.trim().toUpperCase();
  const num = String(number).trim();
  if (!abbr || !num) {
    return {
      error: "invalid_input",
      detail: `Missing subject or number: ${JSON.stringify(subjectAbbr)} ${JSON.stringify(number)}.`,
    };
  }
  const filter = `Subject/Abbreviation eq '${abbr}' and Number eq '${num}'`;
  const url =
    `${PURDUE_BASE}/Courses` +
    `?$expand=Classes&$filter=${encodeURIComponent(filter)}`;
  const res = await purdueGet<{ value: RawCourse[] }>(url, timeoutMs);
  if (isPurdueError(res)) return res;
  const rows = res.value ?? [];
  if (rows.length === 0) {
    return {
      error: "not_found",
      detail: `Course ${abbr} ${num} not found in Purdue catalog.`,
    };
  }
  const raw = rows[0];

  // Resolve TermIds → names via the Terms table.
  const terms = await loadTermsMap();
  const termNames = new Set<string>();
  if (!isPurdueError(terms)) {
    for (const cls of raw.Classes ?? []) {
      const name = terms.get(cls.TermId ?? "");
      if (name) termNames.add(name);
    }
  }
  return normalizeRawCourse(abbr, raw, [...termNames]);
}

// --- Season aggregation ---------------------------------------------------
// Map "Fall 2024" / "Spring 2025" etc. into the four-value Season enum
// used by `Course.terms_offered`. Deduplicated + sorted.

export function seasonsFromHistoricalTerms(
  termNames: readonly string[],
): Term[] {
  const seen = new Set<Term>();
  for (const t of termNames) {
    const lower = t.toLowerCase();
    if (lower.startsWith("fall")) seen.add("Fall");
    else if (lower.startsWith("spring")) seen.add("Spring");
    else if (lower.startsWith("summer")) seen.add("Summer");
  }
  const order: Term[] = ["Fall", "Spring", "Summer"];
  return order.filter((s) => seen.has(s));
}

// --- Course code parsing --------------------------------------------------

/** Split a normalized course code into [subject, number]. */
export function splitCourseCode(code: string): { subject: string; number: string } | null {
  const target = normalizeCourse(code);
  const m = target.match(/^([A-Z]{2,5})\s?(\d{2,5}[A-Z]?)$/);
  if (!m) return null;
  return { subject: m[1], number: m[2] };
}
