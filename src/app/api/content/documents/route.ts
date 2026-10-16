import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { uploadDocument, listDocuments } from "@/services/content";
import { uploadDocumentSchema, listDocumentsSchema } from "@/lib/validation-content";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import { unauthorized } from "@/lib/http";
import { retryAfterText } from "@/lib/format";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
/** Longest file name kept, matching the title limit in uploadDocumentSchema. */
const MAX_NAME_LENGTH = 300;

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
];

/** Browsers often send no type (or a generic one) for .md files. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

function resolveMimeType(file: File): string {
  const declared = file.type;
  if (declared && declared !== "application/octet-stream") return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[extension] ?? (declared || "text/plain");
}

const FILE_RULE = "Upload a PDF, text, or Markdown file up to 10 MB.";

/**
 * POST /api/content/documents (multipart: file, namespace, course_name,
 * exam_name?, title?). Saves the file; processing is a separate call to
 * /api/content/documents/{id}/process. Uploading the same file again returns
 * the existing document (`deduped: true`) with the course it belongs to.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  // Saving a file calls no AI, so uploads use the general limit; processing
  // (which writes the AI summary) keeps the AI limit.
  const rl = generalLimiter.check(userId);
  if (!rl.allowed) {
    const seconds = Math.ceil(rl.retryAfterMs / 1000);
    return tooManyRequests(rl.retryAfterMs, `Too many uploads at once. ${retryAfterText(seconds)}`);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "The upload didn't arrive complete. Retry.", code: "invalid_form" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to upload.", code: "no_file" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: FILE_RULE, code: "file_too_large" }, { status: 413 });
  }

  const mimeType = resolveMimeType(file);
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: FILE_RULE, code: "unsupported_type" }, { status: 400 });
  }

  const fields = {
    namespace: formData.get("namespace") as string,
    course_name: (formData.get("course_name") as string) || undefined,
    exam_name: (formData.get("exam_name") as string) || undefined,
    title: (formData.get("title") as string) || undefined,
  };

  // A hand-built request can put folders ("../") and any length in the
  // name; keep only its last segment, at a length the screens can show.
  // Storage never uses this name for the path (see storedFileName).
  const fileName = (file.name.split(/[\\/]/).pop() ?? "").trim().slice(0, MAX_NAME_LENGTH) || "Untitled file";

  try {
    const parsed = uploadDocumentSchema.parse(fields);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const title = parsed.title || fileName;

    const result = await uploadDocument(
      userId,
      parsed.namespace,
      parsed.course_name,
      parsed.exam_name || undefined,
      title,
      fileName,
      mimeType,
      fileBuffer
    );

    return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: err.issues[0]?.message ?? "Check the course name and retry.",
          code: "validation_failed",
          issues: err.issues,
        },
        { status: 400 }
      );
    }
    logger.error("document_upload_failed", { error: String(err) });
    return NextResponse.json(
      { error: `${fileName} wasn't uploaded. Retry in a minute.`, code: "internal" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { searchParams } = new URL(request.url);
  const params = {
    namespace: searchParams.get("namespace") || undefined,
    course_name: searchParams.get("course_name") || undefined,
    exam_name: searchParams.get("exam_name") || undefined,
  };

  try {
    listDocumentsSchema.parse(params);
    const docs = await listDocuments(userId, params.namespace, params.course_name, params.exam_name);
    return NextResponse.json({ documents: docs });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "That materials filter isn't valid.", code: "validation_failed", issues: err.issues },
        { status: 400 }
      );
    }
    logger.error("list_documents_failed", { error: String(err) });
    return NextResponse.json(
      { error: "Materials didn't load. Retry in a minute.", code: "internal" },
      { status: 500 },
    );
  }
}
