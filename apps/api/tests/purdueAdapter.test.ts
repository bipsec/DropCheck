// Tests for the university-catalog MCP tools + the Purdue.io client.
//
// `fetch` is stubbed with a canned response registry — no live network.
// Supabase is stubbed too so cache reads/writes are inspectable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetTermsCacheForTests,
  extractPrereqHints,
  isPurdueError,
  seasonsFromHistoricalTerms,
  splitCourseCode,
} from "@/lib/server/services/purdueClient";

// --- Fake fetch registry --------------------------------------------------

type FakeResponse = {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
};

let responseRoutes: Array<[RegExp, () => FakeResponse | Promise<FakeResponse>]> = [];
let fetchCalls: string[] = [];

function stubFetch() {
  const originalFetch = global.fetch;
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    for (const [re, fn] of responseRoutes) {
      if (re.test(url)) {
        const r = await fn();
        return {
          ok: r.ok,
          status: r.status,
          json: async () => (r.json ? await r.json() : {}),
        } as unknown as Response;
      }
    }
    // Unknown route — treat as 404.
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response;
  }) as unknown as typeof global.fetch;
  return () => {
    global.fetch = originalFetch;
  };
}

function route(pattern: RegExp, response: () => FakeResponse | Promise<FakeResponse>) {
  responseRoutes.push([pattern, response]);
}

// --- Fake Supabase --------------------------------------------------------

type Row = Record<string, unknown>;

class FakeQuery {
  private table: string;
  private db: FakeDB;
  private filters: Array<[string, unknown]> = [];
  private limitN: number | null = null;
  private pending:
    | { kind: "select" }
    | { kind: "upsert"; rows: Row[] }
    | null = null;

