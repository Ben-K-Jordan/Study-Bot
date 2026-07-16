import { z } from "zod/v4";

// ---- Content Documents ----

const CONTENT_NAMESPACES = ["COURSE", "RESEARCH"] as const;

export const uploadDocumentSchema = z
  .object({
    namespace: z.enum(CONTENT_NAMESPACES),
    course_name: z.string().optional(),
    exam_name: z.string().optional(),
    title: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.namespace === "COURSE") return !!data.course_name;
      return true;
    },
    { message: "course_name is required for COURSE namespace" }
  );

export const searchContentSchema = z.object({
  q: z.string().min(1, "Search query is required"),
  namespace: z.enum(CONTENT_NAMESPACES),
  course_name: z.string().optional(),
  exam_name: z.string().optional(),
  top_k: z.number().int().min(1).max(10).default(5),
});

export const listDocumentsSchema = z.object({
  namespace: z.enum(CONTENT_NAMESPACES).optional(),
  course_name: z.string().optional(),
  exam_name: z.string().optional(),
});
