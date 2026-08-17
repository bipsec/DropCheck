// Static policy constants and human-contact strings.
// Ported 1:1 from backend/app/data/policy.py — these are the only
// credit-hour thresholds the resolver and fallback phrasing are allowed
// to cite. Keeping them as compile-time constants (not env vars) so tests
// don't drift and prompts can quote the numbers verbatim.

export const POLICY = {
  FULL_TIME_MIN: 12,
  HALF_TIME_MIN: 6,
  F1_FULL_LOAD_MIN: 12,
  SAP_MIN_PACE: 0.67,
} as const;

export type Policy = typeof POLICY;

export const CONTACTS = {
  advising: "Academic advising, Reed Hall 214 · advising@example.edu",
  financial_aid: "Financial Aid Office, Student Center 118 · (555) 013-4400",
  dso: "International Student Services, Whitaker Hall 3F · iss@example.edu",
} as const;