  constructor(table: string, db: FakeDB) {
    this.table = table;
    this.db = db;
  }
  select() {
    if (this.pending == null) this.pending = { kind: "select" };
    return this;
  }
  eq(field: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  upsert(rows: Row | Row[], _opts?: { onConflict?: string }) {
    this.pending = { kind: "upsert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  private execute(): { data: Row[]; error: null } {
    const store = this.db.tables[this.table] ?? [];
    if (this.pending?.kind === "upsert") {
      const key = "course_code";
      const kept = store.filter(
        (r) => !this.pending!.kind || this.pending!.kind !== "upsert"
          || !(this.pending as { rows: Row[] }).rows.some((n) => r[key] === n[key]),
      );
      this.db.tables[this.table] = [...kept, ...(this.pending as { rows: Row[] }).rows];
      return { data: (this.pending as { rows: Row[] }).rows, error: null };
    }
    let filtered = store.filter((r) =>
      this.filters.every(([k, v]) => r[k] === v),
    );
    if (this.limitN !== null) filtered = filtered.slice(0, this.limitN);
    return { data: filtered, error: null };
  }
  then<T>(onFulfilled: (v: { data: Row[]; error: null }) => T): Promise<T> {
    return Promise.resolve(onFulfilled(this.execute()));
  }
}

class FakeDB {
  tables: Record<string, Row[]> = {};
  constructor(initial: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(initial)) {
      this.tables[k] = v.map((r) => ({ ...r }));
    }
  }
  from(name: string): FakeQuery {
    return new FakeQuery(name, this);
  }
}

let fakeDb: FakeDB;
vi.mock("@/lib/server/supabase", async () => {
  const original = await import("@/lib/server/supabase");
  return {
    ...original,
    getSupabase: vi.fn(() => fakeDb),
  };
});

import { invokePurdueCatalogTool } from "@/lib/server/mcp/purdueCatalog";

// --- Setup ---------------------------------------------------------------

let restoreFetch: () => void;

beforeEach(() => {
  responseRoutes = [];
  fetchCalls = [];
  fakeDb = new FakeDB({});
  _resetTermsCacheForTests();
  restoreFetch = stubFetch();
});

afterEach(() => {
  restoreFetch();
});

function structured<T>(res: { structuredContent?: Record<string, unknown> }): T {
  return res.structuredContent as T;
}

// --- Pure helpers --------------------------------------------------------

describe("purdueClient helpers", () => {
  it("test_extract_prereq_hints_scrapes_codes", () => {
    const hints = extractPrereqHints(
      "Requires a grade of C or better in CS 18000 and MATH 165.",
    );
    expect(hints).toEqual(["CS 18000", "MATH 165"]);
  });

  it("test_extract_prereq_hints_empty_on_no_match", () => {
    expect(extractPrereqHints("")).toEqual([]);
    expect(extractPrereqHints("free-form prose")).toEqual([]);
  });

  it("test_seasons_from_historical_terms_dedupes", () => {
    expect(
      seasonsFromHistoricalTerms([
        "Fall 2024",
        "Spring 2025",
        "Fall 2025",
        "Summer 2024",
      ]),
    ).toEqual(["Fall", "Spring", "Summer"]);
  });

  it("test_split_course_code_handles_normal_and_edge_forms", () => {
    expect(splitCourseCode("CS 18000")).toEqual({ subject: "CS", number: "18000" });
    expect(splitCourseCode("cs18000")).toEqual({ subject: "CS", number: "18000" });
    expect(splitCourseCode("garbage")).toBeNull();
  });
});

// --- Tool: get_course ----------------------------------------------------

describe("get_course tool", () => {
  it("test_get_course_hits_purdue_on_cache_miss_and_writes_through", async () => {
    route(/\/Terms/, () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          { Id: "T1", Name: "Fall 2024" },
          { Id: "T2", Name: "Spring 2025" },
        ],
      }),
    }));
    route(/Courses\?\$expand=Classes/, () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          {
            Id: "abc",
            Number: "18000",
            Title: "Problem Solving and Object-Oriented Programming",
            CreditHours: 4,
            Description: "Introductory CS. Requires MATH 165.",
            Classes: [{ TermId: "T1" }, { TermId: "T2" }],
          },
        ],
      }),
    }));

    const res = await invokePurdueCatalogTool("get_course", {
      course_code: "CS 18000",
    });
    expect(res.isError).toBeFalsy();
    const out = structured<{
      course_code: string;
      credits: number;
      terms_seen_historically: string[];
      prerequisites_hint: string[];
      prerequisites_confidence: string;
      cache: string;
    }>(res);
    expect(out.course_code).toBe("CS 18000");
    expect(out.credits).toBe(4);
    expect(out.terms_seen_historically.sort()).toEqual(["Fall 2024", "Spring 2025"]);
    expect(out.prerequisites_hint).toContain("MATH 165");
    expect(out.cache).toBe("miss");

    // Written through — a second call must hit cache without a fetch.
    const before = fetchCalls.length;
    const second = await invokePurdueCatalogTool("get_course", {
      course_code: "CS 18000",
    });
    expect(second.isError).toBeFalsy();
    expect(structured<{ cache: string }>(second).cache).toBe("hit");
    expect(fetchCalls.length).toBe(before); // no new fetch
  });

  it("test_prerequisites_hint_carries_low_confidence_marker", async () => {
    route(/\/Terms/, () => ({ ok: true, status: 200, json: async () => ({ value: [] }) }));
    route(/Courses\?\$expand=Classes/, () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          {
            Id: "abc",
            Number: "18000",
            Title: "X",
            CreditHours: 3,
            Description: "Requires CS 15900.",
            Classes: [],
          },
        ],
      }),
    }));
    const res = await invokePurdueCatalogTool("get_course", {
      course_code: "CS 18000",
    });
    const out = structured<{ prerequisites_confidence: string }>(res);
    expect(out.prerequisites_confidence).toBe("low_unstructured_hint");
  });

  it("test_get_course_returns_structured_error_on_404", async () => {
    route(/\/Terms/, () => ({ ok: true, status: 200, json: async () => ({ value: [] }) }));
    route(/Courses\?\$expand=Classes/, () => ({
      ok: true,
      status: 200,
      json: async () => ({ value: [] }),
    }));
    const res = await invokePurdueCatalogTool("get_course", {
      course_code: "CS 99999",
    });
    expect(res.isError).toBe(true);
    const out = structured<{ error: string }>(res);
    expect(out.error).toBe("not_found");
  });

  it("test_get_course_returns_structured_error_when_purdue_is_down", async () => {
    route(/Courses/, () => ({ ok: false, status: 503 }));
    const res = await invokePurdueCatalogTool("get_course", {
      course_code: "CS 18000",
    });
    expect(res.isError).toBe(true);
    const out = structured<{ error: string; detail: string }>(res);
    expect(out.error).toBe("unavailable");
    expect(out.detail).toMatch(/HTTP 503/);
  });

  it("test_get_course_rejects_unparseable_code", async () => {
    const res = await invokePurdueCatalogTool("get_course", {
      course_code: "nonsense",
    });
    expect(res.isError).toBe(true);
    const out = structured<{ error: string }>(res);
    expect(out.error).toBe("invalid_input");
  });
});

// --- Tool: search_courses ------------------------------------------------

