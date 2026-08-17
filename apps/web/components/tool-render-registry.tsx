"use client";

import * as React from "react";
import { CourseCard, type CoursePayload } from "@/components/course-card";
import {
  CreditProgressBar,
  type CreditProgressPayload,
} from "@/components/credit-progress-bar";
import {
  DropImpactView,
  type DropImpactPayload,
} from "@/components/drop-impact-view";
import { TrackRoadway } from "@/components/track-roadway";
import type { Track } from "@dropcheck/shared";

/**
 * Registry mapping SDK-normalized tool names to inline renderers.
 * When a chat message carries a `tool_result` whose owning
 * `tool_name` is a key here, `<ChatMessageView>` mounts the component
 * with the parsed JSON payload embedded in the chat bubble.
 *
 * Add a new renderer by dropping another entry — the ChatMessage code
 * doesn't need to change.
 */

type Renderer = (payload: unknown) => React.ReactNode;

const REGISTRY: Record<string, Renderer> = {
  "mcp__rules-engine__build_track": (payload) => (
    <TrackRoadway track={payload as Track} />
  ),
  "mcp__rules-engine__impact_of_dropping": (payload) => (
    <DropImpactView payload={payload as DropImpactPayload} />
  ),
  "mcp__rules-engine__compute_degree_progress": (payload) => (
    <CreditProgressBar payload={payload as CreditProgressPayload} />
  ),
  "mcp__university-catalog__get_course": (payload) => (
    <CourseCard payload={payload as CoursePayload} />
  ),
};

export function hasRenderer(toolName: string): boolean {
  return toolName in REGISTRY;
}

/**
 * Attempt to render the given tool's result inline. Returns null when
 * the tool has no registered renderer, when the payload can't be
 * parsed as JSON, or when the tool errored (we'd rather let the raw
 * `{error, detail}` show in the collapsible step than pretend nothing
 * went wrong).
 */
export function renderToolResult(
  toolName: string,
  rawContent: unknown,
  isError: boolean,
): React.ReactNode {
  if (isError) return null;
  const renderer = REGISTRY[toolName];
  if (!renderer) return null;

  const payload = extractJsonPayload(rawContent);
  if (payload == null) {
    // Log the payload shape so a dev inspecting the console knows why
    // the inline viz didn't render. Common causes: SDK wrapped the
    // content in a shape we haven't seen yet, or the model's text
    // block wasn't valid JSON.
    if (typeof window !== "undefined") {
      console.warn(
        `[tool-render] ${toolName} skipped — content didn't parse to JSON.`,
        {
          contentType: Array.isArray(rawContent)
            ? "array"
            : typeof rawContent,
          preview:
            typeof rawContent === "string"
              ? rawContent.slice(0, 200)
              : JSON.stringify(rawContent).slice(0, 200),
        },
      );
    }
    return null;
  }
  // Rendering errors from bad payload shapes shouldn't blow up the
  // chat — wrap in a boundary-ish try/catch on the render side.
  try {
    return renderer(payload);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[tool-render] ${toolName} render failed:`, err);
    }
    return null;
  }
}

/**
 * Get the structured payload out of a `tool_result.content` field.
 *
 * The Agent SDK passes tool results through in several shapes depending
 * on the wrapping layer:
 *
 *   1. Array of MCP content blocks — the canonical MCP shape:
 *        [{ type: "text", text: "<json>" }]
 *   2. A single JSON string — Anthropic's Messages API tool_result
 *      collapses text-only content down to a bare string:
 *        "<json>"
 *   3. Already an object — a wrapping layer parsed it for us:
 *        { program_id: "cs_bs", ... }
 *
 * We try all three, in that order. Return null if nothing parses.
 */
export function extractJsonPayload(rawContent: unknown): unknown | null {
  // Case 3 — already an object (and not an array, which is case 1).
  if (
    rawContent !== null &&
    typeof rawContent === "object" &&
    !Array.isArray(rawContent)
  ) {
    return rawContent;
  }

  // Case 2 — a JSON string.
  if (typeof rawContent === "string") {
    return safeJsonParse(rawContent);
  }

  // Case 1 — array of MCP content blocks.
  if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      // Sometimes the SDK strips blocks down to plain strings inside
      // the array — handle that too.
      if (typeof block === "string") {
        const parsed = safeJsonParse(block);
        if (parsed != null) return parsed;
        continue;
      }
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "text") continue;
      const text = typeof b.text === "string" ? b.text : "";
      const parsed = safeJsonParse(text);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

function safeJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Fast reject: only try to parse things that at least look like JSON.
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
