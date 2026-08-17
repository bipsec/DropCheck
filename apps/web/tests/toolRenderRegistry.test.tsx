// @vitest-environment jsdom
//
// Phase 6 — every registered tool renderer must mount without crashing
// for a fixture payload. These are smoke render tests only; they check
// that a distinctive label from each renderer appears in the DOM so a
// future component-structure refactor can't silently break the chat
// visualization surface.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractJsonPayload,
  hasRenderer,
  renderToolResult,
} from "@/components/tool-render-registry";
import type { Track } from "@dropcheck/shared";

afterEach(() => cleanup());

const trackFixture: Track = {
  program_id: "cs_bs",
  generated_for: "fresh",
  terms: [
    {
      term: { season: "Fall", year: 2026 },
      courses: [
        {
          course_code: "CS 101",
          credits: 3,
          category_id: "cs_core",
          chosen_reason: "required",
        },
      ],
      credits_this_term: 3,
      cumulative_credits: 3,
    },
  ],
  total_terms: 1,
  projected_grad_term: { season: "Fall", year: 2026 },
  unresolved: [],
};

function contentFor(payload: unknown) {
  return [{ type: "text", text: JSON.stringify(payload) }];
}

describe("tool-render-registry — hasRenderer", () => {
  it("test_registry_covers_expected_tools", () => {
    expect(hasRenderer("mcp__rules-engine__build_track")).toBe(true);
    expect(hasRenderer("mcp__rules-engine__impact_of_dropping")).toBe(true);
    expect(hasRenderer("mcp__rules-engine__compute_degree_progress")).toBe(true);
    expect(hasRenderer("mcp__university-catalog__get_course")).toBe(true);
  });

  it("test_registry_returns_false_for_unknown_tool", () => {
    expect(hasRenderer("mcp__rules-engine__check_prerequisites")).toBe(false);
    expect(hasRenderer("mcp__profile-memory__get_student_profile")).toBe(false);
    expect(hasRenderer("mcp__university-catalog__search_courses")).toBe(false);
    expect(hasRenderer("nonsense")).toBe(false);
  });
});

describe("tool-render-registry — extractJsonPayload", () => {
  it("test_extracts_first_text_block_as_json", () => {
    const parsed = extractJsonPayload([
      { type: "text", text: '{"foo":42,"bar":"hi"}' },
    ]);
    expect(parsed).toEqual({ foo: 42, bar: "hi" });
  });

  it("test_extracts_plain_json_string_content", () => {
    // Anthropic's Messages API sometimes collapses text-only tool
    // results down to a bare string — this is the shape that used to
    // silently drop the roadway viz.
    const parsed = extractJsonPayload('{"program_id":"cs_bs","terms":[]}');
    expect(parsed).toEqual({ program_id: "cs_bs", terms: [] });
  });

  it("test_extracts_already_parsed_object", () => {
    // If a wrapping layer JSON-parsed for us, hand the object right
    // back rather than requiring text-block round-trips.
    const parsed = extractJsonPayload({ program_id: "cs_bs", total: 120 });
    expect(parsed).toEqual({ program_id: "cs_bs", total: 120 });
  });

  it("test_extracts_string_array_element", () => {
    // Occasionally the SDK flattens blocks to strings inside the
    // array — accept that too.
    const parsed = extractJsonPayload(['{"foo":"bar"}']);
    expect(parsed).toEqual({ foo: "bar" });
  });

  it("test_returns_null_on_malformed_content", () => {
    expect(extractJsonPayload(undefined)).toBeNull();
    expect(extractJsonPayload("not json at all")).toBeNull();
    expect(extractJsonPayload([{ type: "image" }])).toBeNull();
    expect(
      extractJsonPayload([{ type: "text", text: "not json {{{" }]),
    ).toBeNull();
  });
});

describe("tool-render-registry — renderToolResult", () => {
  it("test_renders_build_track_result_as_track_view", () => {
    const node = renderToolResult(
      "mcp__rules-engine__build_track",
      contentFor(trackFixture),
      false,
    );
    expect(node).not.toBeNull();
    render(<>{node}</>);
    // TrackView renders program_id in the header and the course code
    // inside a term column.
    expect(screen.getByText(/cs_bs/)).toBeTruthy();
    expect(screen.getByText("CS 101")).toBeTruthy();
  });

  it("test_renders_impact_of_dropping_as_drop_impact_view", () => {
    const payload = {
      course_code: "CS 201",
      now_blocked: ["CS 301", "CS 410"],
      unblocked_by_removal: [],
    };
    const node = renderToolResult(
      "mcp__rules-engine__impact_of_dropping",
      contentFor(payload),
      false,
    );
    render(<>{node}</>);
    // The dropped node label + at least one downstream label render.
    expect(screen.getByText("CS 201")).toBeTruthy();
    expect(screen.getByText("CS 301")).toBeTruthy();
    expect(screen.getByText("CS 410")).toBeTruthy();
  });

  it("test_renders_compute_degree_progress_as_credit_bar", () => {
    const payload = {
      program_id: "cs_bs",
      total_credits: 45,
      remaining_credits: 75,
      by_category: [
        {
          id: "cs_core",
          label: "Computer Science core",
          credits_needed: 20,
          credits_satisfied: 12,
        },
      ],
    };
    const node = renderToolResult(
      "mcp__rules-engine__compute_degree_progress",
      contentFor(payload),
      false,
    );
    render(<>{node}</>);
    expect(screen.getByText(/Degree progress/)).toBeTruthy();
    expect(screen.getByText(/45 of 120 credits/)).toBeTruthy();
    expect(screen.getByText(/Computer Science core/)).toBeTruthy();
  });

  it("test_renders_get_course_as_course_card", () => {
    const payload = {
      course_code: "CS 18000",
      title: "Problem Solving and Object-Oriented Programming",
      credits: 4,
      description: "Intro CS at Purdue.",
      prerequisites_hint: ["MATH 165"],
      prerequisites_confidence: "low_unstructured_hint",
      terms_offered_seasons: ["Fall", "Spring"],
      cache: "miss",
    };
    const node = renderToolResult(
      "mcp__university-catalog__get_course",
      contentFor(payload),
      false,
    );
    render(<>{node}</>);
    expect(screen.getByText("CS 18000")).toBeTruthy();
    expect(
      screen.getByText("Problem Solving and Object-Oriented Programming"),
    ).toBeTruthy();
    // Low-confidence hint banner mentions the flagged code.
    expect(screen.getByText(/MATH 165/)).toBeTruthy();
  });

  it("test_returns_null_when_tool_is_error", () => {
    // Even a well-shaped payload should NOT render when is_error is true —
    // we want the raw {error, detail} to show in the collapsible step
    // rather than pretend the tool succeeded.
    const node = renderToolResult(
      "mcp__rules-engine__build_track",
      contentFor(trackFixture),
      true,
    );
    expect(node).toBeNull();
  });

  it("test_returns_null_on_unknown_tool", () => {
    const node = renderToolResult(
      "mcp__rules-engine__check_prerequisites",
      contentFor({ satisfied: true }),
      false,
    );
    expect(node).toBeNull();
  });

  it("test_returns_null_when_payload_unparseable", () => {
    const node = renderToolResult(
      "mcp__rules-engine__build_track",
      "not a content array",
      false,
    );
    expect(node).toBeNull();
  });
});
