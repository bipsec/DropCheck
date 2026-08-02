// Ported from backend/tests/test_profile_routes.py.
//
// Uses vi.mock to stub the profile service + session helpers. The route
// handlers themselves are pure functions we call directly with a
// Request; no HTTP server needed. Six tests total, matching Python 1:1.

import { beforeEach, describe, expect, it, vi } from "vitest";

const seen: Record<string, unknown> = {};

// --- Module mocks (hoisted) ------------------------------------------------

vi.mock("@/lib/server/cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/cookies")>();
  return {
    ...actual,
    requireStudent: vi.fn(async () => ({ id: "stu-1", session_id: "sid" })),
  };
});

vi.mock("@/lib/server/services/profile", () => ({
  ProfileError: class extends Error {},
  getProfile: vi.fn(),
  patchStudent: vi.fn(),
  upsertFinance: vi.fn(),
  addCourse: vi.fn(),
  applyExtraction: vi.fn(),
  matchNewCourses: vi.fn(),
  recordTranscript: vi.fn(),
  completenessFor: vi.fn(),
}));

vi.mock("@/lib/server/services/pdf", () => ({
  parsePdf: vi.fn(),
}));

vi.mock("@/lib/server/agents/extraction", () => ({
  extractProfile: vi.fn(),
}));

// --- Imports (after mocks) --------------------------------------------------

import * as profileService from "@/lib/server/services/profile";
import * as pdfService from "@/lib/server/services/pdf";
import * as extractionAgent from "@/lib/server/agents/extraction";

const mockedProfile = vi.mocked(profileService);
const mockedPdf = vi.mocked(pdfService);
const mockedExtraction = vi.mocked(extractionAgent);

// --- Helpers ---------------------------------------------------------------

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    student_id: "stu-1",
    student: { id: "stu-1", program: "CS", international: false },
    finance: { student_id: "stu-1", tuition_per_term: 12500 },
    courses: [],
    completeness: { score: 48, missing_fields: ["gpa"], meets_80: false },
    ...overrides,
  };
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function makePdfFormRequest(
  filename: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<Request> {
  const form = new FormData();
  const file = new File([new Blob([bytes as BlobPart])], filename, {
    type: contentType,
  });
  form.append("file", file);
  return new Request("http://localhost/api/profile/upload", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(seen)) delete seen[key];
});

// --- Tests ------------------------------------------------------------------

describe("profile routes", () => {
  it("get_profile_success", async () => {
    mockedProfile.getProfile.mockResolvedValue(bundle() as never);
    const { GET } = await import("@/app/api/profile/route");
    const res = await GET(new Request("http://localhost/api/profile"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.student_id).toBe("stu-1");
    expect(body.completeness.score).toBe(48);
    expect(body.completeness.meets_80).toBe(false);
  });

  it("patch_profile_calls_services", async () => {
    mockedProfile.patchStudent.mockImplementation(async (sid: string, fields: Record<string, unknown>) => {
      seen.student = [sid, fields];
      return { id: sid, ...fields };
    });
    mockedProfile.upsertFinance.mockImplementation(async (sid: string, fields: Record<string, unknown>) => {
      seen.finance = [sid, fields];
      return { student_id: sid, ...fields };
    });
    mockedProfile.getProfile.mockResolvedValue(
      bundle({ student: { id: "stu-1", gpa: 3.5 } }) as never,
    );

    const { PATCH } = await import("@/app/api/profile/route");
    const res = await PATCH(
      jsonRequest("http://localhost/api/profile", "PATCH", {
        student: { gpa: 3.5 },
        finance: { tuition_per_term: 14000, aid_types: ["pell"] },
      }),
    );
    expect(res.status).toBe(200);
    const seenStudent = seen.student as [string, Record<string, unknown>];
    const seenFinance = seen.finance as [string, Record<string, unknown>];
    expect(seenStudent[0]).toBe("stu-1");
    expect(seenStudent[1]).toEqual({ gpa: 3.5 });
    expect(seenFinance[1]).toEqual({ tuition_per_term: 14000, aid_types: ["pell"] });
  });

  it("add_course", async () => {
    mockedProfile.addCourse.mockResolvedValue({
      id: "course-1",
      course_code: "CS 201",
      title: "Data Structures",
      grade: null,
      credits: 3.0,
      semester: "Fall 2024",
      source: "manual_edit",
      confirmed_by_student: true,
      match_confidence: null,
      catalog_course_id: null,
    } as never);
    const { POST } = await import("@/app/api/profile/courses/route");
    const res = await POST(
      jsonRequest("http://localhost/api/profile/courses", "POST", {
        course_code: "CS 201",
        title: "Data Structures",
        credits: 3,
        semester: "Fall 2024",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course_code).toBe("CS 201");
  });

  it("upload_rejects_non_pdf", async () => {
    const req = await makePdfFormRequest(
      "resume.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    );
    const { POST } = await import("@/app/api/profile/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("upload_rejects_empty_file", async () => {
    const req = await makePdfFormRequest("empty.pdf", "application/pdf", new Uint8Array());
    const { POST } = await import("@/app/api/profile/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("upload_happy_path", async () => {
    mockedPdf.parsePdf.mockResolvedValue({
      markdown: "# Transcript\n\nCS 201 Data Structures B+ 3.0 Fall 2024",
      method: "text",
      pageCount: 1,
      ocrAvailable: true,
    });
    mockedExtraction.extractProfile.mockResolvedValue({
      name: null,
      program: "CS",
      major: null,
      expected_grad_semester: null,
      gpa: 3.4,
      total_credits_completed: null,
      international: null,
      finance_hints: null,
      courses: [
        {
          code: "CS 201",
          title: "Data Structures",
          grade: "B+",
          credits: 3,
          semester: "Fall 2024",
        },
      ],
    } as never);
    mockedProfile.recordTranscript.mockResolvedValue("tr-1");
    mockedProfile.applyExtraction.mockResolvedValue(undefined);
    mockedProfile.matchNewCourses.mockResolvedValue(1);
    mockedProfile.completenessFor.mockResolvedValue({
      score: 44,
      missing_fields: ["gpa"],
      meets_80: false,
    });

    const req = await makePdfFormRequest(
      "t.pdf",
      "application/pdf",
      new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF"
    );
    const { POST } = await import("@/app/api/profile/upload/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript_id).toBe("tr-1");
    expect(body.courses_parsed).toBe(1);
    expect(body.courses_matched).toBe(1);
    expect(body.parse_method).toBe("text");
  });
});
