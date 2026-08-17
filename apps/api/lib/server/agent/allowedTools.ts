// Exhaustive `allowedTools` list. Every MCP tool the agent may call is
// enumerated here — the SDK denies anything else. Keeping the list
// tight limits accidental use of the SDK's built-in tools (Read /
// Write / Bash / etc.) that we deliberately don't want available in
// an advisor context.
//
// Format: `mcp__<server_name>__<tool_name>` per the SDK's tool-naming
// convention. Server names must match the `name:` on the
// corresponding `createSdkMcpServer` call in `lib/server/mcp/*`.

export const ALLOWED_TOOLS: readonly string[] = [
  // Rules engine
  "mcp__rules-engine__check_prerequisites",
  "mcp__rules-engine__compute_degree_progress",
  "mcp__rules-engine__impact_of_dropping",
  "mcp__rules-engine__build_track",

  // Profile & memory
  "mcp__profile-memory__get_student_profile",
  "mcp__profile-memory__update_student_profile",
  "mcp__profile-memory__record_advising_note",

  // University catalog (Purdue.io)
  "mcp__university-catalog__get_course",
  "mcp__university-catalog__search_courses",
  "mcp__university-catalog__get_program_requirements",
  "mcp__university-catalog__get_term_offerings",
] as const;
