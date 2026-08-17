// @vitest-environment jsdom
//
// End-to-end render: a chat assistant message carrying a tool step
// whose tool_name maps to a registered renderer should embed the
// component's DOM inside the message bubble. Uses build_track since
// it's the most content-rich path (TrackView renders term columns).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChatMessageView,
  type ChatMessage,
} from "@/components/chat-message";
import type { Track } from "@dropcheck/shared";

afterEach(() => cleanup());

const track: Track = {
  program_id: "cs_bs",
  generated_for: "in_progress",
  terms: [
    {
      term: { season: "Fall", year: 2026 },
      courses: [
        {
          course_code: "MATH 210",
          credits: 3,
          category_id: "math_core",
          chosen_reason: "required",
        },
      ],
      credits_this_term: 3,
      cumulative_credits: 6,
    },
  ],
  total_terms: 1,
  projected_grad_term: { season: "Fall", year: 2026 },
  unresolved: [],
};

function fixtureMessage(): ChatMessage {
  return {
    kind: "assistant",
    id: "a-1",
    textBlocks: ["Here's your plan."],
    toolSteps: [
      {
        tool_use_id: "t-1",
        tool_name: "mcp__rules-engine__build_track",
        input: { program_id: "cs_bs" },
        result: [{ type: "text", text: JSON.stringify(track) }],
        is_error: false,
      },
    ],
    done: true,
  };
}

describe("ChatMessageView with embedded viz", () => {
  it("test_assistant_message_embeds_track_view_from_tool_result", () => {
    render(<ChatMessageView msg={fixtureMessage()} />);

    // Assistant text still renders.
    expect(screen.getByText("Here's your plan.")).toBeTruthy();

    // Roadway header ("1 stop · to …"), a course chip, and the
    // in-progress badge all render inline.
    expect(screen.getByText(/1 stop/)).toBeTruthy();
    expect(screen.getByText("MATH 210")).toBeTruthy();
    expect(screen.getByText(/In progress/i)).toBeTruthy();
  });

  it("test_no_viz_rendered_when_tool_step_errored", () => {
    const msg = fixtureMessage();
    if (msg.kind === "assistant") {
      msg.toolSteps[0].is_error = true;
      msg.toolSteps[0].result = [
        {
          type: "text",
          text: JSON.stringify({ error: "boom", detail: "explodes" }),
        },
      ];
    }
    render(<ChatMessageView msg={msg} />);
    // Assistant text still shows.
    expect(screen.getByText("Here's your plan.")).toBeTruthy();
    // The TrackView-specific "In progress" chip should NOT appear —
    // errored tool_result opts out of the inline renderer.
    expect(screen.queryByText(/In progress/i)).toBeNull();
  });

  it("test_no_viz_when_tool_still_running", () => {
    const msg = fixtureMessage();
    if (msg.kind === "assistant") {
      msg.toolSteps[0].result = undefined;
      msg.toolSteps[0].is_error = undefined;
      msg.done = false;
    }
    render(<ChatMessageView msg={msg} />);
    // No renderer runs while pending.
    expect(screen.queryByText("MATH 210")).toBeNull();
    // Pending marker shows on the step.
    expect(screen.getByText(/running/)).toBeTruthy();
  });
});
