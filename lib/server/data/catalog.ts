// In-memory demo catalog + prereq graph + program requirements.
// Ported 1:1 from backend/app/data/catalog.py.
//
// The Supabase-backed catalog (see services/catalog.ts) is authoritative
// at query time; this static dataset is only used by the deterministic
// resolver + fallback tests and by any code path that needs to reason
// offline. Never mix the two — the demo dataset is a subset of what
// lives in Supabase.

export type Term = "Fall" | "Spring" | "Summer";

export interface CatalogCourse {
  code: string;
  title: string;
  credits: number;
  terms_offered: readonly Term[];
  description: string;
  prerequisites: readonly string[];
}

function course(
  code: string,
  title: string,
  credits: number,
  terms_offered: readonly Term[],
  description: string,
  prerequisites: readonly string[] = [],
): CatalogCourse {
  return { code, title, credits, terms_offered, description, prerequisites };
}

export const COURSES: Readonly<Record<string, CatalogCourse>> = {
  "CS 101": course("CS 101", "Intro to Computer Science", 3, ["Fall", "Spring"],
    "Foundations of computing, algorithms, and problem solving."),
  "CS 201": course("CS 201", "Data Structures", 3, ["Fall", "Spring"],
    "Lists, trees, hash tables, and complexity analysis.", ["CS 101"]),
  "CS 301": course("CS 301", "Algorithms", 3, ["Fall"],
    "Design and analysis of algorithms. Offered only in Fall.",
    ["CS 201", "MATH 210"]),
  "CS 340": course("CS 340", "Computer Systems", 4, ["Spring"],
    "Machine organization, memory, and low-level programming.", ["CS 201"]),
  "CS 402": course("CS 402", "Operating Systems", 4, ["Fall"],
    "Processes, scheduling, memory management, and file systems.",
    ["CS 301", "CS 340"]),
  "CS 410": course("CS 410", "Databases", 3, ["Spring"],
    "Relational modeling, SQL, and transaction management.", ["CS 201"]),
  "MATH 210": course("MATH 210", "Discrete Mathematics", 3, ["Fall", "Spring"],
    "Logic, sets, combinatorics, and proofs."),
  "BUS 101": course("BUS 101", "Intro to Business", 3, ["Fall", "Spring"],
    "Overview of business functions and management."),
  "BUS 210": course("BUS 210", "Financial Accounting", 3, ["Fall", "Spring"],
    "Financial statements and accounting principles.", ["BUS 101"]),
  "BUS 220": course("BUS 220", "Managerial Accounting", 3, ["Spring"],
    "Cost accounting and internal decision reporting.", ["BUS 210"]),
  "BUS 310": course("BUS 310", "Marketing Principles", 3, ["Fall", "Spring"],
    "Market analysis, segmentation, and campaigns.", ["BUS 101"]),
  "BUS 350": course("BUS 350", "Corporate Finance", 3, ["Fall"],
    "Capital budgeting, valuation, and financing decisions.", ["BUS 210"]),
  "PSY 101": course("PSY 101", "Intro to Psychology", 3, ["Fall", "Spring"],
    "Behavior, cognition, and research methods."),
  "PSY 220": course("PSY 220", "Developmental Psychology", 3, ["Fall", "Spring"],
    "Human development across the lifespan.", ["PSY 101"]),
  "PSY 305": course("PSY 305", "Cognitive Psychology", 3, ["Fall"],
    "Attention, memory, and reasoning.", ["PSY 101"]),
  "PSY 340": course("PSY 340", "Research Methods", 4, ["Spring"],
    "Experimental design and statistical analysis.", ["PSY 101", "STAT 220"]),
  "PSY 410": course("PSY 410", "Abnormal Psychology", 3, ["Spring"],
    "Clinical disorders and treatment approaches.", ["PSY 220", "PSY 305"]),
  "ENG 150": course("ENG 150", "Composition & Rhetoric", 3, ["Fall", "Spring", "Summer"],
    "General education writing course."),
  "STAT 220": course("STAT 220", "Applied Statistics", 3, ["Fall", "Spring"],
    "Descriptive and inferential statistics."),
};

export type MajorId = "cs" | "business" | "psych";

export interface Major {
  id: MajorId;
  name: string;
  required_courses: readonly string[];
}

export const MAJORS: Readonly<Record<MajorId, Major>> = {
  cs: {
    id: "cs",
    name: "Computer Science",
    required_courses: ["CS 101", "CS 201", "CS 301", "CS 340", "CS 402", "MATH 210"],
  },
  business: {
    id: "business",
    name: "Business Administration",
    required_courses: ["BUS 101", "BUS 210", "BUS 220", "BUS 310", "BUS 350"],
  },
  psych: {
    id: "psych",
    name: "Psychology",
    required_courses: ["PSY 101", "PSY 220", "PSY 305", "PSY 340", "PSY 410", "STAT 220"],
  },
};

export const DEMO_COURSES = ["CS 301", "BUS 350", "PSY 340", "BIO 210", "ENG 150"] as const;

export function normalizeCourse(code: string): string {
  return code.trim().toUpperCase().split(/\s+/).join(" ");
}

export function lookupCourse(code: string): CatalogCourse | null {
  return COURSES[normalizeCourse(code)] ?? null;
}

export function prereqsOf(code: string): readonly string[] {
  return lookupCourse(code)?.prerequisites ?? [];
}

/**
 * Transitive downstream: every course whose prereq chain reaches `code`.
 * Iterative BFS over COURSES so we don't stack-overflow on any future
 * long chain, and so ordering is deterministic (sorted at the end).
 */
export function downstreamOf(code: string): string[] {
  const target = normalizeCourse(code);
  const visited = new Set<string>();
  const stack: string[] = [target];
  while (stack.length) {
    const current = stack.pop()!;
    for (const [otherCode, other] of Object.entries(COURSES)) {
      if (other.prerequisites.includes(current) && !visited.has(otherCode)) {
        visited.add(otherCode);
        stack.push(otherCode);
      }
    }
  }
  return [...visited].sort();
}

export type RequiredForResult = boolean | "unknown";

export function isRequiredFor(code: string, major: MajorId | null | undefined): RequiredForResult {
  if (!major) return "unknown";
  const row = MAJORS[major];
  if (!row) return "unknown";
  return row.required_courses.includes(normalizeCourse(code));
}
