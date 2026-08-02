// Anthropic client + structured-output helpers. Ported 1:1 from
// backend/app/agents/client.py.
//
// `runTool` is the reliable path for structured output on anything
// larger than a flat object — Anthropic's `output_config.format`
// grammar compiler times out on nested Zod-generated schemas (Python
// hit the same issue with nested Pydantic; see the note in
// backend/app/agents/extraction.py). We use tool_use + forced
// tool_choice everywhere.
//
// Model IDs match the Python originals:
//   - Haiku 4.5 for cheap, constrained decisions (matcher).
//   - Opus 5 for reasoning-heavy work (extraction, domain agents,
//     synthesis, clarification). Callers override per-invocation.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getSettings } from "@/lib/server/config";

export const DEFAULT_MODEL = "claude-haiku-4-5";
export const REASONING_MODEL = "claude-opus-5";

export class AnthropicUnavailable extends Error {
  constructor(message?: string) {
    super(
      message ??
        "ANTHROPIC_API_KEY not set — cannot call Claude. Set it in .env.local " +
          "or handle the fallback path in the caller.",
    );
    this.name = "AnthropicUnavailable";
  }
}

let cached: Anthropic | null | undefined;

export function getClient(): Anthropic | null {
  if (cached !== undefined) return cached;
  const key = getSettings().anthropic_api_key;
  cached = key ? new Anthropic({ apiKey: key }) : null;
  return cached;
}

export function requireClient(): Anthropic {
  const client = getClient();
  if (!client) throw new AnthropicUnavailable();
  return client;
}

export function _resetAnthropicForTests(): void {
  cached = undefined;
}

/**
 * Extract the top-level field keys a Zod object schema declares.
 * Falls back to `null` when the schema isn't a plain object (union,
 * discriminated union, etc.) — in those cases the caller shouldn't
 * strip unknown keys.
 */
function schemaTopLevelKeys<T extends z.ZodTypeAny>(schema: T): Set<string> | null {
  const def = (schema as unknown as { _def?: { type?: string; shape?: unknown } })._def;
  const shape = (def as { shape?: Record<string, unknown> } | undefined)?.shape;
  if (shape && typeof shape === "object") return new Set(Object.keys(shape));
  return null;
}

export interface RunToolOptions<T extends z.ZodTypeAny> {
  system: string;
  user: string;
  schema: T;
  toolName: string;
  toolDescription?: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Structured output via tool_use with forced tool_choice.
 * Returns the Zod-parsed tool input on success. Throws
 * `AnthropicUnavailable` if the model refuses or fails to call the tool.
 * Strips top-level keys that aren't in the schema before parsing —
 * models occasionally invent extra keys like `reasoning_detail_note`;
 * we don't want additive drift to fail the request when the required
 * fields are all present.
 */
export async function runTool<T extends z.ZodTypeAny>(
  opts: RunToolOptions<T>,
): Promise<z.infer<T>> {
  const {
    system,
    user,
    schema,
    toolName,
    toolDescription = "Record the structured result.",
    model = REASONING_MODEL,
    maxTokens = 4096,
  } = opts;

  const client = requireClient();
  const inputSchema = z.toJSONSchema(schema, { target: "openapi-3.0" });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    tools: [
      {
        name: toolName,
        description: toolDescription,
        input_schema: inputSchema as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: toolName },
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") {
    throw new AnthropicUnavailable("Claude refused this request.");
  }

  const known = schemaTopLevelKeys(schema);
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === toolName) {
      const raw = (block.input ?? {}) as Record<string, unknown>;
      const cleaned = known
        ? Object.fromEntries(Object.entries(raw).filter(([k]) => known.has(k)))
        : raw;
      return schema.parse(cleaned) as z.infer<T>;
    }
  }
  throw new AnthropicUnavailable(
    `Claude did not call ${toolName}. stop_reason=${response.stop_reason!}`,
  );
}
