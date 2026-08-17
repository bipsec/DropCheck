// @vitest-environment jsdom
//
// Smoke render tests for ChatMessageView. Verifies the three message
// kinds each render distinguishable text + that tool-step rows show
// the tool name + result state.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatMessageView, type ChatMessage } from "@/components/chat-message";

afterEach(() => cleanup());

describe("ChatMessageView", () => {
  it("test_renders_user_message_with_text", () => {
    const msg: ChatMessage = { kind: "user", id: "u1", text: "hi there" };
    render(<ChatMessageView msg={msg} />);
    expect(screen.getByText("hi there")).toBeTruthy();
    expect(screen.getByText("user")).toBeTruthy();
  });

  it("test_renders_assistant_text_blocks", () => {
    const msg: ChatMessage = {
      kind: "assistant",
      id: "a1",
      textBlocks: ["First line.", "Second line."],
      toolSteps: [],
      done: true,
    };
    render(<ChatMessageView msg={msg} />);
    expect(screen.getByText("First line.")).toBeTruthy();
    expect(screen.getByText("Second line.")).toBeTruthy();
  });

  it("test_renders_assistant_markdown_bold_and_table", () => {
    // Bold + a GFM pipe table should end up as DOM <strong> and <table>
    // (not the literal `**` / `|` characters the previous plain-text
    // renderer showed).
    const md =
      "**Bold thing** matters.\n\n" +
      "| Course | Credits |\n" +
      "| --- | --- |\n" +
      "| CS 18000 | 4 |\n";
    const msg: ChatMessage = {
      kind: "assistant",
      id: "a1",
      textBlocks: [md],
      toolSteps: [],
      done: true,
    };
    const { container } = render(<ChatMessageView msg={msg} />);
    // <strong> for bold.
    expect(container.querySelector("strong")).not.toBeNull();
    expect(screen.getByText("Bold thing")).toBeTruthy();
    // <table> and header cell rendered.
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("Course")).toBeTruthy();
    expect(screen.getByText("CS 18000")).toBeTruthy();
  });

  it("test_renders_inline_code_and_code_fence", () => {
    const md = "Use `get_student_profile` first.\n\n```\nCS 18000\n```";
    const msg: ChatMessage = {
      kind: "assistant",
      id: "a1",
      textBlocks: [md],
      toolSteps: [],
      done: true,
    };
    const { container } = render(<ChatMessageView msg={msg} />);
    // At least one <code> (the inline one).
    expect(container.querySelector("code")).not.toBeNull();
    // The code fence renders inside a <pre>.
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("test_renders_thinking_indicator_when_no_text_yet_and_not_done", () => {
    const msg: ChatMessage = {
      kind: "assistant",
      id: "a1",
      textBlocks: [],
      toolSteps: [],
      done: false,
    };
    render(<ChatMessageView msg={msg} />);
    expect(screen.getByText(/Thinking/)).toBeTruthy();
  });

  it("test_renders_tool_step_with_pretty_name_and_pending_state", () => {
    const msg: ChatMessage = {
      kind: "assistant",
      id: "a1",
      textBlocks: [],
      toolSteps: [
        {
          tool_use_id: "t1",
          tool_name: "mcp__rules-engine__build_track",
          input: { program_id: "cs_bs" },
        },
      ],
      done: false,
    };
    render(<ChatMessageView msg={msg} />);
    // The pretty name appears TWICE while running: once in the row
    // ("rules engine · build_track" chip) and once in the running
    // indicator's label ("Running rules engine · build_track…").
    // Both are valid — we just assert it renders.
    expect(
      screen.getAllByText(/rules engine · build_track/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/running/)).toBeTruthy();
  });

  it("test_renders_tool_step_done_state_when_result_present", () => {
    const msg: ChatMessage = {
      kind: "assistant",
      id: "a1",
      textBlocks: [],
      toolSteps: [
        {
          tool_use_id: "t1",
          tool_name: "mcp__rules-engine__check_prerequisites",
          input: {},
          result: { satisfied: true },
          is_error: false,
        },
      ],
      done: true,
    };
    render(<ChatMessageView msg={msg} />);
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("test_renders_error_state_when_tool_result_flagged", () => {
    const msg: ChatMessage = {
      kind: "assistant",
      id: "a1",
      textBlocks: [],
      toolSteps: [
        {
          tool_use_id: "t1",
          tool_name: "mcp__university-catalog__get_course",
          input: { course_code: "CS 999" },
          result: { error: "not_found", detail: "…" },
          is_error: true,
        },
      ],
      done: true,
    };
    render(<ChatMessageView msg={msg} />);
    expect(screen.getByText("error")).toBeTruthy();
  });

  it("test_renders_error_bubble", () => {
    const msg: ChatMessage = {
      kind: "error",
      id: "e1",
      error: "invalid_body",
      detail: "prompt must be non-empty",
    };
    render(<ChatMessageView msg={msg} />);
    expect(screen.getByText("invalid_body")).toBeTruthy();
    expect(screen.getByText("prompt must be non-empty")).toBeTruthy();
  });
});
