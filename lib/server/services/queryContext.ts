// Query-time context builder — 1:1 port of
// backend/app/services/query_context.py.
//
// Persistent-data analog of services/resolver.buildStudentContext: pulls
// the student's actual profile + finance + courses_taken + catalog row
// and assembles the exact camelCase dict the domain agent prompts expect.
// The field paths in this dict must line up with `citePaths()` below or
// the citation-grounding check will drop legit citations.

import { POLICY } from "@/lib/server/data/policy";
import { getSupabase } from "@/lib/server/supabase";
import { computeCompleteness } from "@/lib/server/services/completeness";

export class QueryContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryContextError";
  }
}

export interface QueryContextBundle {
  student_id: string;
  course_code: string;
  student: Record<string, unknown>;
  finance: Record<string, unknown> | null;
  courses_taken: Array<Record<string, unknown>>;
  catalog_course: Record<string, unknown>;
  downstream: string[];
  importance: string;
  completeness_score: number;
  completeness_meets_80: boolean;
}

function clientOrRaise() {
  const sb = getSupabase();
  if (!sb) {
    throw new QueryContextError(
      "Supabase not configured — cannot build query context.",
    );
  }
  return sb;
}

export async function buildQueryContext(
  studentId: string,
  catalogCourseId: string,
): Promise<QueryContextBundle> {
  const sb = clientOrRaise();

  const studentRow = await sb
    .from("students")
    .select("*")
    .eq("id", studentId)
    .limit(1);
  if (studentRow.error) {
    throw new QueryContextError(`students lookup failed: ${studentRow.error.message}`);
  }
  if (!studentRow.data || studentRow.data.length === 0) {
    throw new QueryContextError(`student ${JSON.stringify(studentId)} not found`);
  }
  const student = studentRow.data[0] as Record<string, unknown>;

  const financeRow = await sb
    .from("student_finance")
    .select("*")
    .eq("student_id", studentId)
    .limit(1);
  const finance =
    financeRow.data && financeRow.data.length > 0
      ? (financeRow.data[0] as Record<string, unknown>)
      : null;

  const coursesRow = await sb
    .from("courses_taken")
    .select("*")
    .eq("student_id", studentId);
  const courses = (coursesRow.data ?? []) as Array<Record<string, unknown>>;

  const catalogRow = await sb
    .from("course_catalog")
    .select(
      "id, course_code, title, description, credits, terms_offered, " +
        "prerequisites, required_for_programs, level",
    )
    .eq("id", catalogCourseId)
    .limit(1);
  if (catalogRow.error) {
    throw new QueryContextError(`catalog lookup failed: ${catalogRow.error.message}`);
  }
  if (!catalogRow.data || catalogRow.data.length === 0) {
    throw new QueryContextError(
      `catalog course ${JSON.stringify(catalogCourseId)} not found`,
    );
  }
  const catalog = catalogRow.data[0] as unknown as Record<string, unknown>;

  const downstream = await downstreamOf(sb, String(catalog.course_code));
  const importance = importanceLabel(student, catalog, downstream);

  const completeness = computeCompleteness(student, finance, courses);

  return {
    student_id: studentId,
    course_code: String(catalog.course_code),
    student,
    finance,
    courses_taken: courses,
    catalog_course: catalog,
    downstream,
    importance,
    completeness_score: completeness.score,
    completeness_meets_80: completeness.meets_80,
  };
}

// Transitive downstream lookup over the catalog's `prerequisites` arrays.
async function downstreamOf(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  courseCode: string,
): Promise<string[]> {
  const hits = await sb
    .from("course_catalog")
    .select("course_code, prerequisites")
    .contains("prerequisites", [courseCode]);
  if (!hits.data || hits.data.length === 0) return [];

  const visited = new Set<string>();
  const frontier: string[] = (hits.data as Array<{ course_code: string }>).map(
    (row) => row.course_code,
  );
  while (frontier.length) {
    const current = frontier.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const deeper = await sb
      .from("course_catalog")
      .select("course_code")
      .contains("prerequisites", [current]);
    for (const row of (deeper.data ?? []) as Array<{ course_code: string }>) {
      if (!visited.has(row.course_code)) frontier.push(row.course_code);
    }
  }
  return [...visited].sort();
}

function importanceLabel(
  student: Record<string, unknown>,
  catalog: Record<string, unknown>,
  downstream: string[],
): string {
  const program = (student.major ?? student.program) as string | null | undefined;
  const requiredFor = (catalog.required_for_programs ?? []) as string[];
  const isRequired = Boolean(program) && requiredFor.includes(program!);
  const downstreamRequired = isRequired && downstream.some((d) => requiredFor.includes(d));

  if (downstreamRequired) return "critical";
  if (isRequired) return "high";
  if (downstream.length > 0) return "medium";
  return "low";
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0.0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0.0;
}

