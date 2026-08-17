import { describe, expect, it } from "vitest";
import { COURSES, lookupCourse } from "@/lib/server/data/catalog";
import { CS_BS } from "@/lib/server/data/programs/cs_bs";
import { BUSINESS_BS } from "@/lib/server/data/programs/business_bs";
import { MATH_BS } from "@/lib/server/data/programs/math_bs";
import { PSYCH_BS } from "@/lib/server/data/programs/psych_bs";
import {
  getProgram,
  listPrograms,
  programIdForMajor,
  UnknownProgramError,
} from "@/lib/server/data/programs";
import { ProgramRequirements } from "@/lib/server/schemas/track";

describe("cs_bs program fixture", () => {
  it("test_program_cs_bs_categories_sum_to_total", () => {
    const sum = CS_BS.categories.reduce(
      (acc, c) => acc + c.credits_required,
      0,
    );
    expect(sum).toBeGreaterThanOrEqual(CS_BS.total_credits_required);
  });

  it("test_program_cs_bs_all_fixed_courses_exist_in_catalog", () => {
    const fixedCodes = CS_BS.categories
      .filter((c) => c.kind === "fixed")
      .flatMap((c) => c.courses);
    // Sanity: something to check.
    expect(fixedCodes.length).toBeGreaterThan(0);
    for (const code of fixedCodes) {
      expect(lookupCourse(code), `missing catalog row for ${code}`).not.toBe(null);
    }
  });

  it("test_program_cs_bs_choose_count_pool_codes_exist_in_catalog", () => {
    const poolCodes = CS_BS.categories.flatMap((c) =>
      c.kind === "choose_count" ? c.choose_from.any_of : [],
    );
    expect(poolCodes.length).toBeGreaterThan(0);
    for (const code of poolCodes) {
      expect(lookupCourse(code), `missing pool row for ${code}`).not.toBe(null);
    }
  });

  it("test_program_cs_bs_choose_tag_pools_have_at_least_one_candidate", () => {
    const tagPools = CS_BS.categories.filter((c) => c.kind === "choose_tag");
    for (const cat of tagPools) {
      if (cat.kind !== "choose_tag") continue;
      const hits = Object.values(COURSES).filter(
        (row) => row.tags && row.tags.some((t) => cat.choose_from.tags.includes(t)),
      );
      expect(
        hits.length,
        `no catalog course carries any tag in ${JSON.stringify(cat.choose_from.tags)} for ${cat.id}`,
      ).toBeGreaterThan(0);
    }
  });

  it("test_program_registry_returns_cs_bs", () => {
    expect(getProgram("cs_bs")).toBe(CS_BS);
  });

  it("test_program_registry_throws_on_unknown_id", () => {
    expect(() => getProgram("psych_ba")).toThrow(UnknownProgramError);
  });

  it("test_program_registry_parses_via_ProgramRequirements", () => {
    // Fixture must round-trip through the Zod schema.
    for (const program of listPrograms()) {
      expect(() => ProgramRequirements.parse(program)).not.toThrow();
    }
  });
});

describe("multi-program registry", () => {
  it("test_business_bs_math_bs_and_psych_bs_registered", () => {
    expect(getProgram("business_bs")).toBe(BUSINESS_BS);
    expect(getProgram("math_bs")).toBe(MATH_BS);
    expect(getProgram("psych_bs")).toBe(PSYCH_BS);
  });

  it("test_math_bs_fixed_courses_exist_in_catalog", () => {
    const fixedCodes = MATH_BS.categories
      .filter((c) => c.kind === "fixed")
      .flatMap((c) => c.courses);
    for (const code of fixedCodes) {
      expect(lookupCourse(code), `missing catalog row for ${code}`).not.toBe(null);
    }
    // Sanity — new catalog rows landed.
    expect(COURSES["MATH 120"]).toBeDefined();
    expect(COURSES["MATH 240"]).toBeDefined();
    expect(COURSES["MATH 340"]).toBeDefined();
  });

  it("test_math_bs_credits_meet_total", () => {
    const sum = MATH_BS.categories.reduce(
      (acc, c) => acc + c.credits_required,
      0,
    );
    expect(sum).toBeGreaterThanOrEqual(MATH_BS.total_credits_required);
  });

  it("test_business_bs_fixed_courses_exist_in_catalog", () => {
    const fixedCodes = BUSINESS_BS.categories
      .filter((c) => c.kind === "fixed")
      .flatMap((c) => c.courses);
    for (const code of fixedCodes) {
      expect(lookupCourse(code), `missing catalog row for ${code}`).not.toBe(null);
    }
  });

  it("test_psych_bs_fixed_courses_exist_in_catalog", () => {
    const fixedCodes = PSYCH_BS.categories
      .filter((c) => c.kind === "fixed")
      .flatMap((c) => c.courses);
    for (const code of fixedCodes) {
      expect(lookupCourse(code), `missing catalog row for ${code}`).not.toBe(null);
    }
    // Sanity — pin the smallest, most obvious catalog hit.
    expect(COURSES["PSY 101"]).toBeDefined();
  });

  it("test_business_bs_and_psych_bs_credits_meet_total", () => {
    for (const prog of [BUSINESS_BS, PSYCH_BS]) {
      const sum = prog.categories.reduce(
        (acc, c) => acc + c.credits_required,
        0,
      );
      expect(sum).toBeGreaterThanOrEqual(prog.total_credits_required);
    }
  });

  it("test_programIdForMajor_maps_common_labels", () => {
    expect(programIdForMajor("Computer Science")).toBe("cs_bs");
    expect(programIdForMajor("CS")).toBe("cs_bs");
    expect(programIdForMajor("cs")).toBe("cs_bs");
    expect(programIdForMajor("Business Administration")).toBe("business_bs");
    expect(programIdForMajor("BUS")).toBe("business_bs");
    expect(programIdForMajor("Psychology")).toBe("psych_bs");
    expect(programIdForMajor("psy")).toBe("psych_bs");
    expect(programIdForMajor("Mathematics")).toBe("math_bs");
    expect(programIdForMajor("MATH")).toBe("math_bs");
    expect(programIdForMajor("Applied Math")).toBe("math_bs");
    expect(programIdForMajor("Statistics")).toBe("math_bs");
  });

  it("test_programIdForMajor_returns_null_for_unknown", () => {
    expect(programIdForMajor(null)).toBeNull();
    expect(programIdForMajor("")).toBeNull();
    expect(programIdForMajor("Ancient History")).toBeNull();
  });

  it("test_programIdForMajor_accepts_direct_program_id", () => {
    expect(programIdForMajor("cs_bs")).toBe("cs_bs");
    expect(programIdForMajor("business_bs")).toBe("business_bs");
  });
});
