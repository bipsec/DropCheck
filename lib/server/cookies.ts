// Session cookie management + student-row ensure. Ported from
// backend/app/services/session.py.
//
// Two differences from the Python original worth calling out:
//
//   1. The Python side used itsdangerous.URLSafeSerializer (HMAC-SHA1
//      + base64url + JSON payload). We use HMAC-SHA256 here, so cookies
//      minted before the migration will invalidate exactly once and the
//      user gets a fresh session on first visit. The plan explicitly
//      approved this — cookie name stays `dropcheck_sid` so client-side
//      code doesn't change.
//
//   2. FastAPI's `Depends(require_student)` becomes a plain function
//      returning the student row (or throwing an `HttpError` the route
//      handler translates to a 401 Response).

import crypto from "node:crypto";
import { parseCookie, stringifySetCookie } from "cookie";
import { getSettings } from "@/lib/server/config";
import { getSupabase } from "@/lib/server/supabase";

export const COOKIE_NAME = "dropcheck_sid";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Error the route handlers convert to a proper HTTP Response. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// --- Signing ---------------------------------------------------------------

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function b64urlDecode(s: string): Buffer | null {
  try {
    return Buffer.from(s, "base64url");
  } catch {
    return null;
  }
}

function hmac(secret: string, payload: string): Buffer {
  return crypto.createHmac("sha256", secret).update(payload).digest();
}

/** Sign a session id → `<payload>.<sig>` string suitable for the cookie value. */
export function encodeSessionCookie(sessionId: string): string {
  const secret = getSettings().session_secret;
  const payload = b64url(Buffer.from(sessionId, "utf8"));
  const sig = b64url(hmac(secret, payload));
  return `${payload}.${sig}`;
}

/**
 * Verify + return the session id, or null on any signature mismatch.
 * Constant-time comparison guards against timing-based tampering.
 */
export function decodeSessionCookie(signed: string | null | undefined): string | null {
  if (!signed) return null;
  const parts = signed.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  const secret = getSettings().session_secret;
  const expected = hmac(secret, payload);
  const provided = b64urlDecode(sig);
  if (!provided || provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(expected, provided)) return null;

  const raw = b64urlDecode(payload);
  return raw ? raw.toString("utf8") : null;
}

function mintSessionId(): string {
  // 24 random bytes → 32-char base64url (matches Python's
  // secrets.token_urlsafe(24) output length).
  return b64url(crypto.randomBytes(24));
}

// --- Cookie header helpers -------------------------------------------------

/**
 * Read `dropcheck_sid` off a Request's Cookie header. Works with both a
 * `Request` and a raw cookie-header string.
 */
export function readSessionIdFromRequest(req: Request | string | null | undefined): string | null {
  const header =
    typeof req === "string" || req === null || req === undefined
      ? req ?? null
      : req.headers.get("cookie");
  if (!header) return null;
  const parsed = parseCookie(header);
  const raw = parsed[COOKIE_NAME];
  return decodeSessionCookie(raw ?? null);
}

/**
 * Build the `Set-Cookie` header value for a session id. Returned as the
 * *header value* (not just the raw cookie), so the caller can drop it
 * into `Response.headers.set("Set-Cookie", …)` directly.
 */
export function buildSessionSetCookie(sessionId: string): string {
  return stringifySetCookie({
    name: COOKIE_NAME,
    value: encodeSessionCookie(sessionId),
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    // secure=false so it works on http://localhost during dev. Next
    // itself will not upgrade this in production — set it via a
    // dedicated env flag if we ever deploy over HTTPS with a proxy.
    secure: false,
    path: "/",
  });
}

// --- Student ensure --------------------------------------------------------

export interface StudentRow {
  id: string | null;
  session_id: string;
  // extras from the students table land as unknowns; callers who need
  // specific columns cast at the call site.
  [key: string]: unknown;
}

/**
 * Ensure a students row exists for this session_id. Returns the row.
 * Falls back to a stub `{id: null, session_id, no_db: true}` when
 * Supabase isn't configured — mirrors the Python behavior so
 * healthz/session smoke tests can run offline.
 */
export async function ensureStudent(sessionId: string): Promise<StudentRow> {
  const supabase = getSupabase();
  if (!supabase) {
    return { id: null, session_id: sessionId, no_db: true };
  }

  const existing = await supabase
    .from("students")
    .select("*")
    .eq("session_id", sessionId)
    .limit(1);
  if (existing.error) {
    throw new HttpError(500, `Supabase select failed: ${existing.error.message}`);
  }
  if (existing.data && existing.data.length > 0) {
    return existing.data[0] as StudentRow;
  }

  const inserted = await supabase
    .from("students")
    .insert({ session_id: sessionId })
    .select("*");
  if (inserted.error || !inserted.data || inserted.data.length === 0) {
    throw new HttpError(
      500,
      inserted.error?.message ?? "Could not create student row.",
    );
  }
  return inserted.data[0] as StudentRow;
}

/**
 * For protected route handlers. Reads the session cookie, validates
 * the signature, and returns the students row. Throws `HttpError(401)`
 * if the cookie is missing / tampered — the caller converts that to a
 * 401 Response.
 */
export async function requireStudent(req: Request): Promise<StudentRow> {
  const sessionId = readSessionIdFromRequest(req);
  if (!sessionId) {
    throw new HttpError(401, "No session — call POST /api/session first.");
  }
  return await ensureStudent(sessionId);
}

/**
 * For POST /api/session: reuse the existing cookie's session id or
 * mint a fresh one. Returns the student row + a Set-Cookie header
 * value that the route handler attaches to its response.
 */
export async function resolveOrMintSession(req: Request): Promise<{
  student: StudentRow;
  setCookieHeader: string | null;
}> {
  const existing = readSessionIdFromRequest(req);
  if (existing) {
    const student = await ensureStudent(existing);
    return { student, setCookieHeader: null };
  }
  const fresh = mintSessionId();
  const student = await ensureStudent(fresh);
  return { student, setCookieHeader: buildSessionSetCookie(fresh) };
}
