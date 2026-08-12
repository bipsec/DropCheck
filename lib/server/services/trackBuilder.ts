// Deterministic term-by-term scheduler.
// Implements updated_plan.md §4.3. Pure — no I/O, no LLM, no time.
//
// Consumes ProgramRequirements + StudentRecord and returns a Track. Both
// entry points (fresh + in-progress) call this; the LLM never
// regenerates a plan in prose.

import { COURSES, normalizeCourse } from "@/lib/server/data/catalog";
import type {
  PlannedCourse,
  PlannedTerm,
  ProgramRequirements,
  Season,
  Term,
  Track,
  UnresolvedSlot,
} from "@/lib/server/schemas/track";
import type { StudentRecord } from "@/lib/server/schemas/studentRecord";
import {
  buildRequirementGraph,
  defaultPriority,
  bottleneckScore,
  remainingRequirements,
  satisfiedSet,
  type PriorityFn,
} from "@/lib/server/services/rulesEngine";
import { nextTerm } from "@/lib/server/services/termSequence";

const MAX_TERMS = 30; // safety bound: ~10 years of terms (updated_plan.md §4.3)
const DEFAULT_START_TERM: Term = { season: "Fall", year: 2026 };

export interface BuildTrackOptions {
  student: StudentRecord;
  program: ProgramRequirements;
  /** Optional. Defaults to Fall 2026 for the "generic" institution. */
  startTerm?: Term;
  priorityFn?: PriorityFn;
}

export function buildTrack(opts: BuildTrackOptions): Track {
  const { student, program } = opts;
  const priorityFn = opts.priorityFn ?? defaultPriority;
  const startTerm = opts.startTerm ?? DEFAULT_START_TERM;

  const graph = buildRequirementGraph(program);
  const satisfied = satisfiedSet(student, program, priorityFn);

  // Everything in the program that's still needed. `remainingRequirements`
  // handles pool credit accounting; we consume the same view.
  const progress = remainingRequirements(program, satisfied);

  // Working set of {code -> category_id} we still need to schedule. Priority
  // is given to categories that aren't yet satisfied. Once a course is
  // planned, it's removed from the pool.
  const owedByCode = collectOwed(program, graph, satisfied);

  const completedOrPlanned = new Set<string>(satisfied.satisfied);
  const plannedTerms: PlannedTerm[] = [];
  let currentTerm = startTerm;
  let cumulative = totalCreditsSatisfied(satisfied, graph);

  let iterations = 0;
  while (owedByCode.size > 0 && iterations < MAX_TERMS) {
    iterations += 1;

    const eligible: EligibleCourse[] = [];
    for (const [code, category_id] of owedByCode) {
      const row = graph.nodes.get(code)?.course;
      if (!row) continue; // unknown code — skip; surfaces as unresolved
      if (!row.terms_offered.includes(currentTerm.season as Season)) continue;
      const prereqs = row.prerequisites;
      if (
        prereqs.length > 0 &&
        !prereqs.every((p) => completedOrPlanned.has(normalizeCourse(p)))
      ) {
        continue;
      }
      eligible.push({
        code,
        category_id,
        credits: row.credits,
        bottleneck: bottleneckScore(code),
        isCore: isCoreCategory(program, category_id),
        catKind: kindOf(program, category_id),
      });
    }

    if (eligible.length === 0) {
      // No course eligible this term. Skip forward — but if this happens
      // MAX_TERMS in a row we bail so we never spin forever.
      plannedTerms.push({
        term: currentTerm,
        courses: [],
        credits_this_term: 0,
        cumulative_credits: cumulative,
      });
      currentTerm = nextTerm(currentTerm);
      continue;
    }

    const chosen = pickUpToCreditCap(eligible, student.max_credits_per_term);
    const plannedCourses: PlannedCourse[] = chosen.map((c) => ({
      course_code: c.code,
      credits: c.credits,
      category_id: c.category_id,
      chosen_reason: chosenReasonOf(c.catKind),
    }));

    let termCredits = 0;
    for (const c of chosen) {
      termCredits += c.credits;
      completedOrPlanned.add(c.code);
      owedByCode.delete(c.code);
    }
    cumulative += termCredits;

    plannedTerms.push({
      term: currentTerm,
      courses: plannedCourses,
      credits_this_term: termCredits,
      cumulative_credits: cumulative,
    });

    currentTerm = nextTerm(currentTerm);
  }

  const unresolved = buildUnresolved(progress, completedOrPlanned);

  const projectedGrad =
    plannedTerms.length > 0
      ? plannedTerms[plannedTerms.length - 1].term
      : startTerm;

  return {
    program_id: program.program_id,
    generated_for: satisfied.satisfied.size > 0 ? "in_progress" : "fresh",
    terms: plannedTerms,
    total_terms: plannedTerms.length,
    projected_grad_term: projectedGrad,
    unresolved,
  };
}

// --- Helpers ---------------------------------------------------------------

interface EligibleCourse {
  code: string;
  category_id: string;
  credits: number;
  bottleneck: number;
  isCore: boolean;
  catKind: "fixed" | "choose_count" | "choose_tag";
}

