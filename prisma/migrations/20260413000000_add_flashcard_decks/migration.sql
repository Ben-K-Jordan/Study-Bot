-- CreateTable: flashcard_decks
CREATE TABLE "flashcard_decks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "exam_name" TEXT,
    "document_id" TEXT,
    "title" TEXT NOT NULL,
    "card_count" INT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flashcard_decks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: flashcards
CREATE TABLE "flashcards" (
    "id" TEXT NOT NULL,
    "deck_id" TEXT NOT NULL,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "tags" JSONB,
    "ordinal" INT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flashcards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flashcard_decks_user_course_exam_idx" ON "flashcard_decks"("user_id", "course_name", "exam_name");
CREATE INDEX "flashcards_deck_id_idx" ON "flashcards"("deck_id");

-- AddForeignKey
ALTER TABLE "flashcard_decks" ADD CONSTRAINT "flashcard_decks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "content_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "flashcard_decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
