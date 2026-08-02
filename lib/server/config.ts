// Server-only env var access. Ported from backend/app/config.py.
//
// Next.js loads `.env.local` automatically for both the dev server and
// route handlers, and Vitest picks it up via `dotenv/config` (which
// Vite includes when running Node tests). We keep this file thin — no
// zod schema on the whole env — because the individual services already
// check whether their credentials exist and fail loudly if they don't.

export interface Settings {
  supabase_url: string | null;
  supabase_service_role_key: string | null;
  anthropic_api_key: string | null;
  openai_api_key: string | null;
  session_secret: string;
  admin_secret: string;
}

function readOptional(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : null;
}

function readOrDefault(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  cached = {
    supabase_url: readOptional("SUPABASE_URL"),
    supabase_service_role_key: readOptional("SUPABASE_SERVICE_ROLE_KEY"),
    anthropic_api_key: readOptional("ANTHROPIC_API_KEY"),
    openai_api_key: readOptional("OPENAI_API_KEY"),
    // Session cookie signer key. Keeping a fallback lets tests run without
    // an env var, but the fallback is deliberately weak so a production
    // deploy without `SESSION_SECRET` is obvious in logs.
    session_secret: readOrDefault("SESSION_SECRET", "dev-secret-change-me"),
    admin_secret: readOrDefault("ADMIN_SECRET", "dev-admin-change-me"),
  };
  return cached;
}

/** Test-only: forget the cached settings so a monkeypatched env var lands. */
export function _resetSettingsForTests(): void {
  cached = null;
}
