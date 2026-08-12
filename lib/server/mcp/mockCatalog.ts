// Mock university-catalog MCP server for fallback verification.
//
// Every tool returns `{ error: "unavailable", detail }` — same shape
// the real server emits when api.purdue.io is down or returns non-2xx.
// The point is not to test the mock itself but to verify the AGENT
// degrades gracefully: system prompt rule §3 says "when a catalog
// tool returns { error, detail }, do NOT retry that tool this turn.
// Tell the student plainly. Then fall back to archetype-level
// reasoning via get_program_requirements + rules-engine tools."
//
// Used only by:
//   - scripts/smokeFallback.ts (real Anthropic key against this mock)
//   - tests/agentFallback.test.ts (wiring assertions)
//
// NOT wired into production. `buildAgentOptions` takes an optional
// `catalogServer` override — the smoke passes this mock, everything
// else keeps the real Purdue.io server.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function unavailable(detail: string): CallToolResult {
  const payload = { error: "unavailable", detail };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

const getCourseMock = tool(
  "get_course",
  "Mock — always returns { error: 'unavailable' }.",
  { course_code: z.string() },
  async () =>
    unavailable(
      "Mock catalog: simulating api.purdue.io being unreachable.",
    ),
);

const searchCoursesMock = tool(
  "search_courses",
  "Mock — always returns { error: 'unavailable' }.",
  {
    query: z.string(),
    department: z.string().optional(),
  },
  async () =>
    unavailable(
      "Mock catalog: simulating api.purdue.io being unreachable.",
    ),
);

const getProgramReqMock = tool(
  "get_program_requirements",
  "Mock — always returns { error: 'unavailable' }.",
  { program_id: z.string() },
  async () =>
    unavailable(
      "Mock catalog: simulating api.purdue.io being unreachable.",
    ),
);

const getTermOfferingsMock = tool(
  "get_term_offerings",
  "Mock — always returns { error: 'unavailable' }.",
  { course_code: z.string(), term: z.string() },
  async () =>
    unavailable(
      "Mock catalog: simulating api.purdue.io being unreachable.",
    ),
);

export const mockCatalogTools = [
  getCourseMock,
  searchCoursesMock,
  getProgramReqMock,
  getTermOfferingsMock,
];

export const mockCatalogServer = createSdkMcpServer({
  name: "university-catalog",
  version: "1.0.0-mock",
  instructions:
    "Mock catalog. Every tool returns { error: 'unavailable' } so the " +
    "agent must degrade to archetype-level reasoning per system-prompt " +
    "rule 3.",
  tools: mockCatalogTools,
});

/** Invoke by name — mirrors the real invokePurdueCatalogTool for testing. */
export async function invokeMockCatalogTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  const found = mockCatalogTools.find((t) => t.name === toolName);
  if (!found) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "unknown_tool", detail: toolName }),
        },
      ],
      isError: true,
    };
  }
  return (await found.handler(input as never, undefined)) as CallToolResult;
}
