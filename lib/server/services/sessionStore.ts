// Supabase read/write for `session_state`.
//
// One row per student — the SDK's `session_id` emitted on turn 1 is
// stored here so future turns pass `options.resume` and the agent
// picks up the accumulated conversation context (system prompt still
// re-sent every turn; the SDK dedupes cache boundaries).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/server/supabase";

export class SessionStoreError extends Error {
  constructor(message: string, public code: string = "session_store_error") {
    super(message);
    this.name = "SessionStoreError";
  }
}

function clientOrRaise(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) {
    throw new SessionStoreError(
      "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      "unavailable",
    );
  }
  return sb;
}

/** Read the persisted SDK session id for a student. Returns null on miss. */
export async function readSessionId(studentId: string): Promise<string | null> {
  const sb = clientOrRaise();
  const { data, error } = await sb
    .from("session_state")
    .select("sdk_session_id")
    .eq("student_id", studentId)
    .limit(1);
  if (error) {
    throw new SessionStoreError(
      `session_state lookup failed: ${error.message}`,
    );
  }
  if (!data || data.length === 0) return null;
  const row = data[0] as { sdk_session_id?: string };
  return row.sdk_session_id ?? null;
}

/**
 * Persist the SDK session id for a student. Idempotent — upsert on the
 * (student_id) primary key. Later phases may fork/rename the session;
 * this stays the canonical write path.
 */
export async function writeSessionId(
  studentId: string,
  sessionId: string,
): Promise<void> {
  const sb = clientOrRaise();
  const { error } = await sb.from("session_state").upsert(
    {
      student_id: studentId,
      sdk_session_id: sessionId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );
  if (error) {
    throw new SessionStoreError(
      `session_state upsert failed: ${error.message}`,
    );
  }
}

/** Drop the session row — used when the student resets their profile. */
export async function clearSessionId(studentId: string): Promise<void> {
  const sb = clientOrRaise();
  const { error } = await sb
    .from("session_state")
    .delete()
    .eq("student_id", studentId);
  if (error) {
    throw new SessionStoreError(
      `session_state delete failed: ${error.message}`,
    );
  }
}
