// University-catalog MCP server (in-process — see plan discussion in
// Phase 3). Wraps `services/purdueClient` + `services/courseCache`
// behind the four tools from NEW_Plan.md §2. Every tool returns
// `{ error, detail }` on failure — never throws.
//
// The `get_program_requirements` tool has a two-branch design: real
// Purdue programs return unstructured_program (they don't publish
// structured requirements), but our four archetype fixtures
// (cs_bs / business_bs / math_bs / psych_bs) resolve. §4 of the plan
// explicitly leans on this for degraded operation.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { normalizeCourse } from "@/lib/server/data/catalog";
import {
  codeNamespaceOf,
  getProgram,
  UnknownProgramError,
} from "@/lib/server/data/programs";
import {
  fetchCourseDetail,
  isPurdueError,
  listSubjectCourses,
  seasonsFromHistoricalTerms,
  splitCourseCode,
  type PurdueCourseNormalized,
} from "@/lib/server/services/purdueClient";
import {
  readCached,
  readSubjectCached,
  writeCache,
  writeCacheBatch,
} from "@/lib/server/services/courseCache";

type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function fail(error: string, detail: string): CallToolResult {
  const payload = { error, detail };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

// --- Shared Course wire shape ---------------------------------------------
// We surface exactly what the rules-engine + UI care about, plus the
// prereq_hint + confidence marker so downstream code can label them.

function toCourseWire(c: PurdueCourseNormalized): Record<string, unknown> {
  return {
    course_code: c.course_code,
    title: c.title,
    credits: c.credits,
    description: c.description,
    // Prereqs never leave this server as ground truth — they're a hint
    // with an explicit confidence marker per NEW_Plan.md §3 prereq
    // mismatch discussion.
    prerequisites_hint: c.prerequisites_hint,
    prerequisites_confidence: c.prerequisites_confidence,
    terms_seen_historically: c.terms_seen_historically,
    terms_offered_seasons: seasonsFromHistoricalTerms(c.terms_seen_historically),
    source: c.source,
    source_course_id: c.source_course_id,
  };
}

// --- get_course -----------------------------------------------------------

const getCourseSchema = {
  course_code: z
    .string()
    .describe("Normalized course code, e.g. 'CS 18000' or 'MATH 165'."),
};

const getCourseTool = tool(
  "get_course",
  "Look up a single Purdue course. Cache-first; live-fetches api.purdue.io " +
    "on miss and writes through. On failure returns { error: 'not_found' | " +
    "'unavailable' | 'timeout', detail } — never throws.",
  getCourseSchema,
  async (args) => {
    const code = normalizeCourse(args.course_code);
    const parts = splitCourseCode(code);
    if (!parts) {
      return fail(
        "invalid_input",
        `Could not parse course_code ${JSON.stringify(args.course_code)}.`,
      );
    }

    // 1. Cache hit + fresh — serve directly.
    const cached = await readCached(code).catch(() => null);
    if (cached && cached.fresh) {
      return ok({ ...toCourseWire(cached.course), cache: "hit" });
    }

    // 2. Live fetch.
    const live = await fetchCourseDetail(parts.subject, parts.number);
    if (isPurdueError(live)) {
      // Stale cache better than nothing.
      if (cached) {
        return ok({
          ...toCourseWire(cached.course),
          cache: "stale",
          warning: live.detail,
        });
      }
      return fail(live.error, live.detail);
    }

    // 3. Cache-write and return.
    await writeCache(live).catch(() => undefined);
    return ok({ ...toCourseWire(live), cache: "miss" });
  },
);

// --- search_courses -------------------------------------------------------

const searchSchema = {
  query: z
    .string()
    .describe(
      "Search string. Currently the underlying Purdue endpoint filters " +
        "by subject abbreviation — pass e.g. 'CS' to list every CS course.",
    ),
  department: z
    .string()
    .optional()
    .describe(
      "Optional department override. If unset, `query` is interpreted " +
        "as the subject.",
    ),
};

const searchCoursesTool = tool(
  "search_courses",
  "List courses in a subject. Cache-first; falls back to live api.purdue.io " +
    "and write-through-caches the results. Returns { courses: [...] } or " +
    "{ error, detail }.",
  searchSchema,
  async (args) => {
    const subject = (args.department ?? args.query).trim().toUpperCase();
    if (!subject) {
      return fail("invalid_input", "Empty subject/department.");
    }

    const cached = await readSubjectCached(subject).catch(() => []);
    if (cached.length > 0) {
      return ok({
        subject,
        source: "cache",
        courses: cached.map(toCourseWire),
      });
    }

    const live = await listSubjectCourses(subject);
    if (isPurdueError(live)) return fail(live.error, live.detail);

    await writeCacheBatch(live).catch(() => undefined);
    return ok({
      subject,
      source: "purdue_io_odata",
      courses: live.map(toCourseWire),
    });
  },
);

// --- get_program_requirements --------------------------------------------

const programSchema = {
  program_id: z
    .string()
    .describe(
      "Stable program identifier. Archetypes recognized: cs_bs, " +
        "business_bs, math_bs, psych_bs. Real Purdue programs surface " +
        "as { error: 'unstructured_program' } because Purdue.io doesn't " +
        "publish structured requirements.",
    ),
};

const getProgramReqTool = tool(
  "get_program_requirements",
  "Return the structured requirements for a program. Uses our four " +
    "archetype fixtures when they match. Returns { error: " +
    "'unstructured_program', detail } for unknown ids — Purdue.io " +
    "doesn't publish structured program requirements, so the agent " +
    "should ask the student to paste their program's requirement sheet " +
    "and route it through update_student_profile.",
  programSchema,
  async (args) => {
    try {
      const program = getProgram(args.program_id);
      return ok({
        program,
        source: "archetype",
        ...codeNamespaceOf(program),
      });
    } catch (err) {
      if (err instanceof UnknownProgramError) {
        return fail(
          "unstructured_program",
          `No archetype registered for program_id ${JSON.stringify(args.program_id)}. ` +
            "Purdue.io does not publish structured program requirements — " +
            "ask the student for the requirement sheet and record it via update_student_profile.",
        );
      }
      throw err;
    }
  },
);

// --- get_term_offerings ---------------------------------------------------

const termOfferingsSchema = {
  course_code: z.string(),
  term: z
    .string()
    .describe(
      "Human term name, e.g. 'Fall 2025' or a bare season 'Fall'. If " +
        "the season doesn't match any run in the course's historical " +
        "offerings, `offered` is false.",
    ),
};

const getTermOfferingsTool = tool(
  "get_term_offerings",
  "Report whether a course has run in the given term. Uses the " +
    "historical Classes expand from api.purdue.io — this is what Purdue " +
    "has actually offered, NOT a guarantee for future terms. The system " +
    "prompt should caveat 'has historically run in Fall' rather than " +
    "'will run this Fall'.",
  termOfferingsSchema,
  async (args) => {
    const code = normalizeCourse(args.course_code);
    const parts = splitCourseCode(code);
    if (!parts) {
      return fail(
        "invalid_input",
        `Could not parse course_code ${JSON.stringify(args.course_code)}.`,
      );
    }
    const wantsExact = /\d{4}$/.test(args.term.trim());
    const target = args.term.trim();

    // Reuse the same cache/live path.
    const cached = await readCached(code).catch(() => null);
    let course: PurdueCourseNormalized | null =
      cached && cached.fresh ? cached.course : null;
    if (!course) {
      const live = await fetchCourseDetail(parts.subject, parts.number);
      if (isPurdueError(live)) {
        if (cached) course = cached.course; // stale-but-better-than-nothing
        else return fail(live.error, live.detail);
      } else {
        course = live;
        await writeCache(live).catch(() => undefined);
      }
    }

    const historical = course!.terms_seen_historically;
    const matched = historical.filter((t) =>
      wantsExact ? t === target : t.toLowerCase().startsWith(target.toLowerCase()),
    );
    return ok({
      course_code: code,
      term: target,
      offered: matched.length > 0,
      historical_matches: matched,
      note:
        "terms_seen_historically reflects past runs from Purdue's Classes " +
        "expand — not a guarantee of future term offerings.",
    });
  },
);

// --- Server assembly ------------------------------------------------------

export const purdueCatalogTools = [
  getCourseTool,
  searchCoursesTool,
  getProgramReqTool,
  getTermOfferingsTool,
];

export const purdueCatalogServer = createSdkMcpServer({
  name: "university-catalog",
  version: "1.0.0",
  instructions:
    "Wraps api.purdue.io/odata (one specific university). Every tool " +
    "returns { error, detail } on failure — do NOT retry silently. If " +
    "you get an error, tell the student the catalog data isn't available " +
    "for their school and switch to archetype-level reasoning via the " +
    "profile + rules-engine tools. Prerequisites in tool outputs are " +
    "marked with `prerequisites_confidence: 'low_unstructured_hint'` " +
    "because Purdue.io only exposes them in free-text descriptions — " +
    "confirm with the student before treating them as authoritative.",
  tools: purdueCatalogTools,
});

/** Invoke a tool by name outside the SDK — for tests + smokes. */
export async function invokePurdueCatalogTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  const found = purdueCatalogTools.find((t) => t.name === toolName);
  if (!found) {
    return fail(
      "unknown_tool",
      `No university-catalog tool named ${JSON.stringify(toolName)}.`,
    );
  }
  return (await found.handler(input as never, undefined)) as CallToolResult;
}