/**
 * Stable-sort + greedy-fill pick. Priorities (updated_plan.md §4.3):
 *   1. bottleneck-first — schedule courses with the biggest downstream first
 *   2. core-before-elective — fixed categories outrank pools
 *   3. gen-ed spread — tag pools evenly (approximated by lower priority)
 * Ties broken lexicographically by course_code so tests are stable.
 */
export function pickUpToCreditCap(
  eligible: EligibleCourse[],
  cap: number,
): EligibleCourse[] {
  const sorted = [...eligible].sort((a, b) => {
    if (a.isCore !== b.isCore) return a.isCore ? -1 : 1; // core first
    if (a.bottleneck !== b.bottleneck) return b.bottleneck - a.bottleneck;
    // Fixed → choose_count → choose_tag when everything else ties.
    const kindOrder = { fixed: 0, choose_count: 1, choose_tag: 2 };
    if (kindOrder[a.catKind] !== kindOrder[b.catKind]) {
      return kindOrder[a.catKind] - kindOrder[b.catKind];
    }
    return a.code.localeCompare(b.code);
  });

  const picked: EligibleCourse[] = [];
  let remaining = cap;
  for (const c of sorted) {
    if (c.credits <= remaining) {
      picked.push(c);
      remaining -= c.credits;
    }
    if (remaining <= 0) break;
  }
  return picked;
}

function collectOwed(
  program: ProgramRequirements,
  graph: ReturnType<typeof buildRequirementGraph>,
  satisfied: ReturnType<typeof satisfiedSet>,
): Map<string, string> {
  const owed = new Map<string, string>();
  for (const cat of program.categories) {
    if (cat.kind === "fixed") {
      const done = satisfied.byCategory.get(cat.id) ?? [];
      for (const code of cat.courses.map(normalizeCourse)) {
        if (!done.includes(code) && !owed.has(code)) owed.set(code, cat.id);
      }
    } else if (cat.kind === "choose_count") {
      // Pool: enqueue every option; the scheduler picks the best ones and
      // stops when this category's credits are met. We track credits
      // outside the map by removing options as they're planned.
      const done = satisfied.byCategory.get(cat.id) ?? [];
      const stillNeeded = cat.credits_required - done.reduce((acc, c) => {
        return acc + (graph.nodes.get(c)?.course?.credits ?? 0);
      }, 0);
      if (stillNeeded <= 0) continue;
      for (const code of cat.choose_from.any_of.map(normalizeCourse)) {
        if (!done.includes(code) && !owed.has(code)) owed.set(code, cat.id);
      }
    } else {
      // choose_tag — enqueue tag-matching catalog courses.
      const done = satisfied.byCategory.get(cat.id) ?? [];
      const stillNeeded = cat.credits_required - done.reduce((acc, c) => {
        return acc + (graph.nodes.get(c)?.course?.credits ?? 0);
      }, 0);
      if (stillNeeded <= 0) continue;
      for (const [code, row] of Object.entries(COURSES)) {
        if (
          row.tags &&
          row.tags.some((t) => cat.choose_from.tags.includes(t)) &&
          !done.includes(code) &&
          !owed.has(code)
        ) {
          owed.set(code, cat.id);
        }
      }
    }
  }
  return owed;
}

function totalCreditsSatisfied(
  satisfied: ReturnType<typeof satisfiedSet>,
  graph: ReturnType<typeof buildRequirementGraph>,
): number {
  let sum = 0;
  for (const code of satisfied.satisfied) {
    sum += graph.nodes.get(code)?.course?.credits ?? 0;
  }
  return sum;
}

function isCoreCategory(
  program: ProgramRequirements,
  categoryId: string,
): boolean {
  const cat = program.categories.find((c) => c.id === categoryId);
  return cat?.kind === "fixed";
}

function kindOf(
  program: ProgramRequirements,
  categoryId: string,
): EligibleCourse["catKind"] {
  const cat = program.categories.find((c) => c.id === categoryId);
  return cat?.kind ?? "choose_tag";
}

function chosenReasonOf(
  catKind: EligibleCourse["catKind"],
): PlannedCourse["chosen_reason"] {
  if (catKind === "fixed") return "required";
  if (catKind === "choose_count") return "pool_fill";
  return "gen_ed_fill";
}

function buildUnresolved(
  progress: ReturnType<typeof remainingRequirements>,
  planned: Set<string>,
): UnresolvedSlot[] {
  const out: UnresolvedSlot[] = [];
  for (const cat of progress) {
    if (cat.still_owed.kind === "satisfied") continue;
    // Only pools become "unresolved slots" — a fixed category with
    // missing courses is a hard failure, not an unresolved choice.
    // NOTE: empty `options` after filtering is still surfaced — it
    // signals "this category is unsatisfied and the catalog is out of
    // options" which is exactly what a real student needs to see
    // (typically: register another program, add courses, or upload a
    // richer catalog).
    if (
      cat.still_owed.kind === "pool_count" ||
      cat.still_owed.kind === "pool_tag"
    ) {
      const remaining = cat.still_owed.options.filter((c) => !planned.has(c));
      const stillCredits = cat.still_owed.credits_still_needed;
      out.push({
        category_id: cat.id,
        credits_needed: Math.max(0, stillCredits),
        options: remaining,
      });
    }
  }
  return out;
}
