// Agent SDK session factory.
//
// Assembles the three MCP servers + advisory system prompt +
// exhaustive allowedTools list into an `Options` object ready to hand
// to `query()`. Reads / writes `session_state` so turn N+1 resumes the
// same SDK session that turn N opened — that's what makes the advisor
// feel continuous across the academic year (NEW_Plan.md §3, §5).
//
// The chat route (Phase 5) uses this file as follows:
//     const opts = await buildAgentOptions(studentId);
//     for await (const msg of query({ prompt, options: opts })) {
//       await captureSessionId(studentId, msg);
//       ...
//     }

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { rulesEngineServer } from "@/lib/server/mcp/rulesEngine";
import { profileMemoryServer } from "@/lib/server/mcp/profileMemory";
import { purdueCatalogServer } from "@/lib/server/mcp/purdueCatalog";
import { ALLOWED_TOOLS } from "@/lib/server/agent/allowedTools";
import { ADVISOR_SYSTEM_PROMPT } from "@/lib/server/agent/systemPrompt";
import {
  readSessionId,
  writeSessionId,
} from "@/lib/server/services/sessionStore";

export interface BuildAgentOptionsOverrides {
  /**
   * Override the `university-catalog` MCP server — used by the
   * fallback smoke to inject a mock catalog that returns errors on
   * every call, so we can verify the agent degrades to archetype
   * reasoning honestly instead of retrying or fabricating prereqs.
   * Anything else stays the real production wiring.
   */
  catalogServer?: NonNullable<Options["mcpServers"]>[string];
}

/**
 * Build a fresh `Options` object for a student. Reads the persisted
 * session id (if any) and sets `resume` so the agent picks up where
 * the previous turn left off. Every scalar option lives here — no
 * caller should tune agent behavior in ad-hoc route handlers.
 */
export async function buildAgentOptions(
  studentId: string,
  overrides: BuildAgentOptionsOverrides = {},
): Promise<Options> {
  const sessionId = await readSessionId(studentId).catch(() => null);
  // Inject the current student's UUID into the system prompt. The
  // profile-memory and (later) any other tool that takes a
  // `student_id` argument uses this exact value. Without this the LLM
  // has no way to know the id and will ask the user — see the
  // "give me your student ID (UUID)" bug that led to this change.
  const systemPromptForStudent = `${ADVISOR_SYSTEM_PROMPT}
--
CURRENT SESSION CONTEXT

The student you are talking to right now has student_id: ${studentId}.
Pass this exact value as the \`student_id\` argument to every profile-memory
tool (get_student_profile / update_student_profile / record_advising_note).
NEVER ask the user for their student_id — it's an internal UUID they
shouldn't know or care about. If get_student_profile returns
{ error: "not_found" }, treat the student as brand-new and start intake
from scratch via update_student_profile.`;

  const opts: Options = {
    systemPrompt: systemPromptForStudent,
    mcpServers: {
      "rules-engine": rulesEngineServer,
      "profile-memory": profileMemoryServer,
      "university-catalog": overrides.catalogServer ?? purdueCatalogServer,
    },
    // Disable ALL Claude Code built-in tools (Bash, Read, Write, Edit,
    // Glob, Grep, WebFetch, WebSearch, Task, TodoWrite, ToolSearch,
    // NotebookEdit, etc.). The advisor is chat-only and has three MCP
    // servers — no filesystem access, no shell, no web-fetching from
    // the model. Without this the SDK loads the full Claude Code
    // preset by default.
    tools: [],
    allowedTools: [...ALLOWED_TOOLS],
    // Belt-and-braces: even if a future SDK version re-enables some
    // built-in tools, this wildcard denial keeps them off. `mcp__*` is
    // an explicit exception for our three registered MCP servers.
    disallowedTools: [
      "Bash",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch",
      "Task",
      "TodoWrite",
      "NotebookEdit",
      "ToolSearch",
    ],
    permissionMode: "default",
    ...(sessionId ? { resume: sessionId } : {}),
  };
  return opts;
}

/**
 * Called once per SDK message the chat route observes. On the first
 * message that carries a `session_id`, persist it so the next turn
 * can resume. Subsequent messages are no-ops (idempotent write).
 */
export async function captureSessionId(
  studentId: string,
  msg: unknown,
  already: { current: string | null },
): Promise<void> {
  if (already.current) return; // already captured this turn
  const sid = extractSessionId(msg);
  if (!sid) return;
  already.current = sid;
  await writeSessionId(studentId, sid).catch(() => undefined);
}

function extractSessionId(msg: unknown): string | null {
  if (!msg || typeof msg !== "object") return null;
  const anyMsg = msg as Record<string, unknown>;
  const sid = anyMsg.session_id;
  return typeof sid === "string" && sid.length > 0 ? sid : null;
}
