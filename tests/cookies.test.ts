// Session cookie signer tests.
// Not a Python port — this is a Node-side invariant that didn't have a
// direct Python analog (itsdangerous was assumed correct upstream). The
// hand-rolled HMAC-SHA256 signer needs its own coverage.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COOKIE_NAME,
  buildSessionSetCookie,
  decodeSessionCookie,
  encodeSessionCookie,
  readSessionIdFromRequest,
} from "@/lib/server/cookies";
import { _resetSettingsForTests } from "@/lib/server/config";

const originalSecret = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-abc";
  _resetSettingsForTests();
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
  _resetSettingsForTests();
});

describe("session cookie signer", () => {
  it("round_trips_a_session_id", () => {
    const sid = "abc123DEF-_";
    const encoded = encodeSessionCookie(sid);
    expect(decodeSessionCookie(encoded)).toBe(sid);
  });

  it("null_input_returns_null", () => {
    expect(decodeSessionCookie(null)).toBeNull();
    expect(decodeSessionCookie(undefined)).toBeNull();
    expect(decodeSessionCookie("")).toBeNull();
  });

  it("rejects_unsigned_payload", () => {
    // Raw session id without the ".sig" suffix.
    expect(decodeSessionCookie("abc123")).toBeNull();
  });

  it("rejects_tampered_signature", () => {
    const encoded = encodeSessionCookie("hello");
    const [payload, sig] = encoded.split(".");
    // Flip a byte in the signature.
    const bad =
      payload + "." + sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(decodeSessionCookie(bad)).toBeNull();
  });

  it("rejects_tampered_payload", () => {
    const encoded = encodeSessionCookie("hello");
    const [payload, sig] = encoded.split(".");
    // Splice in a completely different payload but keep the original sig.
    const other = Buffer.from("world", "utf8").toString("base64url");
    expect(decodeSessionCookie(`${other}.${sig}`)).toBeNull();
    // And empty-payload cases.
    expect(decodeSessionCookie(`.${sig}`)).toBeNull();
    // Preserve payload variable to satisfy noUnusedLocals.
    expect(payload).not.toBe(other);
  });

  it("rejects_signature_from_different_secret", () => {
    const encoded = encodeSessionCookie("hello");
    process.env.SESSION_SECRET = "different-secret";
    _resetSettingsForTests();
    expect(decodeSessionCookie(encoded)).toBeNull();
  });

  it("read_session_id_from_request_parses_cookie_header", () => {
    const encoded = encodeSessionCookie("via-request");
    const req = new Request("http://localhost/x", {
      headers: { cookie: `foo=bar; ${COOKIE_NAME}=${encoded}; baz=qux` },
    });
    expect(readSessionIdFromRequest(req)).toBe("via-request");
  });

  it("read_session_id_returns_null_when_cookie_missing", () => {
    const req = new Request("http://localhost/x", {
      headers: { cookie: "other=value" },
    });
    expect(readSessionIdFromRequest(req)).toBeNull();

    const req2 = new Request("http://localhost/x");
    expect(readSessionIdFromRequest(req2)).toBeNull();
  });

  it("build_session_set_cookie_produces_valid_header", () => {
    const header = buildSessionSetCookie("some-sid");
    expect(header).toContain(`${COOKIE_NAME}=`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
  });
});
