/**
 * Human labels for the `missing_fields` slugs returned by the completeness
 * scorer. Keys mirror app/services/completeness.py WEIGHTS. Kept
 * frontend-side so the copy is tunable without a backend deploy.
 */

export const FIELD_LABELS: Record<string, string> = {
  program: "Program",
  major: "Major",
  expected_grad_semester: "Expected graduation semester",
  gpa: "GPA",
  total_credits_completed: "Total credits completed",
  international: "International status",
  future_plan: "Future plan / career interest",
  preferences: "Preferences",
  courses_min_5: "At least 5 courses on record",
  courses_matched_80pct: "≥80% of courses matched to catalog",
  tuition_per_term: "Tuition per term",
  current_aid_amount: "Current aid amount",
  aid_types: "Aid types",
  employment_hours_week: "Employment hours per week",
  dependent_status: "Dependent status",
};

export function labelFor(slug: string): string {
  return FIELD_LABELS[slug] ?? slug;
}
