// Where the API lives.
//
// The backend is a separate deployable (Render) because the Claude
// Agent SDK spawns a ~300 MB native subprocess that can't fit in a
// Vercel Function. So every request the browser makes is cross-origin,
// and it needs an absolute base URL.
//
// `NEXT_PUBLIC_` is required: this value is read in the browser, so it
// has to be inlined at build time. That also means it is public — never
// put a secret here.

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);

/**
 * Build a URL for an API path. An empty `API_BASE` yields a relative
 * URL, which keeps a same-origin setup (local dev via a rewrite, or a
 * future single-host deploy) working without a code change.
 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
