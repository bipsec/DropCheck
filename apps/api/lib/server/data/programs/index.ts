// Program registry. One fixture ships (cs_bs); adding a program means
// dropping another file here and adding it to the map below. Downstream
// code — track builder, rules engine, LLM advisor — only touches
// getProgram(); it never imports a program fixture directly.

import { ProgramRequirements } from "@/lib/server/schemas/track";
import { BUSINESS_BS } from "./business_bs";
import { CS_BS } from "./cs_bs";
import { MATH_BS } from "./math_bs";
import { PSYCH_BS } from "./psych_bs";

export class UnknownProgramError extends Error {
  constructor(programId: string) {
    super(`Unknown program_id: ${JSON.stringify(programId)}`);
    this.name = "UnknownProgramError";
  }
}

const PROGRAMS: Readonly<Record<string, ProgramRequirements>> = {
  cs_bs: CS_BS,
  business_bs: BUSINESS_BS,
  math_bs: MATH_BS,
  psych_bs: PSYCH_BS,
};

/** Human-friendly labels for the program picker. */
export const PROGRAM_LABELS: Readonly<Record<string, string>> = {
  cs_bs: "Computer Science (BS)",
  business_bs: "Business Administration (BS)",
  math_bs: "Mathematics (BS)",
  psych_bs: "Psychology (BS)",
};

/**
 * Best-effort mapping from a free-text `students.major` (or `program`)
 * to a stable `program_id`. Case-insensitive substring match on the
 * common keywords students actually type. Returns null when nothing
 * plausible fits — the caller then falls back to a picker.
 */
export function programIdForMajor(
  major: string | null | undefined,
): string | null {
  if (!major) return null;
  const m = String(major).trim().toLowerCase();
  if (!m) return null;

  // Direct program_id hits (e.g. "cs_bs") always win.
  if (m in PROGRAMS) return m;

  if (m.includes("computer") || m === "cs" || m.startsWith("cs ")) return "cs_bs";
  if (m.includes("business") || m.includes("bus")) return "business_bs";
  // Math has to be checked before we assume anything with "math" inside it
  // (e.g. "applied math") — putting this before "psych" also avoids a
  // future "psychmath" false-positive on the psych branch.
  if (
    m.includes("math") ||
    m === "mth" ||
    m.startsWith("math ") ||
    m.includes("statistics") ||
    m.includes("applied math")
  ) {
    return "math_bs";
  }
  if (m.includes("psych") || m === "psy" || m.startsWith("psy ")) return "psych_bs";
  return null;
}

// --- Code namespace -------------------------------------------------------
//
// Every fixture above is `institution_id: "generic"` and uses invented
// codes (CS 101, MATH 210, PSY 101). The real catalog served by
// get_course uses Purdue's actual codes (CS 18000, MA 26100). Those two
// namespaces are indistinguishable by shape, which is how a plan built
// from a fixture got presented as a Purdue plan and only disclosed as
// generic afterwards.
//
// So any tool that emits fixture-derived course codes stamps the payload
// with its namespace. The advisor is told to lead with `advisory`, and the
// frontend renders it as a banner regardless — a plan can't reach the
// student unlabelled.

export const GENERIC_CODE_ADVISORY =
  "These are generic archetype course codes, not real institution course " +
  "codes — the student cannot register from them. Use this plan for shape " +
  "and sequencing only, and say so BEFORE presenting it, not after.";

export function codeNamespaceOf(
  program: Pick<ProgramRequirements, "institution_id">,
): Record<string, unknown> {
  const generic = program.institution_id === "generic";
  return {
    code_namespace: generic ? "generic" : "institution",
    ...(generic ? { advisory: GENERIC_CODE_ADVISORY } : {}),
  };
}

export function getProgram(programId: string): ProgramRequirements {
  const row = PROGRAMS[programId];
  if (!row) throw new UnknownProgramError(programId);
  return row;
}

export function listPrograms(): ProgramRequirements[] {
  return Object.values(PROGRAMS);
}

export function listProgramIds(): string[] {
  return Object.keys(PROGRAMS);
}
