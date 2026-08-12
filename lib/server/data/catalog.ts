// Offline course fixture.
//
// After the pivot to Claude Agent SDK + MCP, *real* course data comes
// from the `university-catalog` MCP server (Purdue.io) and lands in the
// Supabase `course_cache` table (see phase 3). This file exists solely
// as a deterministic fixture for the rules-engine + track-builder unit
// tests, which must run offline with no network. The tests exercise
// the algorithm; production runs the algorithm over cached Purdue data.
//
// If a new course code shows up in `lib/server/data/programs/*.ts` that
// isn't in this fixture, add a `course(...)` row here so `lookupCourse`
// can back the offline tests. Don't reach for this map at runtime from
// any route handler or agent tool — that path goes through the MCP
// server.

export type Term = "Fall" | "Spring" | "Summer";

export interface CatalogCourse {
  code: string;
  title: string;
  credits: number;
  terms_offered: readonly Term[];
  description: string;
  prerequisites: readonly string[];
  corequisites?: readonly string[];
  tags?: readonly string[];
}

function course(
  code: string,
  title: string,
  credits: number,
  terms_offered: readonly Term[],
  description: string,
  prerequisites: readonly string[] = [],
  extras: { corequisites?: readonly string[]; tags?: readonly string[] } = {},
): CatalogCourse {
  return {
    code,
    title,
    credits,
    terms_offered,
    description,
    prerequisites,
    ...(extras.corequisites ? { corequisites: extras.corequisites } : {}),
    ...(extras.tags ? { tags: extras.tags } : {}),
  };
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
  "MATH 120": course("MATH 120", "Calculus I", 4, ["Fall", "Spring"],
    "Limits, derivatives, and the fundamental theorem of calculus."),
  "MATH 210": course("MATH 210", "Discrete Mathematics", 3, ["Fall", "Spring"],
    "Logic, sets, combinatorics, and proofs."),
  "MATH 220": course("MATH 220", "Calculus II", 4, ["Fall", "Spring"],
    "Integration techniques, series, and Taylor expansions.", ["MATH 120"]),
  "MATH 240": course("MATH 240", "Linear Algebra", 3, ["Fall", "Spring"],
    "Vector spaces, matrices, eigenvalues, and applications.", ["MATH 120"]),
  "MATH 260": course("MATH 260", "Multivariable Calculus", 4, ["Fall", "Spring"],
    "Vector calculus, partial derivatives, and multiple integrals.", ["MATH 220"]),
  "MATH 310": course("MATH 310", "Ordinary Differential Equations", 3, ["Spring"],
    "First and higher-order ODEs, systems, Laplace transforms.", ["MATH 220"]),
  "MATH 340": course("MATH 340", "Real Analysis", 3, ["Fall"],
    "Rigorous treatment of sequences, series, and continuity.",
    ["MATH 220", "MATH 210"]),
  "MATH 360": course("MATH 360", "Abstract Algebra", 3, ["Spring"],
    "Groups, rings, and fields with proofs.", ["MATH 210", "MATH 240"]),
  "BUS 101": course("BUS 101", "Intro to Business", 3, ["Fall", "Spring"],
    "Overview of business functions and management.", [], { tags: ["ge-social"] }),
  "BUS 210": course("BUS 210", "Financial Accounting", 3, ["Fall", "Spring"],
    "Financial statements and accounting principles.", ["BUS 101"]),
  "BUS 220": course("BUS 220", "Managerial Accounting", 3, ["Spring"],
    "Cost accounting and internal decision reporting.", ["BUS 210"]),
  "BUS 310": course("BUS 310", "Marketing Principles", 3, ["Fall", "Spring"],
    "Market analysis, segmentation, and campaigns.", ["BUS 101"]),
  "BUS 350": course("BUS 350", "Corporate Finance", 3, ["Fall"],
    "Capital budgeting, valuation, and financing decisions.", ["BUS 210"]),
  "PSY 101": course("PSY 101", "Intro to Psychology", 3, ["Fall", "Spring"],
    "Behavior, cognition, and research methods.", [], { tags: ["ge-social"] }),
  "PSY 220": course("PSY 220", "Developmental Psychology", 3, ["Fall", "Spring"],
    "Human development across the lifespan.", ["PSY 101"]),
  "PSY 305": course("PSY 305", "Cognitive Psychology", 3, ["Fall"],
    "Attention, memory, and reasoning.", ["PSY 101"]),
  "PSY 340": course("PSY 340", "Research Methods", 4, ["Spring"],
    "Experimental design and statistical analysis.", ["PSY 101", "STAT 220"]),
  "PSY 410": course("PSY 410", "Abnormal Psychology", 3, ["Spring"],
    "Clinical disorders and treatment approaches.", ["PSY 220", "PSY 305"]),
  "ENG 150": course("ENG 150", "Composition & Rhetoric", 3, ["Fall", "Spring", "Summer"],
    "General education writing course.", [], { tags: ["ge-writing"] }),
  "STAT 220": course("STAT 220", "Applied Statistics", 3, ["Fall", "Spring"],
    "Descriptive and inferential statistics.", [], { tags: ["ge-quantitative"] }),
};

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
 * Iterative BFS so long chains never stack-overflow, and ordering is
 * deterministic (sorted at the end).
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
