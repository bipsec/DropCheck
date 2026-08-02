/**
 * Typed client for the DropCheck API (Next.js route handlers under /api).
 *
 * Every call flows through `apiFetch()`, which:
 *   - sends `credentials: "include"` so the session cookie roundtrips
 *   - hits `/api/*` on the same origin — client- and server-side
 *   - raises `ApiError` with the `detail` field so callers can render it
 */

import type {
  CatalogSearchHit,
  ConversationDetail,
  ConversationSummary,
  CourseMatchOut,
  CourseRow,
  ProfileOut,
  QueryOut,
  SessionInfo,
  UploadResult,
} from "./api-types";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;
  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? (typeof detail === "string" ? detail : `HTTP ${status}`));
    this.status = status;
    this.detail = detail;
  }
}

type FetchOptions = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit | null;
};

function resolveUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  // Route handlers live under /api/*; single-origin app.
  return `/api${p}`;
}

async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  let body: BodyInit | null | undefined = opts.body;
  if (opts.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.json);
  }

  const res = await fetch(resolveUrl(path), {
    ...opts,
    headers,
    body,
    credentials: "include",
  });

  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    const message =
      detail && typeof detail === "object" && "detail" in detail
        ? String((detail as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, detail, message);
  }

  // 204 No Content — nothing to parse.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Session ---------------------------------------------------------------

export function createSession(): Promise<SessionInfo> {
  return apiFetch("/session", { method: "POST" });
}

// --- Catalog ---------------------------------------------------------------

export function searchCatalog(query: string, limit = 8): Promise<CatalogSearchHit[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiFetch(`/catalog/search?${params}`);
}

export function matchCourse(
  query: string,
  topK = 5
): Promise<CourseMatchOut> {
  return apiFetch("/catalog/match", {
    method: "POST",
    json: { query, top_k: topK },
  });
}

// --- Profile ---------------------------------------------------------------

export function getProfile(): Promise<ProfileOut> {
  return apiFetch("/profile");
}

export function patchProfile(patch: {
  student?: Partial<{
    name: string | null;
    program: string | null;
    major: string | null;
    expected_grad_semester: string | null;
    gpa: number | null;
    total_credits_completed: number | null;
    future_plan: string | null;
    preferences: Record<string, unknown> | null;
    international: boolean | null;
  }>;
  finance?: Partial<{
    tuition_per_term: number | null;
    current_aid_amount: number | null;
    aid_types: string[] | null;
    sap_status: "good" | "warning" | "probation" | null;
    employment_hours_week: number | null;
    dependent_status: "dependent" | "independent" | null;
    max_out_of_pocket: number | null;
  }>;
}): Promise<ProfileOut> {
  return apiFetch("/profile", { method: "PATCH", json: patch });
}

export function uploadTranscript(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch("/profile/upload", { method: "POST", body: form });
}

export function addCourse(body: {
  course_code: string;
  title?: string | null;
  grade?: string | null;
  credits?: number | null;
  semester?: string | null;
}): Promise<CourseRow> {
  return apiFetch("/profile/courses", { method: "POST", json: body });
}

export function patchCourse(
  id: string,
  patch: Partial<{
    course_code: string;
    title: string | null;
    grade: string | null;
    credits: number | null;
    semester: string | null;
    confirmed_by_student: boolean;
  }>
): Promise<CourseRow> {
  return apiFetch(`/profile/courses/${id}`, { method: "PATCH", json: patch });
}

export function deleteCourse(id: string): Promise<void> {
  return apiFetch(`/profile/courses/${id}`, { method: "DELETE" });
}

// --- Query -----------------------------------------------------------------

export function submitQuery(body: {
  course: string;
  question: string;
}): Promise<QueryOut> {
  return apiFetch("/query", { method: "POST", json: body });
}

export function submitFollowup(
  conversationId: string,
  question: string
): Promise<QueryOut> {
  return apiFetch(`/query/${conversationId}/followup`, {
    method: "POST",
    json: { question },
  });
}

export function listConversations(): Promise<ConversationSummary[]> {
  return apiFetch("/conversations");
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return apiFetch(`/conversations/${id}`);
}
