// CORS tests for the Hono app.
//
// The split puts the browser on one origin and this API on another, so
// CORS is now load-bearing auth infrastructure rather than a formality.
// Two properties must hold, and both fail silently in the browser rather
// than loudly on the server:
//
//   1. `Access-Control-Allow-Origin` must echo an *exact* origin. A `*`
//      is rejected by every browser when Allow-Credentials is true, so a
//      wildcard here would break the session for everyone.
//   2. An unknown origin must get no Allow-Origin header at all —
//      otherwise any site could spend Anthropic credits with a
//      logged-in student's cookie.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetSettingsForTests } from "@/lib/server/config";

// The Agent SDK is imported for real here (not mocked): importing it
// only resolves the module, and nothing in these tests calls `query()`,
// which is what would spawn the native CLI subprocess.

const ALLOWED = "https://dropcheck.vercel.app";
const ORIGINAL_ORIGIN = process.env.WEB_ORIGIN;

async function freshApp() {
  process.env.WEB_ORIGIN = `${ALLOWED},http://localhost:3000`;
  _resetSettingsForTests();
  // createApp reads settings at construction time, so build it after the
  // env is in place.
  const { createApp } = await import("@/src/server");
  return createApp();
}

function preflight(origin: string): Request {
  return new Request("http://localhost:8080/api/chat", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_ORIGIN === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = ORIGINAL_ORIGIN;
  _resetSettingsForTests();
});

describe("CORS", () => {
  it("test_preflight_echoes_exact_allowed_origin_never_wildcard", async () => {
    const app = await freshApp();
    const res = await app.request(preflight(ALLOWED));

    const allowOrigin = res.headers.get("access-control-allow-origin");
    expect(allowOrigin).toBe(ALLOWED);
    expect(allowOrigin).not.toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("test_preflight_allows_second_configured_origin", async () => {
    // WEB_ORIGIN takes a comma-separated list so one deploy can serve
    // production plus Vercel preview URLs.
    const app = await freshApp();
    const res = await app.request(preflight("http://localhost:3000"));
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("test_unknown_origin_gets_no_allow_origin_header", async () => {
    const app = await freshApp();
    const res = await app.request(preflight("https://evil.example"));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("test_health_route_is_reachable", async () => {
    const app = await freshApp();
    const res = await app.request("http://localhost:8080/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; uptime: number };
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe("number");
  });

  it("test_unknown_route_is_404", async () => {
    const app = await freshApp();
    const res = await app.request("http://localhost:8080/api/nope");
    expect(res.status).toBe(404);
  });
});