export function toResolverDict(bundle: QueryContextBundle): Record<string, unknown> {
  const student = bundle.student;
  const finance = bundle.finance ?? {};
  const catalog = bundle.catalog_course;

  const totalCredits = num(student.total_credits_completed);
  const droppedCredits = num(catalog.credits);
  const afterCredits = Math.max(0.0, totalCredits - droppedCredits);

  const termsOffered = (catalog.terms_offered ?? []) as string[];
  const prereqs = (catalog.prerequisites ?? []) as string[];
  const downstream = bundle.downstream;

  let requiredForMajor: boolean | string = "unknown";
  const program = (student.major ?? student.program) as string | null | undefined;
  if (program) {
    const requiredFor = (catalog.required_for_programs ?? []) as string[];
    requiredForMajor = requiredFor.includes(program);
  }

  return {
    course: {
      code: catalog.course_code,
      title: catalog.title ?? null,
      credits: droppedCredits,
      termsOffered: termsOffered,
      prereqs: prereqs,
      description: catalog.description ?? null,
      level: catalog.level ?? null,
    },
    student: {
      major: student.major ?? null,
      majorName: student.major ?? null,
      totalCredits: totalCredits,
      international: Boolean(student.international),
      requiredForMajor,
      program: student.program ?? null,
      expectedGradSemester: student.expected_grad_semester ?? null,
      gpa: num(student.gpa),
      futurePlan: student.future_plan ?? null,
    },
    finance: {
      tuitionPerTerm: num(finance.tuition_per_term),
      currentAidAmount: num(finance.current_aid_amount),
      aidTypes: (finance.aid_types ?? []) as unknown[],
      sapStatus: finance.sap_status ?? null,
      employmentHoursWeek: finance.employment_hours_week ?? null,
      dependentStatus: finance.dependent_status ?? null,
    },
    afterDrop: {
      credits: afterCredits,
      deltaFromFullTime: afterCredits - POLICY.FULL_TIME_MIN,
      deltaFromHalfTime: afterCredits - POLICY.HALF_TIME_MIN,
      belowFullTime: afterCredits < POLICY.FULL_TIME_MIN,
      belowHalfTime: afterCredits < POLICY.HALF_TIME_MIN,
    },
    prereqs: {
      downstream,
      blocksGraduation: downstream.length > 0 && requiredForMajor === true,
      nextOfferedTerms: termsOffered,
      onlyOfferedOnce: termsOffered.length === 1,
    },
    policy: {
      FULL_TIME_MIN: POLICY.FULL_TIME_MIN,
      HALF_TIME_MIN: POLICY.HALF_TIME_MIN,
      F1_FULL_LOAD_MIN: POLICY.F1_FULL_LOAD_MIN,
      SAP_MIN_PACE: POLICY.SAP_MIN_PACE,
    },
    context: {
      importance: bundle.importance,
      completenessScore: bundle.completeness_score,
      completenessMeets80: bundle.completeness_meets_80,
    },
  };
}

// Full whitelist of citation paths agents may reference — superset of the
// resolver's paths, adds finance.* and context.*.
export function citePaths(): readonly string[] {
  return [
    "course.code", "course.title", "course.credits",
    "course.termsOffered", "course.prereqs",
    "course.description", "course.level",
    "student.major", "student.majorName", "student.totalCredits",
    "student.international", "student.requiredForMajor",
    "student.program", "student.expectedGradSemester", "student.gpa",
    "student.futurePlan",
    "finance.tuitionPerTerm", "finance.currentAidAmount",
    "finance.aidTypes", "finance.sapStatus",
    "finance.employmentHoursWeek", "finance.dependentStatus",
    "afterDrop.credits", "afterDrop.deltaFromFullTime",
    "afterDrop.deltaFromHalfTime",
    "afterDrop.belowFullTime", "afterDrop.belowHalfTime",
    "prereqs.downstream", "prereqs.blocksGraduation",
    "prereqs.nextOfferedTerms", "prereqs.onlyOfferedOnce",
    "policy.FULL_TIME_MIN", "policy.HALF_TIME_MIN",
    "policy.F1_FULL_LOAD_MIN", "policy.SAP_MIN_PACE",
    "context.importance", "context.completenessScore",
    "context.completenessMeets80",
  ];
}
