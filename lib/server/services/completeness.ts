// Profile completeness scorer — ported 1:1 from
// backend/app/services/completeness.py. Weighted checklist over
// students + student_finance + courses_taken. Weights sum to 100.

export interface CompletenessResult {
  score: number;
  missing_fields: string[];
  meets_80: boolean;
}

export const WEIGHTS: Readonly<Record<string, number>> = {
  program: 8,
  major: 6,
  expected_grad_semester: 6,
  gpa: 6,
  total_credits_completed: 8,
  international: 4,
  future_plan: 6,
  preferences: 4,
  courses_min_5: 12,
  courses_matched_80pct: 8,
  tuition_per_term: 8,
  current_aid_amount: 8,
  aid_types: 4,
  employment_hours_week: 6,
  dependent_status: 6,
};

// Guard against future drift — same invariant as the Python assert.
if (
  Object.values(WEIGHTS).reduce((acc, v) => acc + v, 0) !== 100
) {
  throw new Error("Completeness weights must sum to 100");
}

function has(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function hasValue(row: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!row) return false;
  return has(row[key]);
}

export function computeCompleteness(
  student: Record<string, unknown> | null | undefined,
  finance: Record<string, unknown> | null | undefined,
  courses: Array<Record<string, unknown>> | null | undefined,
): CompletenessResult {
  const s = student ?? {};
  const f = finance ?? {};
  const c = courses ?? [];

  const matchedCourses = c.filter((row) => row["catalog_course_id"]).length;
  const matchRatio = c.length > 0 ? matchedCourses / c.length : 0;

  const checks: Record<string, boolean> = {
    program: hasValue(s, "program"),
    major: hasValue(s, "major"),
    expected_grad_semester: hasValue(s, "expected_grad_semester"),
    gpa: hasValue(s, "gpa"),
    total_credits_completed: hasValue(s, "total_credits_completed"),
    // `international` counts once a boolean has been chosen (true *or* false);
    // `false` is a valid deliberate answer and shouldn't be treated as missing.
    international: s["international"] !== null && s["international"] !== undefined,
    future_plan: hasValue(s, "future_plan"),
    preferences: hasValue(s, "preferences"),
    courses_min_5: c.length >= 5,
    courses_matched_80pct: c.length > 0 && matchRatio >= 0.8,
    tuition_per_term: hasValue(f, "tuition_per_term"),
    current_aid_amount: hasValue(f, "current_aid_amount"),
    aid_types: hasValue(f, "aid_types"),
    employment_hours_week: hasValue(f, "employment_hours_week"),
    dependent_status: hasValue(f, "dependent_status"),
  };

  let score = 0;
  const missing: string[] = [];
  for (const key of Object.keys(WEIGHTS)) {
    if (checks[key]) score += WEIGHTS[key];
    else missing.push(key);
  }

  return { score, missing_fields: missing, meets_80: score >= 80 };
}
