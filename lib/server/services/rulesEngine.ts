// Rules engine — pure, deterministic, no I/O.
//
// Over ProgramRequirements + StudentRecord, answers:
//   - Which courses are already satisfied? (`satisfiedSet`)
//   - What still needs to happen in each requirement category? (`remainingRequirements`)
//   - Which course has the largest downstream cascade? (`bottleneckScore`)
//   - If a student drops a course, what breaks? (`impactOfDrop`)
//
// The LLM advisor in Phase 7 never bypasses this — every recommendation
// there is post-hoc explanation of what this module already decided.
//
// Phase 4 will supply a richer `priorityFn` (§2.4 resolver with
// contradiction flagging). Phase 2 threads it as a parameter and
// defaults to a straight source-priority lookup — waiver > transcript >
// manual > transfer.

import {
  COURSES,
  downstreamOf,
  normalizeCourse,
  type CatalogCourse,
} from "@/lib/server/data/catalog";
import type {
  ProgramRequirements,
  RequirementCategory,
} from "@/lib/server/schemas/track";
import type { StudentRecord } from "@/lib/server/schemas/studentRecord";

// --- Types -----------------------------------------------------------------

export type SatisfactionSource =
  | "waiver"
  | "transcript"
  | "manual"
  | "transfer";

export type PriorityFn = (
  code: string,
  student: StudentRecord,
) => SatisfactionSource | null;

export interface RequirementNode {
  course: CatalogCourse | null; // null when a pool references an unknown code
  categoryIds: string[];
}

export interface RequirementGraph {
  nodes: Map<string, RequirementNode>;
  /** category id -> ordered list of codes that could satisfy it. */
  categoryIndex: Map<string, string[]>;
  categories: RequirementCategory[];
}

export interface SatisfiedResult {
  satisfied: Set<string>;
  byCategory: Map<string, string[]>;
  bySource: Map<string, SatisfactionSource>;
}

export type StillOwed =
  | { kind: "fixed"; codes: string[] }
  | {
      kind: "pool_count";
      options: string[];
      picks_needed: number;
      credits_still_needed: number;
    }
  | { kind: "pool_tag"; options: string[]; credits_still_needed: number }
  | { kind: "satisfied" };

export interface CategoryProgress {
  id: string;
  label: string;
  kind: RequirementCategory["kind"];
  credits_needed: number;
  credits_satisfied: number;
  still_owed: StillOwed;
}

export interface DropImpact {
  blocked: string[];
  categoriesAtRisk: string[];
}

// --- Default priority function --------------------------------------------
// Straight §2.4 walk without contradiction flagging. Phase 4 replaces this
// with a richer resolver.

export const defaultPriority: PriorityFn = (code, student) => {
  const target = normalizeCourse(code);
  if (student.waivers.includes(target)) return "waiver";
  const transcript = student.completed_courses.find(
    (c) => c.course_code === target && c.source === "transcript",
  );
  if (transcript) return "transcript";
  const manual = student.completed_courses.find(
    (c) => c.course_code === target && c.source === "manual",
  );
  if (manual) return "manual";
  if (
    student.transfer_credits.some(
      (t) => t.equivalent_course_code === target,
    )
  ) {
    return "transfer";
  }
  return null;
};

// --- buildRequirementGraph -------------------------------------------------

export function buildRequirementGraph(
  program: ProgramRequirements,
): RequirementGraph {
  const nodes = new Map<string, RequirementNode>();
  const categoryIndex = new Map<string, string[]>();

  const attach = (code: string, catId: string): string => {
    const normalized = normalizeCourse(code);
    let node = nodes.get(normalized);
    if (!node) {
      node = { course: COURSES[normalized] ?? null, categoryIds: [] };
      nodes.set(normalized, node);
    }
    if (!node.categoryIds.includes(catId)) node.categoryIds.push(catId);
    return normalized;
  };

  for (const cat of program.categories) {
    const codes: string[] = [];
    if (cat.kind === "fixed") {
      for (const code of cat.courses) codes.push(attach(code, cat.id));
    } else if (cat.kind === "choose_count") {
      for (const code of cat.choose_from.any_of) codes.push(attach(code, cat.id));
    } else {
      // choose_tag — walk catalog for tag hits.
      for (const [code, row] of Object.entries(COURSES)) {
        if (row.tags && row.tags.some((t) => cat.choose_from.tags.includes(t))) {
          codes.push(attach(code, cat.id));
        }
      }
    }
    // Stable order: sort codes so downstream loops are deterministic across runs.
    codes.sort();
    categoryIndex.set(cat.id, codes);
  }

  return { nodes, categoryIndex, categories: [...program.categories] };
}

