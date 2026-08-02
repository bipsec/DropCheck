// Extraction agent — transcript markdown → structured ExtractedProfile.
// Ported 1:1 from backend/app/agents/extraction.py.
//
// Uses Opus 5 + tool_use (via runTool) because messages.parse's grammar
// compiler times out on our nested schema (finance submodel + list of
// course submodels). Truncates long inputs to keep the request bounded —
// a transcript rarely needs > 50K chars, and pathological OCR output
// can run much longer.

import { REASONING_MODEL, runTool } from "@/lib/server/agents/client";
import { EXTRACTION_SYSTEM } from "@/lib/server/agents/prompts";
import { ExtractedProfile } from "@/lib/server/schemas/profile";

const TOOL_NAME = "record_extracted_profile";
const MAX_MARKDOWN_CHARS = 80_000;

/**
 * Run the extraction agent over parsed transcript markdown.
 *
 * Throws `AnthropicUnavailable` if the key is missing or the model refuses.
 * Callers should catch that and fall back to a manual-entry flow.
 */
export async function extractProfile(markdown: string): Promise<ExtractedProfile> {
  if (!markdown.trim()) {
    return ExtractedProfile.parse({});
  }

  const truncated = markdown.slice(0, MAX_MARKDOWN_CHARS);
  const user =
    `Transcript markdown follows. Call the \`${TOOL_NAME}\` tool with the ` +
    `extracted structured profile.\n\n` +
    "```\n" +
    truncated +
    "\n```";

  return await runTool({
    system: EXTRACTION_SYSTEM,
    user,
    schema: ExtractedProfile,
    toolName: TOOL_NAME,
    toolDescription: "Record the structured profile extracted from the transcript.",
    model: REASONING_MODEL,
    maxTokens: 8000,
  });
}
