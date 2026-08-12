// Rules-engine MCP server (in-process SDK).
//
// Every deterministic math function in `services/rulesEngine.ts` and
// `services/trackBuilder.ts` gets wrapped as one MCP tool. The agent
// calls these explicitly rather than reasoning about prereqs / credits
// itself — that's the guardrail from NEW_Plan.md §5.
//
// All four tools follow the same shape:
//   - Zod raw-shape input (per Agent SDK `tool()` signature).
//   - Return `CallToolResult` with a `content` text block AND a
//     `structuredContent` field carrying the typed payload for the UI /
//     downstream tools to consume directly.
//   - On failure, return `{ isError: true, structuredContent: { error,
//     detail } }` — never throw. Per plan §2, uncaught throws get
//     surfaced to Claude anyway, but a structured error lets the
//     system prompt tell Claude precisely how to react.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  bottleneckScore,
  buildRequirementGraph,
  impactOfDrop,
  remainingRequirements,
  satisfiedSet,
  type CategoryProgress,
  type SatisfactionSource,
  type SatisfiedResult,
} from "@/lib/server/services/rulesEngine";
import { buildTrack } from "@/lib/server/services/trackBuilder";
import { normalizeCourse } from "@/lib/server/data/catalog";
import {
  ProgramRequirements,
  type Track,
} from "@/lib/server/schemas/track";
import { StudentRecord } from "@/lib/server/schemas/studentRecord";

// --- CallToolResult helpers ------------------------------------------------

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

/**
 * The LLM sometimes stringifies structured tool inputs (`{...}` sent as
 * `"{...}"`). Parse defensively before Zod runs so we don't return an
 * `invalid_program` error every time the model gets creative with its
 * argument shape. Numbers / booleans / already-objects pass through.
 */
function coerceObject(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return v;
  try {
    return JSON.parse(trimmed);
  } catch {
    return v;
  }
}

// --- Tool 1: check_prerequisites ------------------------------------------
// Given a course + its (student- or catalog-asserted) prereqs + the
// student's completed courses, return whether the prereqs are satisfied
// and which specifically are missing. The tool doesn't fetch prereqs
// itself — the agent must gather them (catalog tool or student
// assertion) and pass them in. Keeps this layer pure.

const checkPrereqsSchema = {
  course_code: z.string().describe("Canonical course code being checked."),
  prereqs: z
    .array(z.string())
    .describe(
      "Prerequisite course codes for this course. Agent gathers these " +
        "from the catalog tool or from student assertion.",
    ),
  completed_courses: z
    .array(z.string())
    .describe(
      "Course codes the student has already completed (any source: " +
        "transcript, manual, waiver, transfer).",
    ),
};

const checkPrerequisites = tool(
  "check_prerequisites",
  "Given a course code, its prerequisites, and the student's completed " +
    "courses, return which prereqs are satisfied and which are missing.",
  checkPrereqsSchema,
  async (args) => {
    const target = normalizeCourse(args.course_code);
    if (!target) return fail("invalid_input", "course_code was empty.");
    const completed = new Set(args.completed_courses.map(normalizeCourse));
    const missing: string[] = [];
    for (const raw of args.prereqs) {
      const p = normalizeCourse(raw);
      if (!p) continue;
      if (!completed.has(p)) missing.push(p);
    }
    return ok({
      course_code: target,
      satisfied: missing.length === 0,
      missing,
    });
  },
);

// --- Tool 2: compute_degree_progress --------------------------------------
// Wraps `remainingRequirements` + a total-credits sum. The agent passes
// a full ProgramRequirements object (either an archetype fixture or a
// catalog-served program) plus the student's completed courses.

const degreeProgressSchema = {
  program_requirements: z
    .unknown()
    .describe(
      "Full ProgramRequirements object. See lib/server/schemas/track.ts.",
    ),
  completed_courses: z
    .array(
      z.object({
        course_code: z.string(),
        credits: z.number().optional().nullable(),
        source: z.enum(["waiver", "transcript", "manual", "transfer"]),
      }),
    )
    .describe("Completed courses with source per §2.4 priority order."),
  waivers: z
    .array(z.string())
    .default([])
    .describe("Course codes the student has waived."),
};

