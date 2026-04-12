-- AlterTable: Add summary and suggested_questions to content_documents
ALTER TABLE "content_documents" ADD COLUMN "summary" TEXT;
ALTER TABLE "content_documents" ADD COLUMN "suggested_questions" JSONB;

-- CreateTable: study_guides
CREATE TABLE "study_guides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "exam_name" TEXT,
    "guide_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_guides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_guides_user_course_exam_idx" ON "study_guides"("user_id", "course_name", "exam_name");
