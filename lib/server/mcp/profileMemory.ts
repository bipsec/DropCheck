// Profile & memory MCP server (in-process SDK).
//
// Three tools live here — every conversational turn touches at least
// one of them. `get_student_profile` is called at the top of most
// turns (per NEW_Plan.md §5); `update_student_profile` runs whenever
// the student reveals something new; `record_advising_note` captures
// the reasoning behind advice so future sessions can build on it.
//
// Same return-shape discipline as the rules-engine server: never throw
// — every failure becomes `{ error, detail }` in `structuredContent`
// with `isError: true`.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  AdvisingNoteInput,
  StudentPatch,
} from "@/lib/server/schemas/studentProfile";
import {
  applyPatch,
  ProfileStoreError,
  readProfile,
  writeAdvisingNote,
} from "@/lib/server/services/profileStore";

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

function errorToResult(err: unknown): CallToolResult {
  if (err instanceof ProfileStoreError) {
    return fail(err.code ?? "profile_store_error", err.message);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return fail("unexpected_error", msg);
}

/**
 * The LLM sometimes stringifies structured tool inputs (`{...}` → `"{...}"`).
 * Parse defensively before Zod runs so we don't reject every patch that
 * happens to arrive as a JSON string. Mirrors the same helper on the
 * rules-engine MCP server.
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

// --- get_student_profile --------------------------------------------------

const getProfileSchema = {
  student_id: z
    .string()
    .describe("UUID of the student whose profile to read."),
};

const getStudentProfile = tool(
  "get_student_profile",
  "Return the student's full profile (major, target grad term, cap, " +
    "completed courses, waivers, transfers, and the eight most-recent " +
    "advising notes). Call this at the top of most conversation turns " +
    "so the advisor doesn't ask about things the student already said.",
  getProfileSchema,
  async (args) => {
    try {
      const profile = await readProfile(args.student_id);
      return ok(profile as unknown as Record<string, unknown>);
    } catch (err) {
      return errorToResult(err);
    }
  },
);

// --- update_student_profile ----------------------------------------------

const updateProfileSchema = {
  student_id: z.string(),
  patch: z
    .unknown()
    .describe(
      "StudentPatch shape — every field optional. `null` explicitly " +
        "clears; `undefined` leaves the column alone. Arrays " +
        "(completed_courses, waivers, transfer_credits, " +
        "in_progress_courses) are additive with §2.4 priority-aware " +
        "dedup on completed_courses.",
    ),
};

const updateStudentProfile = tool(
  "update_student_profile",
  "Merge new information into the student's profile. Additive on " +
    "arrays; scalars overwrite when present. Returns the merged " +
    "profile so the caller sees the post-write state.",
  updateProfileSchema,
  async (args) => {
    let patch;
    try {
      patch = StudentPatch.parse(coerceObject(args.patch));
    } catch (err) {
      return fail(
        "invalid_patch",
        `Could not parse patch: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await applyPatch(args.student_id, patch);
      const merged = await readProfile(args.student_id);
      return ok(merged as unknown as Record<string, unknown>);
    } catch (err) {
      return errorToResult(err);
    }
  },
);

// --- record_advising_note ------------------------------------------------

const noteSchema = {
  student_id: z.string(),
  topic: z
    .string()
    .describe("Short label — the concern this note is about (e.g. 'CS 301 timing')."),
  reasoning: z
    .string()
    .describe(
      "The advisor's reasoning — what constraints, tools, and student " +
        "priorities went into the recommendation.",
    ),
  outcome: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional — what the student decided (if a decision was reached in-turn).",
    ),
};

const recordAdvisingNote = tool(
  "record_advising_note",
  "Write one advising note for this student. Notes surface in future " +
    "`get_student_profile` calls (newest first, capped at 8) so the " +
    "advisor can pick up threads across sessions.",
  noteSchema,
  async (args) => {
    let payload;
    try {
      payload = AdvisingNoteInput.parse({
        topic: args.topic,
        reasoning: args.reasoning,
        outcome: args.outcome ?? null,
      });
    } catch (err) {
      return fail(
        "invalid_note",
        `Could not parse note: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const note = await writeAdvisingNote(args.student_id, payload);
      return ok(note as unknown as Record<string, unknown>);
    } catch (err) {
      return errorToResult(err);
    }
  },
);

// --- Server assembly ------------------------------------------------------

export const profileMemoryTools = [
  getStudentProfile,
  updateStudentProfile,
  recordAdvisingNote,
];

export const profileMemoryServer = createSdkMcpServer({
  name: "profile-memory",
  version: "1.0.0",
  instructions:
    "Per-student persistent state. Call get_student_profile before " +
    "asking the student about anything they may have told you before. " +
    "Call update_student_profile whenever the student reveals new " +
    "facts (major, taken courses, target grad term, etc.). Call " +
    "record_advising_note after giving substantive advice so future " +
    "sessions can build on it. All tools return { error, detail } on " +
    "failure — never throw.",
  tools: profileMemoryTools,
});

/** Invoke a tool by name outside the SDK — for tests + smoke scripts. */
export async function invokeProfileMemoryTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  const found = profileMemoryTools.find((t) => t.name === toolName);
  if (!found) {
    return fail(
      "unknown_tool",
      `No profile-memory tool named ${JSON.stringify(toolName)}.`,
    );
  }
  return (await found.handler(input as never, undefined)) as CallToolResult;
}
