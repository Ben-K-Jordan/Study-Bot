import { z } from "zod";

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

export const listDocumentsSchema = z.object({
  namespace: z.enum(CONTENT_NAMESPACES).optional(),
  course_name: z.string().optional(),
  exam_name: z.string().optional(),
});
