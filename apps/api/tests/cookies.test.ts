// Session-cookie attribute tests.
//
// These exist because the failure mode is invisible from the server's
// side: the API happily returns a `Set-Cookie` header, the response is
// 200, and the browser silently refuses to store or send the cookie. The
// student just gets a session that never persists. Asserting the exact
// attribute set is the only cheap way to catch it before a deploy.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSessionClearCookie,
  buildSessionSetCookie,
  COOKIE_NAME,
} from "@/lib/server/cookies";
import { _resetSettingsForTests } from "@/lib/server/config";

const ORIGINAL = process.env.COOKIE_CROSS_SITE;

function withCrossSite(value: string | undefined): void {
  if (value === undefined) delete process.env.COOKIE_CROSS_SITE;
  else process.env.COOKIE_CROSS_SITE = value;
  // Settings are cached after first read, so the flag only lands if we
  // clear the cache.
  _resetSettingsForTests();
}

/** Split a Set-Cookie header value into its lower-cased attribute names. */
function attrs(header: string): string[] {
  return header
    .split(";")
    .slice(1)
    .map((p) => p.trim().split("=")[0].toLowerCase());
}

function attrValue(header: string, name: string): string | null {
  for (const part of header.split(";").slice(1)) {
    const [k, v] = part.trim().split("=");
    if (k.toLowerCase() === name.toLowerCase()) return v ?? "";
  }
  return null;
}

beforeEach(() => {
  _resetSettingsForTests();
});

afterEach(() => {
  withCrossSite(ORIGINAL);
});

describe("session cookie attributes", () => {
  it("test_cross_site_cookie_is_none_secure_partitioned", () => {
    withCrossSite("true");
    const header = buildSessionSetCookie("sid-abc");

    expect(header.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    // SameSite=None is what lets Vercel → Render send the cookie at
    // all; Secure is mandatory alongside it or the browser drops the
    // Set-Cookie entirely; Partitioned (CHIPS) keeps Chrome working past
    // third-party-cookie deprecation.
    expect(attrValue(header, "samesite")).toBe("None");
    expect(attrs(header)).toContain("secure");
    expect(attrs(header)).toContain("partitioned");
    expect(attrs(header)).toContain("httponly");
  });

  it("test_dev_cookie_is_lax_and_not_secure", () => {
    withCrossSite("false");
    const header = buildSessionSetCookie("sid-abc");

    // Dev serves both apps over http://localhost, where a Secure cookie
    // is fine but SameSite=None+Secure buys nothing — and same-site Lax
    // is what actually works if anyone runs the API over plain HTTP on a
    // LAN IP.
    expect(attrValue(header, "samesite")).toBe("Lax");
    expect(attrs(header)).not.toContain("secure");
    expect(attrs(header)).not.toContain("partitioned");
    expect(attrs(header)).toContain("httponly");
  });

  it("test_clear_cookie_matches_set_cookie_attributes", () => {
    withCrossSite("true");
    const set = buildSessionSetCookie("sid-abc");
    const clear = buildSessionClearCookie();

    // A browser keys a cookie on more than its name: if Secure /
    // SameSite / Partitioned differ, the "clear" writes a *second*
    // cookie instead of removing the first, and the stale session
    // survives. Keep these attribute sets identical.
    expect(attrs(clear).sort()).toEqual(
      attrs(set)
        .filter((a) => a !== "max-age")
        .concat("max-age")
        .sort(),
    );
    expect(attrValue(clear, "max-age")).toBe("0");
  });

  it("test_cross_site_defaults_to_production", () => {
    // Unset flag → derive from NODE_ENV, so a production deploy can't
    // ship a Lax cookie just because someone forgot an env var.
    withCrossSite(undefined);
    const before = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      // SESSION_SECRET must exist or getSettings() throws by design.
      process.env.SESSION_SECRET ??= "test-secret";
      _resetSettingsForTests();
      expect(attrValue(buildSessionSetCookie("s"), "samesite")).toBe("None");
    } finally {
      process.env.NODE_ENV = before;
      _resetSettingsForTests();
    }
  });
});