describe("search_courses tool", () => {
  it("test_search_courses_cs_hits_cache_on_second_call", async () => {
    // First call: cache empty, hit Purdue.
    route(/Courses\?\$filter=/, () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          {
            Id: "a",
            Number: "18000",
            Title: "CS Intro",
            CreditHours: 4,
            Description: "",
          },
          {
            Id: "b",
            Number: "25000",
            Title: "Systems",
            CreditHours: 4,
            Description: "",
          },
        ],
      }),
    }));

    const first = await invokePurdueCatalogTool("search_courses", { query: "CS" });
    expect(first.isError).toBeFalsy();
    const out1 = structured<{
      source: string;
      courses: Array<{ course_code: string }>;
    }>(first);
    expect(out1.source).toBe("purdue_io_odata");
    expect(out1.courses.map((c) => c.course_code).sort()).toEqual([
      "CS 18000",
      "CS 25000",
    ]);

    const before = fetchCalls.length;
    const second = await invokePurdueCatalogTool("search_courses", { query: "CS" });
    const out2 = structured<{ source: string }>(second);
    expect(out2.source).toBe("cache");
    expect(fetchCalls.length).toBe(before); // no live fetch on the second call
  });
});

// --- Tool: get_program_requirements --------------------------------------

describe("get_program_requirements tool", () => {
  it("test_get_program_requirements_falls_back_to_archetype_for_cs_bs", async () => {
    const res = await invokePurdueCatalogTool("get_program_requirements", {
      program_id: "cs_bs",
    });
    expect(res.isError).toBeFalsy();
    const out = structured<{
      source: string;
      program: { program_id: string; categories: Array<{ id: string }> };
    }>(res);
    expect(out.source).toBe("archetype");
    expect(out.program.program_id).toBe("cs_bs");
    expect(out.program.categories.length).toBeGreaterThan(0);
  });

  it("test_get_program_requirements_returns_unstructured_program_error_for_unknown", async () => {
    const res = await invokePurdueCatalogTool("get_program_requirements", {
      program_id: "purdue_history_ba",
    });
    expect(res.isError).toBe(true);
    const out = structured<{ error: string; detail: string }>(res);
    expect(out.error).toBe("unstructured_program");
    expect(out.detail).toMatch(/does not publish/);
  });
});

// --- Tool: get_term_offerings --------------------------------------------

describe("get_term_offerings tool", () => {
  it("test_get_term_offerings_flags_historical_hits", async () => {
    // Preload cache so we don't need Purdue for this test.
    fakeDb.tables.course_cache = [
      {
        course_code: "CS 18000",
        subject: "CS",
        number: "18000",
        title: "Intro",
        credits: 4,
        description: "",
        prerequisites_hint: [],
        prerequisites_confidence: "low_unstructured_hint",
        terms_seen_historically: ["Fall 2024", "Fall 2025", "Spring 2025"],
        source: "purdue_io_odata",
        source_course_id: "abc",
        fetched_at: new Date().toISOString(),
      },
    ];
    const res = await invokePurdueCatalogTool("get_term_offerings", {
      course_code: "CS 18000",
      term: "Fall",
    });
    const out = structured<{ offered: boolean; historical_matches: string[] }>(res);
    expect(out.offered).toBe(true);
    expect(out.historical_matches.sort()).toEqual(["Fall 2024", "Fall 2025"]);
  });

  it("test_get_term_offerings_returns_offered_false_when_no_match", async () => {
    fakeDb.tables.course_cache = [
      {
        course_code: "CS 18000",
        subject: "CS",
        number: "18000",
        title: "Intro",
        credits: 4,
        description: "",
        prerequisites_hint: [],
        prerequisites_confidence: "low_unstructured_hint",
        terms_seen_historically: ["Fall 2024"],
        source: "purdue_io_odata",
        source_course_id: "abc",
        fetched_at: new Date().toISOString(),
      },
    ];
    const res = await invokePurdueCatalogTool("get_term_offerings", {
      course_code: "CS 18000",
      term: "Summer",
    });
    const out = structured<{ offered: boolean; historical_matches: string[] }>(res);
    expect(out.offered).toBe(false);
    expect(out.historical_matches).toEqual([]);
  });
});

// --- Utility ------------------------------------------------------------

describe("Purdue error typing", () => {
  it("test_is_purdue_error_narrows_correctly", () => {
    expect(isPurdueError({ error: "x", detail: "y" })).toBe(true);
    expect(isPurdueError({ course_code: "CS 101" } as never)).toBe(false);
  });
});
