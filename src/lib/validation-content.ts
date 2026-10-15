import { z } from "zod";

// ---- Content Documents ----

const CONTENT_NAMESPACES = ["COURSE", "RESEARCH"] as const;

export const uploadDocumentSchema = z
  .object({
    namespace: z.enum(CONTENT_NAMESPACES),
    course_name: z.string().trim().max(120, "Use 120 characters or fewer.").optional(),
    exam_name: z.string().trim().max(120, "Use 120 characters or fewer.").optional(),
    title: z.string().trim().max(300).optional(),
  })
  .refine(
    (data) => {
      if (data.namespace === "COURSE") return !!data.course_name;
      return true;
    },
    { message: "Enter the course these files belong to.", path: ["course_name"] }
  );

export const listDocumentsSchema = z.object({
  namespace: z.enum(CONTENT_NAMESPACES).optional(),
  course_name: z.string().optional(),
  exam_name: z.string().optional(),
});
