// Wire schemas for catalog ingest + search. Ported 1:1 from
// backend/app/schemas/catalog.py.

import { z } from "zod";

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const trim = z.string().trim();

export const CourseLevel = z.enum(["undergraduate", "masters", "doctoral"]);
export type CourseLevel = z.infer<typeof CourseLevel>;

export const CatalogRowIn = strict({
  course_code: trim.min(1).max(32),
  title: trim.min(1).max(200),
  description: trim.max(2000).nullable().optional(),
  credits: z.number().min(0).max(30).nullable().optional(),
  terms_offered: z.array(z.string()).max(4).default([]),
  prerequisites: z.array(z.string()).max(32).default([]),
  required_for_programs: z.array(z.string()).max(64).default([]),
  level: CourseLevel.nullable().optional(),
});
export type CatalogRowIn = z.infer<typeof CatalogRowIn>;

export const CatalogUploadIn = strict({
  courses: z.array(CatalogRowIn).min(1).max(2000),
});
export type CatalogUploadIn = z.infer<typeof CatalogUploadIn>;

export interface CatalogUploadResult {
  count: number;
  course_codes: string[];
}

export const CatalogSearchHit = z.object({
  id: z.string(),
  course_code: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  credits: z.number().nullable().optional(),
  level: CourseLevel.nullable().optional(),
  similarity: z.number(),
});
export type CatalogSearchHit = z.infer<typeof CatalogSearchHit>;
