// Ported 1:1 from backend/tests/test_extraction_schema.py.
// The agent itself is exercised by the live smoke script; here we just
// verify the schema rejects malformed payloads and preserves null
// semantics.
import { describe, expect, it } from "vitest";
import { ExtractedProfile } from "@/lib/server/schemas/profile";

describe("extraction schema", () => {
  it("empty_profile_ok", () => {
    const p = ExtractedProfile.parse({});
    expect(p.courses).toEqual([]);
    expect(p.name).toBeUndefined();
    expect(p.gpa).toBeUndefined();
  });

  it("null_fields_preserved_not_coerced", () => {
    const p = ExtractedProfile.parse({
      gpa: null,
      total_credits_completed: null,
    });
    expect(p.gpa).toBeNull();
    expect(p.total_credits_completed).toBeNull();
  });

  it("gpa_accepts_number", () => {
    // No bounds check on the extraction schema — Anthropic's tool
    // grammar compiler rejects it. Sanity checks live downstream.
    const p = ExtractedProfile.parse({ gpa: 3.4 });
    expect(p.gpa).toBe(3.4);
  });

  it("rejects_unknown_field", () => {
    expect(() => ExtractedProfile.parse({ surprise: "value" })).toThrow();
  });

  it("courses_shape", () => {
    const p = ExtractedProfile.parse({
      courses: [
        {
          code: "CS 201",
          title: "Data Structures",
          grade: "B+",
          credits: 3,
          semester: "Fall 2024",
        },
        { code: null, title: "unknown course" }, // nulls allowed on every field
      ],
    });
    expect(p.courses).toHaveLength(2);
    expect(p.courses[0].code).toBe("CS 201");
    expect(p.courses[1].code).toBeNull();
  });

  it("finance_hints_are_optional", () => {
    const p = ExtractedProfile.parse({
      finance_hints: { tuition_per_term: 12500, aid_types: ["pell"] },
    });
    expect(p.finance_hints).not.toBeNull();
    expect(p.finance_hints!.tuition_per_term).toBe(12500);
    expect(p.finance_hints!.current_aid_amount).toBeUndefined();
  });
});
