// Ported 1:1 from backend/tests/test_fallback.py.
//
// One naming caveat: the TS port uses camelCase for wire fields
// (`bottomLine`, `hasImpact`) since that's what agents emit and the
// frontend consumes. Python's snake_case attribute access
// (`payload.bottom_line`, `p.has_impact`) becomes `.bottomLine` /
// `.hasImpact` here.
import { describe, expect, it } from "vitest";
import { phraseFromRules } from "@/lib/server/agents/fallback";
import {
  buildStudentContext,
  type DropCheckInput,
} from "@/lib/server/services/resolver";

function ctxOrThrow(input: DropCheckInput) {
  const ctx = buildStudentContext(input);
  expect(ctx).not.toBeNull();
  return ctx!;
}

describe("fallback", () => {
  it("no_impact_low_headline", () => {
    const ctx = ctxOrThrow({
      course: "ENG 150",
      credits: 15,
      major: "cs",
      required_for_major: "no",
    });
    const payload = phraseFromRules(ctx);
    expect(payload.headline).toContain("low-impact");
    expect(payload.panels[0].domain).toBe("academic");
    expect(payload.panels[1].domain).toBe("financial");
    expect(payload.panels[2].domain).toBe("status");
    expect(payload.panels.some((p) => p.hasImpact)).toBe(false);
  });

  it("cs301_cs_major_reports_delay", () => {
    const ctx = ctxOrThrow({ course: "CS 301", credits: 15, major: "cs" });
    const payload = phraseFromRules(ctx);
    expect(payload.panels[0].hasImpact).toBe(true);
    expect(payload.panels[0].verdict).toContain("delays your degree");
  });

  it("below_full_time_triggers_financial", () => {
    // CS 340 = 4 credits; total 14 → after 10.
    const ctx = ctxOrThrow({ course: "CS 340", credits: 14, major: "cs" });
    const payload = phraseFromRules(ctx);
    const fin = payload.panels[1];
    expect(fin.hasImpact).toBe(true);
    expect(fin.verdict).toContain("10");
  });

  it("international_triggers_status_when_below_f1_min", () => {
    const ctx = ctxOrThrow({
      course: "CS 340",
      credits: 14,
      major: "cs",
      international: true,
    });
    const payload = phraseFromRules(ctx);
    const status = payload.panels[2];
    expect(status.hasImpact).toBe(true);
    expect(status.verdict).toContain("F-1");
    const labels = payload.plot.thresholds.map((t) => t.label);
    expect(labels.some((l) => l.includes("F-1"))).toBe(true);
  });

  it("diagram_includes_dropped_and_prereqs", () => {
    const ctx = ctxOrThrow({ course: "CS 301", credits: 15, major: "cs" });
    const payload = phraseFromRules(ctx);
    const kinds = new Set(payload.diagram.nodes.map((n) => n.kind));
    expect(kinds.has("dropped")).toBe(true);
    expect(kinds.has("prereq")).toBe(true); // CS 201 and MATH 210
    expect(kinds.has("downstream")).toBe(true); // CS 402 etc.
  });

  it("meta_mode_is_fallback", () => {
    const ctx = ctxOrThrow({ course: "CS 301", credits: 15, major: "cs" });
    const payload = phraseFromRules(ctx, "test note");
    expect(payload.meta.mode).toBe("fallback");
    expect(payload.meta.degraded).toBe(false);
    expect(payload.meta.note).toBe("test note");
  });

  it("bottom_line_references_advisor_when_academic_impact", () => {
    const ctx = ctxOrThrow({ course: "CS 301", credits: 15, major: "cs" });
    const payload = phraseFromRules(ctx);
    expect(payload.bottomLine.toLowerCase()).toContain("advisor");
  });
});
