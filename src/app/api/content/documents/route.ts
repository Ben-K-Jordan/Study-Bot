import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { uploadDocument, listDocuments } from "@/services/content";
import { uploadDocumentSchema, listDocumentsSchema } from "@/lib/validation-content";
import { z } from "zod/v4";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
];

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const mimeType = file.type || "text/plain";
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${mimeType}. Allowed: PDF, text, markdown` },
      { status: 400 }
    );
  }

  const fields = {
    namespace: formData.get("namespace") as string,
    course_name: (formData.get("course_name") as string) || undefined,
    exam_name: (formData.get("exam_name") as string) || undefined,
    title: (formData.get("title") as string) || undefined,
  };

  try {
    const parsed = uploadDocumentSchema.parse(fields);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const title = parsed.title || file.name;

    const result = await uploadDocument(
      userId,
      parsed.namespace,
      parsed.course_name,
      parsed.exam_name,
      title,
      file.name,
      mimeType,
      fileBuffer
    );

    return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 }
      );
    }
    console.error("Upload failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
        { error: "Validation failed", issues: err.issues },
        { status: 400 }
      );
    }
    console.error("List documents failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
