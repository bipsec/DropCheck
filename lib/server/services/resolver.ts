// Deterministic resolver — turns a DropCheckInput into a StudentCtx.
// Ported 1:1 from backend/app/services/resolver.py.
//
// Pure function over the in-memory catalog. No agent may invent any of
// these values; every downstream claim must cite a field from the
// returned StudentCtx via `citePaths()`.

import {
  MAJORS,
  downstreamOf,
  isRequiredFor,
  lookupCourse,
  normalizeCourse,
  prereqsOf,
  type MajorId,
  type RequiredForResult,
  type Term,
} from "@/lib/server/data/catalog";
import { POLICY, type Policy } from "@/lib/server/data/policy";

export type Required3 = "yes" | "no" | "unsure";

export interface DropCheckInput {
  course: string;
  credits: number;
  required_for_major?: Required3;
  international?: boolean;
  major?: MajorId | null;
}

export interface CourseCtx {
  code: string;
  title: string;
  credits: number;
  terms_offered: readonly Term[];
  prereqs: readonly string[];
}

export interface StudentSummary {
  major: MajorId | null;
  major_name: string | null;
  total_credits: number;
  international: boolean;
  required_for_major: RequiredForResult;
  required_for_major_self_report: Required3;
}

export interface AfterDrop {
  credits: number;
  delta_from_full_time: number;
  delta_from_half_time: number;
  below_full_time: boolean;
  below_half_time: boolean;
}

export interface PrereqCtx {
  downstream: readonly string[];
  blocks_graduation: boolean;
  next_offered_terms: readonly Term[];
  only_offered_once: boolean;
}

export interface StudentCtx {
  course: CourseCtx;
  student: StudentSummary;
  after_drop: AfterDrop;
  prereqs: PrereqCtx;
  policy: Policy;
}

export function buildStudentContext(input: DropCheckInput): StudentCtx | null {
  const course = lookupCourse(input.course);
  if (course === null) return null;

  const code = normalizeCourse(input.course);
  const dropped = course.credits;
  const after = Math.max(0, input.credits - dropped);
  const downstream = downstreamOf(code);

  const derived = isRequiredFor(code, input.major ?? null);
  const selfReport: Required3 = input.required_for_major ?? "unsure";
  let requiredForMajor: RequiredForResult;
  if (derived !== "unknown") {
    requiredForMajor = derived;
  } else if (selfReport === "yes") {
    requiredForMajor = true;
  } else if (selfReport === "no") {
    requiredForMajor = false;
  } else {
    requiredForMajor = "unknown";
  }

  const majorName = input.major ? MAJORS[input.major].name : null;

  return {
    course: {
      code,
      title: course.title,
      credits: course.credits,
      terms_offered: course.terms_offered,
      prereqs: prereqsOf(code),
    },
    student: {
      major: input.major ?? null,
      major_name: majorName,
      total_credits: input.credits,
      international: input.international ?? false,
      required_for_major: requiredForMajor,
      required_for_major_self_report: selfReport,
    },
    after_drop: {
      credits: after,
      delta_from_full_time: after - POLICY.FULL_TIME_MIN,
      delta_from_half_time: after - POLICY.HALF_TIME_MIN,
      below_full_time: after < POLICY.FULL_TIME_MIN,
      below_half_time: after < POLICY.HALF_TIME_MIN,
    },
    prereqs: {
      downstream,
      blocks_graduation: downstream.length > 0 && requiredForMajor === true,
      next_offered_terms: course.terms_offered,
      only_offered_once: course.terms_offered.length === 1,
    },
    policy: POLICY,
  };
}

/**
 * CamelCase projection matching Python's `ctx_to_prompt_dict`.
 * The domain-agent prompts reference fields as `resolver.afterDrop.belowFullTime`
 * etc., so the projection layer is load-bearing and can't drift from the
 * strings baked into the prompts.
 */
export function ctxToPromptDict(ctx: StudentCtx): Record<string, unknown> {
  return {
    course: {
      code: ctx.course.code,
      title: ctx.course.title,
      credits: ctx.course.credits,
      termsOffered: [...ctx.course.terms_offered],
      prereqs: [...ctx.course.prereqs],
    },
    student: {
      major: ctx.student.major,
      majorName: ctx.student.major_name,
      totalCredits: ctx.student.total_credits,
      international: ctx.student.international,
      requiredForMajor: ctx.student.required_for_major,
      requiredForMajorSelfReport: ctx.student.required_for_major_self_report,
    },
    afterDrop: {
      credits: ctx.after_drop.credits,
      deltaFromFullTime: ctx.after_drop.delta_from_full_time,
      deltaFromHalfTime: ctx.after_drop.delta_from_half_time,
      belowFullTime: ctx.after_drop.below_full_time,
      belowHalfTime: ctx.after_drop.below_half_time,
    },
    prereqs: {
      downstream: [...ctx.prereqs.downstream],
      blocksGraduation: ctx.prereqs.blocks_graduation,
      nextOfferedTerms: [...ctx.prereqs.next_offered_terms],
      onlyOfferedOnce: ctx.prereqs.only_offered_once,
    },
    policy: {
      FULL_TIME_MIN: ctx.policy.FULL_TIME_MIN,
      HALF_TIME_MIN: ctx.policy.HALF_TIME_MIN,
      F1_FULL_LOAD_MIN: ctx.policy.F1_FULL_LOAD_MIN,
      SAP_MIN_PACE: ctx.policy.SAP_MIN_PACE,
    },
  };
}

/** All valid `resolver.*` field paths a downstream agent may cite. */
export function citePaths(): readonly string[] {
  return [
    "course.code", "course.title", "course.credits",
    "course.termsOffered", "course.prereqs",
    "student.major", "student.majorName", "student.totalCredits",
    "student.international", "student.requiredForMajor",
    "afterDrop.credits", "afterDrop.deltaFromFullTime",
    "afterDrop.deltaFromHalfTime",
    "afterDrop.belowFullTime", "afterDrop.belowHalfTime",
    "prereqs.downstream", "prereqs.blocksGraduation",
    "prereqs.nextOfferedTerms", "prereqs.onlyOfferedOnce",
    "policy.FULL_TIME_MIN", "policy.HALF_TIME_MIN",
    "policy.F1_FULL_LOAD_MIN", "policy.SAP_MIN_PACE",
  ];
}
