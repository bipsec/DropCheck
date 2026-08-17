// Server-only env var access. Ported from backend/app/config.py.
//
// Vitest picks up `.env.local` via `dotenv/config`, and `tsx` loads it
// through `--env-file` in the dev script; on Render they arrive as real
// env vars from render.yaml + the dashboard. We keep this file thin — no zod
// schema over the whole env — because the individual services already
// check whether their credentials exist and fail loudly if they don't.
//
// The one exception is `SESSION_SECRET`, which is validated here: it
// signs the session cookie, so a silent fallback in production would
// mean every deploy signs with a value published in this repo.

export interface Settings {
  supabase_url: string | null;
  supabase_service_role_key: string | null;
  anthropic_api_key: string | null;
  session_secret: string;
  admin_secret: string;
  /**
   * Exact browser origins allowed to call this API with credentials.
   * Never a wildcard — `Access-Control-Allow-Origin: *` is rejected by
   * browsers whenever `Access-Control-Allow-Credentials: true` is set,
   * which is exactly our cookie setup.
   */
  web_origins: string[];
  /**
   * Whether the frontend lives on a different origin than this API
   * (Vercel ↔ Render). Drives `SameSite=None; Secure; Partitioned`
   * on the session cookie.
   */
  cookie_cross_site: boolean;
  /**
   * How many chat turns may run at once on this instance. Each turn
   * spawns a ~300 MB `claude` subprocess, so this is an OOM guard, not a
   * throughput setting — see src/lib/gate.ts.
   */
  max_concurrent_turns: number;
}

function readOptional(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : null;
}

function readOrDefault(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function readBool(name: string, fallback: boolean): boolean {
  const v = readOptional(name);
  if (v === null) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/**
 * Positive integers only. A junk or non-positive value falls back to the
 * default rather than being honoured: `MAX_CONCURRENT_TURNS=0` would
 * make every chat request 503 forever, which is a worse outcome than
 * ignoring the typo.
 */
function readPositiveInt(name: string, fallback: number): number {
  const v = readOptional(name);
  if (v === null) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/**
 * `WEB_ORIGIN` accepts a comma-separated list so a single Render
 * service can serve production plus Vercel preview URLs. Origins are
 * normalised (no trailing slash) because the CORS check is an exact
 * string comparison against the browser's `Origin` header.
 */
function readOrigins(): string[] {
  const raw = readOptional("WEB_ORIGIN") ?? readOptional("WEB_ORIGINS");
  if (!raw) {
    // Dev default: the Next.js dev server.
    return isProduction() ? [] : ["http://localhost:3000"];
  }
  return raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o !== "");
}

function readSessionSecret(): string {
  const explicit = readOptional("SESSION_SECRET");
  if (explicit) return explicit;
  if (isProduction()) {
    // Fail the boot rather than sign cookies with a constant that is
    // committed to this repo — a forgeable session is worse than an
    // outage, and an outage is the only version of this you notice.
    throw new Error(
      "SESSION_SECRET is required when NODE_ENV=production. " +
        "render.yaml declares it with `generateValue: true`, so Render " +
        "mints one on first deploy — check the service's Environment tab.",
    );
  }
  return "dev-secret-change-me";
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  cached = {
    supabase_url: readOptional("SUPABASE_URL"),
    supabase_service_role_key: readOptional("SUPABASE_SERVICE_ROLE_KEY"),
    anthropic_api_key: readOptional("ANTHROPIC_API_KEY"),
    session_secret: readSessionSecret(),
    admin_secret: readOrDefault("ADMIN_SECRET", "dev-admin-change-me"),
    web_origins: readOrigins(),
    cookie_cross_site: readBool("COOKIE_CROSS_SITE", isProduction()),
    // Default 1: the safe floor for a 512 MB Render instance. Raise it
    // only together with the instance size.
    max_concurrent_turns: readPositiveInt("MAX_CONCURRENT_TURNS", 1),
  };
  return cached;
}

/** Test-only: forget the cached settings so a monkeypatched env var lands. */
export function _resetSettingsForTests(): void {
  cached = null;
}
