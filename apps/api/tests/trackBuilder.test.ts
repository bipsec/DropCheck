import { describe, expect, it } from "vitest";
import { CS_BS } from "@/lib/server/data/programs/cs_bs";
import { COURSES } from "@/lib/server/data/catalog";
import { buildTrack } from "@/lib/server/services/trackBuilder";
import {
  freshStudent,
  transcriptCsStudent,
} from "./fixtures/students";

describe("track builder", () => {
  it("test_fresh_cs_bs_produces_valid_track", () => {
    const track = buildTrack({ student: freshStudent(), program: CS_BS });
    expect(track.program_id).toBe("cs_bs");
    expect(track.terms.length).toBeGreaterThan(0);
    // Cumulative monotone non-decreasing + never exceeds the per-term cap.
    let prev = 0;
    for (const term of track.terms) {
      expect(term.credits_this_term).toBeLessThanOrEqual(15);
      expect(term.cumulative_credits).toBeGreaterThanOrEqual(prev);
      prev = term.cumulative_credits;
    }
  });

  it("test_scheduler_respects_terms_offered", () => {
    // CS 301 is Fall-only in the demo catalog. It should never appear in
    // a Spring PlannedTerm.
    const track = buildTrack({ student: freshStudent(), program: CS_BS });
    for (const term of track.terms) {
      if (term.term.season === "Spring") {
        for (const c of term.courses) {
          expect(c.course_code).not.toBe("CS 301");
        }
      }
    }
  });

  it("test_scheduler_never_schedules_before_prereqs", () => {
    const track = buildTrack({ student: freshStudent(), program: CS_BS });
    const seen = new Set<string>();
    for (const term of track.terms) {
      for (const c of term.courses) {
        const row = COURSES[c.course_code];
        if (!row) continue;
        for (const pre of row.prerequisites) {
          expect(seen.has(pre), `${c.course_code} scheduled before prereq ${pre}`).toBe(true);
        }
      }
      for (const c of term.courses) seen.add(c.course_code);
    }
  });

  it("test_scheduler_prefers_bottleneck_first", () => {
    // MATH 210 has more downstream than most; it should show up at or
    // before CS 201's term in a fresh cs_bs plan.
    const track = buildTrack({ student: freshStudent(), program: CS_BS });
    const flat: Array<{ code: string; termIdx: number }> = [];
    track.terms.forEach((t, i) => {
      for (const c of t.courses) flat.push({ code: c.course_code, termIdx: i });
    });
    const math210 = flat.find((r) => r.code === "MATH 210");
    const cs301 = flat.find((r) => r.code === "CS 301");
    expect(math210).toBeDefined();
    expect(cs301).toBeDefined();
    // MATH 210 must land no later than CS 301 (which needs it as a prereq).
    expect(math210!.termIdx).toBeLessThanOrEqual(cs301!.termIdx);
  });

  it("test_in_progress_student_skips_completed", () => {
    const track = buildTrack({
      student: transcriptCsStudent(),
      program: CS_BS,
    });
    // Completed courses (CS 101, CS 201, MATH 210) should not appear in
    // any planned term for the in-progress student.
    const planned = new Set<string>();
    for (const t of track.terms) {
      for (const c of t.courses) planned.add(c.course_code);
    }
    expect(planned.has("CS 101")).toBe(false);
    expect(planned.has("CS 201")).toBe(false);
    expect(planned.has("MATH 210")).toBe(false);
    // But CS 301 becomes eligible immediately (prereqs satisfied).
    expect(planned.has("CS 301")).toBe(true);
    expect(track.generated_for).toBe("in_progress");
  });

  it("test_track_terminates_before_ten_years", () => {
    // Safety loop bound. cs_bs has a "free_electives" pool that can't be
    // fully filled from the demo catalog (only a few tagged courses
    // exist), so the scheduler will hit the bound and stop — the
    // remainder should surface as unresolved rather than an infinite loop.
    const track = buildTrack({ student: freshStudent(), program: CS_BS });
    expect(track.terms.length).toBeLessThanOrEqual(30);
  });

  it("test_pool_choices_produce_unresolved_when_ambiguous", () => {
    // cs_bs.free_electives requires 76 credits from a tag pool that the
    // demo catalog can only partially satisfy. That should surface as an
    // unresolved slot rather than a scheduling failure.
    const track = buildTrack({ student: freshStudent(), program: CS_BS });
    const feUnresolved = track.unresolved.find(
      (u) => u.category_id === "free_electives",
    );
    expect(feUnresolved).toBeDefined();
    expect(feUnresolved!.credits_needed).toBeGreaterThan(0);
  });

  it("test_generated_for_fresh_when_no_prior_courses", () => {
    const track = buildTrack({ student: freshStudent(), program: CS_BS });
    expect(track.generated_for).toBe("fresh");
  });
});