const computeDegreeProgress = tool(
  "compute_degree_progress",
  "Compute what remains in the student's degree plan: per-category " +
    "credits satisfied, credits needed, courses still owed, and total " +
    "credits earned so far.",
  degreeProgressSchema,
  async (args) => {
    let program;
    try {
      program = ProgramRequirements.parse(coerceObject(args.program_requirements));
    } catch (err) {
      return fail(
        "invalid_program",
        `Could not parse program_requirements: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Compose a minimal StudentRecord — we only need the fields
    // rulesEngine.satisfiedSet actually reads.
    const student = StudentRecord.parse({
      student_id: "tool-scoped",
      program_id: program.program_id,
      entry_type: "manual",
      max_credits_per_term: 15,
      completed_courses: coerceObject(args.completed_courses) as never,
      waivers: coerceObject(args.waivers) as never,
    });

    const sat: SatisfiedResult = satisfiedSet(student, program);
    const rem: CategoryProgress[] = remainingRequirements(program, sat);
    let totalCredits = 0;
    for (const cat of rem) totalCredits += cat.credits_satisfied;
    const stillNeeded = Math.max(
      0,
      program.total_credits_required - totalCredits,
    );

    return ok({
      program_id: program.program_id,
      total_credits: totalCredits,
      remaining_credits: stillNeeded,
      by_category: rem,
      by_source: sourceCounts(sat),
    });
  },
);

function sourceCounts(sat: SatisfiedResult): Record<SatisfactionSource, number> {
  const out: Record<SatisfactionSource, number> = {
    waiver: 0,
    transcript: 0,
    manual: 0,
    transfer: 0,
  };
  for (const src of sat.bySource.values()) out[src] += 1;
  return out;
}

// --- Tool 3: impact_of_dropping -------------------------------------------
// The agent passes a candidate drop course + the set of remaining
// (planned or upcoming) courses with their prereqs. We return which
// remaining courses would become blocked and any that would be
// unblocked (rare — happens when a course had this one as a corequisite
// alternative).

const impactSchema = {
  course_code: z
    .string()
    .describe("The course the student is considering dropping."),
  remaining_courses: z
    .unknown()
    .describe(
      "Array of { course_code, prereqs?: string[] } — courses still in " +
        "the plan (not yet completed). Each carries its own prereq " +
        "list. Accepts either a JSON array or a stringified array.",
    ),
  program_requirements: z
    .unknown()
    .optional()
    .describe(
      "Optional program shape. If supplied, `categoriesAtRisk` reports " +
        "which categories the drop threatens.",
    ),
};

const impactOfDropping = tool(
  "impact_of_dropping",
  "Given a candidate drop and the remaining courses in the plan, list " +
    "the downstream courses that become blocked and (rarely) any that " +
    "become unblocked.",
  impactSchema,
  async (args) => {
    const target = normalizeCourse(args.course_code);
    if (!target) return fail("invalid_input", "course_code was empty.");

    // Direct downstream: courses whose prereqs contain the dropped code.
    // Transitive: those courses' downstream too, but only within the
    // supplied `remaining_courses`.
    const remainingParsed = coerceObject(args.remaining_courses);
    if (!Array.isArray(remainingParsed)) {
      return fail(
        "invalid_input",
        "remaining_courses must be an array of { course_code, prereqs? }.",
      );
    }
    const byCode = new Map<string, string[]>();
    for (const c of remainingParsed as Array<Record<string, unknown>>) {
      const code = normalizeCourse(String(c?.course_code ?? ""));
      if (!code) continue;
      const prereqs = Array.isArray(c.prereqs)
        ? (c.prereqs as string[]).map(normalizeCourse)
        : [];
      byCode.set(code, prereqs);
    }
    const nowBlocked = new Set<string>();
    const stack = [target];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const [code, prs] of byCode) {
        if (prs.includes(cur) && !nowBlocked.has(code)) {
          nowBlocked.add(code);
          stack.push(code);
        }
      }
    }

    // Category risk: only if program_requirements were supplied.
    let categoriesAtRisk: string[] = [];
    if (args.program_requirements !== undefined) {
      try {
        const program = ProgramRequirements.parse(
          coerceObject(args.program_requirements),
        );
        // Reuse the existing helper for its category-scan side.
        const sat: SatisfiedResult = {
          satisfied: new Set([target]),
          byCategory: new Map(),
          bySource: new Map(),
        };
        const drop = impactOfDrop(target, program, sat);
        categoriesAtRisk = drop.categoriesAtRisk;
      } catch {
        // Ignore — program_requirements was optional and malformed.
      }
    }

    return ok({
      course_code: target,
      unblocked_by_removal: [],
      now_blocked: [...nowBlocked].sort(),
      categoriesAtRisk,
    });
  },
);

// --- Tool 4: build_track ---------------------------------------------------
// Wraps `services/trackBuilder.ts::buildTrack`. Emits the full Track
// shape the UI's <TrackView> already knows how to render.

const buildTrackSchema = {
  program_requirements: z
    .unknown()
    .describe("Full ProgramRequirements object."),
  completed_courses: z
    .array(
      z.object({
        course_code: z.string(),
        credits: z.number().optional().nullable(),
        source: z.enum(["waiver", "transcript", "manual", "transfer"]),
      }),
    )
    .describe("Completed courses (any source)."),
  waivers: z.array(z.string()).default([]),
  max_credits_per_term: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(15)
    .describe("Cap on credits the scheduler may place in one term."),
  start_term: z
    .object({
      season: z.enum(["Fall", "Spring", "Summer"]),
      year: z.number().int().min(1900).max(3000),
    })
    .optional()
    .describe("Optional starting term. Defaults to Fall 2026."),
};

const buildTrackTool = tool(
  "build_track",
  "Build a term-by-term degree plan from the student's completed " +
    "courses + program requirements. Deterministic scheduler; no LLM.",
  buildTrackSchema,
  async (args) => {
    let program;
    try {
      program = ProgramRequirements.parse(coerceObject(args.program_requirements));
    } catch (err) {
      return fail(
        "invalid_program",
        `Could not parse program_requirements: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const student = StudentRecord.parse({
      student_id: "tool-scoped",
      program_id: program.program_id,
      entry_type: "manual",
      max_credits_per_term: args.max_credits_per_term,
      completed_courses: coerceObject(args.completed_courses) as never,
      waivers: coerceObject(args.waivers) as never,
    });

    const track: Track = buildTrack({
      student,
      program,
      startTerm: args.start_term,
    });

    return ok({ ...track });
  },
);

// --- bottleneck helper (not an SDK tool — internal only) -------------------
// Exposed as a plain helper so future tools / route handlers can consume
// bottleneck rankings without going through the SDK boundary. Kept here
// so all rules-engine consumers import from one place.
export function bottleneckOf(code: string): number {
  return bottleneckScore(code);
}

export function _requirementGraphForTesting(program: unknown) {
  return buildRequirementGraph(ProgramRequirements.parse(program));
}

// --- Server assembly ------------------------------------------------------

export const rulesEngineTools = [
  checkPrerequisites,
  computeDegreeProgress,
  impactOfDropping,
  buildTrackTool,
];

export const rulesEngineServer = createSdkMcpServer({
  name: "rules-engine",
  version: "1.0.0",
  instructions:
    "Deterministic degree-planning math. Every tool is pure and takes " +
    "explicit inputs — the agent must gather prereqs / credits / " +
    "programs from the catalog or the student before calling these. " +
    "On any invalid input, tools return { error, detail } rather than " +
    "throwing.",
  tools: rulesEngineTools,
});

/** Invoke a tool by name outside the SDK — for tests + smoke scripts. */
export async function invokeRulesEngineTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  const found = rulesEngineTools.find((t) => t.name === toolName);
  if (!found) {
    return fail("unknown_tool", `No rules-engine tool named ${JSON.stringify(toolName)}.`);
  }
  return (await found.handler(input as never, undefined)) as CallToolResult;
}
