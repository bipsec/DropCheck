// Ported from backend/tests/test_catalog.py.
//
// All 8 Python tests: 5 pure-schema/normalize tests plus 3 route-level
// tests (admin gate + 503-when-deps-missing).
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CatalogUploadIn } from "@/lib/server/schemas/catalog";
import { CatalogError, normalizeRow } from "@/lib/server/services/catalog";
import { _resetSettingsForTests } from "@/lib/server/config";
import { _resetSupabaseForTests } from "@/lib/server/supabase";
import { _resetEmbeddingsForTests } from "@/lib/server/services/embeddings";

const SAMPLE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "data",
  "sample_catalog.json",
);

describe("catalog schemas + normalize", () => {
  it("sample_catalog_parses_cleanly", () => {
    const body = JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));
    const parsed = CatalogUploadIn.parse(body);
    expect(parsed.courses.length).toBeGreaterThanOrEqual(19);
    const codes = new Set(parsed.courses.map((c) => c.course_code));
    // At least one CS + MATH course present, whatever the numbering scheme.
    expect([...codes].some((c) => c.startsWith("CS "))).toBe(true);
    expect([...codes].some((c) => c.startsWith("MATH "))).toBe(true);
  });

  it("rejects_missing_course_code", () => {
    expect(() =>
      CatalogUploadIn.parse({ courses: [{ title: "Nameless" }] }),
    ).toThrow();
  });

  it("rejects_unknown_field", () => {
    expect(() =>
      CatalogUploadIn.parse({
        courses: [{ course_code: "X 1", title: "T", surprise: 1 }],
      }),
    ).toThrow();
  });

  it("normalize_row_uppercases_and_collapses_whitespace", () => {
    const row = normalizeRow({
      course_code: " cs  201 ",
      title: "Data Structures",
      prerequisites: ["cs 101"],
    });
    expect(row.course_code).toBe("CS 201");
    expect(row.prerequisites).toEqual(["CS 101"]);
  });

  it("normalize_row_rejects_empty_title", () => {
    expect(() =>
      normalizeRow({ course_code: "CS 201", title: "   " }),
    ).toThrow(CatalogError);
  });
});

// --- Route-level tests -----------------------------------------------------

const originalEnv = {
  admin: process.env.ADMIN_SECRET,
  supabase: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  openai: process.env.OPENAI_API_KEY,
};

beforeEach(() => {
  process.env.ADMIN_SECRET = "test-admin-secret";
  _resetSettingsForTests();
});
afterEach(() => {
  process.env.ADMIN_SECRET = originalEnv.admin;
  process.env.SUPABASE_URL = originalEnv.supabase;
  process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.supabaseKey;
  process.env.OPENAI_API_KEY = originalEnv.openai;
  _resetSettingsForTests();
  _resetSupabaseForTests();
  _resetEmbeddingsForTests();
});

describe("catalog routes", () => {
  it("upload_requires_admin_secret", async () => {
    const { POST } = await import("@/app/api/catalog/upload/route");
    const req = new Request("http://localhost/api/catalog/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        courses: [{ course_code: "CS 201", title: "Data Structures" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("upload_with_bad_secret_rejected", async () => {
    const { POST } = await import("@/app/api/catalog/upload/route");
    const req = new Request("http://localhost/api/catalog/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": "wrong",
      },
      body: JSON.stringify({
        courses: [{ course_code: "CS 201", title: "Data Structures" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("search_returns_503_when_deps_missing", async () => {
    // Wipe both providers so the search path can't reach anyone.
    delete process.env.OPENAI_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    _resetSettingsForTests();
    _resetSupabaseForTests();
    _resetEmbeddingsForTests();

    const { GET } = await import("@/app/api/catalog/search/route");
    const res = await GET(
      new Request("http://localhost/api/catalog/search?q=databases"),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    const detail = String(body.detail);
    expect(
      /OPENAI_API_KEY|SUPABASE_URL|Supabase/.test(detail),
    ).toBe(true);
  });
});
