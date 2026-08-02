// Memoized Supabase service-role client. Ported from
// backend/app/db/client.py.
//
// Returns null when credentials are absent so the app can still boot in
// "no-DB" mode (e.g. running the pure-logic tests in CI). Every call
// site that needs Supabase throws its own descriptive error if this
// returns null, matching the Python behavior.
//
// The anon-key sniff is important: Supabase project owners sometimes
// paste the publishable ("sb_publishable_…" / "eyJ..." role=anon) key
// into SUPABASE_SERVICE_ROLE_KEY by mistake. The client itself accepts
// it, but every write fails with an RLS error at request time —
// hours-long debugging trap. Log a boot-time warning so the mismatch
// surfaces immediately.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "@/lib/server/config";

let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const settings = getSettings();
  if (!settings.supabase_url || !settings.supabase_service_role_key) {
    cached = null;
    return null;
  }

  const key = settings.supabase_service_role_key;
  if (key.startsWith("sb_publishable") || key.startsWith("sb_pub_")) {
    console.warn(
      "[dropcheck] SUPABASE_SERVICE_ROLE_KEY looks like a publishable/anon key. " +
        "Use the service_role key from Project Settings → API → service_role.",
    );
  }

  cached = createClient(settings.supabase_url, key, {
    auth: {
      // Server-only client — no user auth flow, no localStorage.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}

/** Test-only: drop the memoized client so a mocked env var takes effect. */
export function _resetSupabaseForTests(): void {
  cached = undefined;
}
