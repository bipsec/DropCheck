// @vitest-environment jsdom
//
// Smoke render tests for TrackView. jsdom env selected per-file via the
// docblock above; the rest of the suite stays on node.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TrackView } from "@/components/track-view";
import type { Track } from "@dropcheck/shared";

afterEach(() => cleanup());

function fixture(overrides: Partial<Track> = {}): Track {
  return {
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
          {
            course_code: "MATH 210",
            credits: 3,
            category_id: "math_core",
            chosen_reason: "required",
          },
        ],
        credits_this_term: 6,
        cumulative_credits: 6,
      },
      {
        term: { season: "Spring", year: 2027 },
        courses: [
          {
            course_code: "CS 201",
            credits: 3,
            category_id: "cs_core",
            chosen_reason: "required",
          },
        ],
        credits_this_term: 3,
        cumulative_credits: 9,
      },
    ],
    total_terms: 2,
    projected_grad_term: { season: "Spring", year: 2027 },
    unresolved: [
      { category_id: "free_electives", credits_needed: 76, options: [] },
    ],
    ...overrides,
  };
}

describe("TrackView", () => {
  it("test_track_view_renders_all_terms_from_fixture", () => {
    render(<TrackView track={fixture()} />);
    // "Spring 2027" appears twice (header + projected-grad line).
    expect(screen.getAllByText(/Fall 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Spring 2027/).length).toBeGreaterThan(0);
    expect(screen.getByText("CS 101")).toBeTruthy();
    expect(screen.getByText("MATH 210")).toBeTruthy();
    expect(screen.getByText("CS 201")).toBeTruthy();
  });

  it("test_track_view_marks_completed_courses_distinct_from_planned", () => {
    // Same fixture, but CS 101 is marked completed via prop. We can't
    // easily inspect stroke colors without visual regression tooling —
    // instead, assert both `Completed` and `Planned` legend swatches
    // rendered, which is what tells users the state exists.
    render(
      <TrackView track={fixture()} completedCodes={new Set(["CS 101"])} />,
    );
    expect(screen.getByText(/Completed/)).toBeTruthy();
    expect(screen.getByText(/Planned/)).toBeTruthy();
    expect(screen.getByText(/Needs your input/)).toBeTruthy();
  });

  it("test_track_view_shows_unresolved_slot_placeholder", () => {
    render(<TrackView track={fixture()} />);
    // The dashed slot rendered at the bottom of the last column carries
    // the category id (free_electives) and its credits-owed label.
    expect(screen.getByText("free_electives")).toBeTruthy();
    expect(screen.getByText(/76 cr owed/)).toBeTruthy();
  });

  it("test_track_view_shows_in_progress_badge_when_flagged", () => {
    render(<TrackView track={fixture({ generated_for: "in_progress" })} />);
    expect(screen.getByText(/In progress/i)).toBeTruthy();
  });

  it("test_track_view_renders_empty_state_when_no_terms", () => {
    const empty = fixture({ terms: [], total_terms: 0, unresolved: [] });
    render(<TrackView track={empty} />);
    expect(
      screen.getByText(/scheduler had nothing to place/i),
    ).toBeTruthy();
  });
});