// --- satisfiedSet ----------------------------------------------------------

export function satisfiedSet(
  student: StudentRecord,
  program: ProgramRequirements,
  priorityFn: PriorityFn = defaultPriority,
): SatisfiedResult {
  const graph = buildRequirementGraph(program);
  const satisfied = new Set<string>();
  const bySource = new Map<string, SatisfactionSource>();

  // Walk every code referenced by the program; ask the priority function
  // whether the student has it via any source.
  for (const code of graph.nodes.keys()) {
    const src = priorityFn(code, student);
    if (src !== null) {
      satisfied.add(code);
      bySource.set(code, src);
    }
  }

  const byCategory = new Map<string, string[]>();
  for (const cat of program.categories) {
    const pool = graph.categoryIndex.get(cat.id) ?? [];
    byCategory.set(
      cat.id,
      pool.filter((c) => satisfied.has(c)),
    );
  }

  return { satisfied, byCategory, bySource };
}

// --- remainingRequirements -------------------------------------------------

export function remainingRequirements(
  program: ProgramRequirements,
  satisfied: SatisfiedResult,
): CategoryProgress[] {
  const graph = buildRequirementGraph(program);
  const results: CategoryProgress[] = [];

  const creditsOf = (code: string): number => {
    return graph.nodes.get(code)?.course?.credits ?? 0;
  };

  for (const cat of program.categories) {
    const done = satisfied.byCategory.get(cat.id) ?? [];
    const creditsSatisfied = done.reduce((acc, c) => acc + creditsOf(c), 0);

    let stillOwed: StillOwed;
    if (creditsSatisfied >= cat.credits_required) {
      stillOwed = { kind: "satisfied" };
    } else if (cat.kind === "fixed") {
      const missing = cat.courses
        .map(normalizeCourse)
        .filter((c) => !done.includes(c));
      stillOwed = { kind: "fixed", codes: missing };
    } else if (cat.kind === "choose_count") {
      const options = (graph.categoryIndex.get(cat.id) ?? []).filter(
        (c) => !done.includes(c),
      );
      const picksNeeded = Math.max(0, cat.choose_from.count - done.length);
      stillOwed = {
        kind: "pool_count",
        options,
        picks_needed: picksNeeded,
        credits_still_needed: cat.credits_required - creditsSatisfied,
      };
    } else {
      const options = (graph.categoryIndex.get(cat.id) ?? []).filter(
        (c) => !done.includes(c),
      );
      stillOwed = {
        kind: "pool_tag",
        options,
        credits_still_needed: cat.credits_required - creditsSatisfied,
      };
    }

    results.push({
      id: cat.id,
      label: cat.label,
      kind: cat.kind,
      credits_needed: cat.credits_required,
      credits_satisfied: creditsSatisfied,
      still_owed: stillOwed,
    });
  }
  return results;
}

// --- bottleneckScore -------------------------------------------------------

/**
 * Transitive downstream count over the global catalog. Larger score →
 * more courses depend on this one, so the scheduler in Phase 3 wants to
 * front-load high-score courses.
 */
export function bottleneckScore(code: string): number {
  return downstreamOf(code).length;
}

// --- impactOfDrop ----------------------------------------------------------

export function impactOfDrop(
  code: string,
  program: ProgramRequirements,
  _satisfied: SatisfiedResult,
): DropImpact {
  const target = normalizeCourse(code);
  const graph = buildRequirementGraph(program);
  // Every downstream course, filtered to those the program actually cares about.
  const blocked = downstreamOf(target).filter((c) => graph.nodes.has(c));

  const risk = new Set<string>();
  for (const [catId, codes] of graph.categoryIndex) {
    if (codes.includes(target)) risk.add(catId);
    if (blocked.some((c) => codes.includes(c))) risk.add(catId);
  }

  return { blocked, categoriesAtRisk: [...risk].sort() };
}
