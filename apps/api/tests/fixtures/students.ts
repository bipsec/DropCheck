// Shared StudentRecord factories for rules-engine and track-builder
// tests. Kept in one place so any drift in the StudentRecord shape
// shows up as a single test-fixture edit.

import { StudentRecord } from "@/lib/server/schemas/studentRecord";

function make(
  overrides: Partial<StudentRecord> & { student_id?: string } = {},
): StudentRecord {
  return StudentRecord.parse({
    student_id: overrides.student_id ?? "stu-fixture",
    program_id: "cs_bs",
    entry_type: "fresh",
    max_credits_per_term: 15,
    ...overrides,
  });
}

/** A fresh student with no completed anything. */
export function freshStudent(): StudentRecord {
  return make();
}

/** In-progress student who's completed the intro CS chain via transcript. */
export function transcriptCsStudent(): StudentRecord {
  return make({
    entry_type: "transcript",
    completed_courses: [
      { course_code: "CS 101", grade: "A", credits: 3, source: "transcript" },
      { course_code: "CS 201", grade: "B", credits: 3, source: "transcript" },
      {
        course_code: "MATH 210",
        grade: "B+",
        credits: 3,
        source: "transcript",
      },
    ],
  });
}

/** Same courses as transcriptCsStudent but entered manually. */
export function manualCsStudent(): StudentRecord {
  return make({
    entry_type: "manual",
    completed_courses: [
      { course_code: "CS 101", credits: 3, source: "manual" },
      { course_code: "CS 201", credits: 3, source: "manual" },
      { course_code: "MATH 210", credits: 3, source: "manual" },
    ],
  });
}

/** A student who explicitly waives CS 201 (so CS 301 becomes reachable). */
export function waiverStudent(): StudentRecord {
  return make({
    entry_type: "manual",
    waivers: ["CS 201"],
  });
}

/** Student with a transfer credit for CS 101. */
export function transferStudent(): StudentRecord {
  return make({
    entry_type: "manual",
    transfer_credits: [
      {
        external_course: "Intro to CS @ Community College",
        equivalent_course_code: "CS 101",
        credits: 3,
      },
    ],
  });
}
