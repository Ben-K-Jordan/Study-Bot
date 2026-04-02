-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "exam_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "topic_scope" TEXT NOT NULL,
    "objectives" JSONB,
    "target_outcome" JSONB,
    "break_protocol" JSONB,
    "resources" JSONB,
    "planned_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_runs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'RETRIEVAL',
    "phase" TEXT NOT NULL DEFAULT 'ACTIVE',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "current_index" INTEGER NOT NULL DEFAULT 0,
    "prompt_count" INTEGER NOT NULL DEFAULT 0,
    "answered_count" INTEGER,
    "scored_count" INTEGER,
    "prompts" JSONB NOT NULL,
    "policies" JSONB NOT NULL DEFAULT '{}',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "break_state" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_attempts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "prompt_index" INTEGER NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "user_answer" TEXT NOT NULL,
    "self_score" TEXT,
    "time_to_answer_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_error_logs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT '',
    "prompt_index" INTEGER NOT NULL,
    "error_type" TEXT NOT NULL,
    "correction_rule" TEXT NOT NULL,
    "variant_question" TEXT,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_run_prompts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "prompt_index" INTEGER NOT NULL,
    "objective_id" TEXT,
    "text" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "source_type" TEXT NOT NULL DEFAULT 'GENERATED',
    "source_ref_id" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_run_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_plans" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "exam_name" TEXT NOT NULL,
    "exam_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "course_name" TEXT,
    "exam_name" TEXT,
    "title" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "page_number" INTEGER,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "embedding_status" TEXT NOT NULL DEFAULT 'NONE',
    "embedding_model" TEXT,
    "embedding_dim" INTEGER,
    "embedding_updated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_anchors" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "exam_name" TEXT NOT NULL DEFAULT '',
    "objective_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "objective_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "exam_name" TEXT,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_questions" (
    "id" TEXT NOT NULL,
    "practice_set_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "answer_key" TEXT,
    "solution_steps" TEXT,
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_papers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT,
    "year" INTEGER,
    "venue" TEXT,
    "document_id" TEXT NOT NULL,
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_cards" (
    "id" TEXT NOT NULL,
    "evidence_paper_id" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "boundary_conditions" TEXT,
    "strength" TEXT NOT NULL,
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_citations" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "snippet" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_plan_items" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "day_index" INTEGER NOT NULL,
    "start_time" TIMESTAMPTZ NOT NULL,
    "end_time" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "completed_run_id" TEXT,
    "completed_at" TIMESTAMPTZ,
    "missed_at" TIMESTAMPTZ,
    "last_rescheduled_at" TIMESTAMPTZ,
    "original_start_at" TIMESTAMPTZ,
    "original_end_at" TIMESTAMPTZ,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_reflow_audits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "algorithm_version" TEXT NOT NULL DEFAULT 'v1',
    "input_summary" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_reflow_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_calendar_publications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE',
    "calendar_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_PUBLISHED',
    "published_at" TIMESTAMPTZ,
    "last_synced_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_calendar_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_item_external_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "plan_item_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE',
    "calendar_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "html_link" TEXT,
    "etag" TEXT,
    "remote_updated_at" TIMESTAMPTZ,
    "last_synced_hash" TEXT NOT NULL,
    "last_synced_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_item_external_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_integrations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "connected_email" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "token_expiry_ms" BIGINT NOT NULL DEFAULT 0,
    "scope_string" TEXT NOT NULL DEFAULT '',
    "calendar_id_selected" TEXT NOT NULL DEFAULT 'primary',
    "busy_calendar_ids" TEXT NOT NULL DEFAULT 'primary',
    "availability_lookahead_days" INTEGER NOT NULL DEFAULT 14,
    "timezone" TEXT,
    "last_refresh_at" TIMESTAMPTZ,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "last_healthy_at" TIMESTAMPTZ,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_call_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "cache_hit" BOOLEAN NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "token_in" INTEGER,
    "token_out" INTEGER,
    "cost_usd_micros" BIGINT,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_cache" (
    "key_hash" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "input_fingerprint" TEXT NOT NULL,
    "output_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "last_hit_at" TIMESTAMP(3),

    CONSTRAINT "ai_cache_pkey" PRIMARY KEY ("key_hash")
);

-- CreateTable
CREATE TABLE "job_queue" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "run_after" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "locked_at" TIMESTAMPTZ,
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_mastery" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "objective_key" TEXT NOT NULL,
    "ease_factor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "interval_days" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "last_accuracy" DOUBLE PRECISION,
    "last_studied_at" TIMESTAMPTZ,
    "next_due_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "objective_mastery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_id_key" ON "sessions"("session_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_runs_run_id_key" ON "session_runs"("run_id");

-- CreateIndex
CREATE INDEX "session_runs_user_id_status_idx" ON "session_runs"("user_id", "status");

-- CreateIndex
CREATE INDEX "session_runs_session_id_idx" ON "session_runs"("session_id");

-- CreateIndex
CREATE INDEX "session_attempts_run_id_idx" ON "session_attempts"("run_id");

-- CreateIndex
CREATE INDEX "session_attempts_run_id_created_at_idx" ON "session_attempts"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_attempts_run_id_prompt_index_key" ON "session_attempts"("run_id", "prompt_index");

-- CreateIndex
CREATE INDEX "session_error_logs_run_id_idx" ON "session_error_logs"("run_id");

-- CreateIndex
CREATE INDEX "session_error_logs_user_unresolved_idx" ON "session_error_logs"("user_id", "resolved_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "session_run_prompts_run_id_prompt_index_idx" ON "session_run_prompts"("run_id", "prompt_index");

-- CreateIndex
CREATE UNIQUE INDEX "session_run_prompts_run_prompt_key" ON "session_run_prompts"("run_id", "prompt_index");

-- CreateIndex
CREATE UNIQUE INDEX "study_plans_plan_id_key" ON "study_plans"("plan_id");

-- CreateIndex
CREATE INDEX "study_plans_user_id_idx" ON "study_plans"("user_id");

-- CreateIndex
CREATE INDEX "content_documents_user_ns_course_exam_idx" ON "content_documents"("user_id", "namespace", "course_name", "exam_name");

-- CreateIndex
CREATE UNIQUE INDEX "content_documents_user_hash_key" ON "content_documents"("user_id", "content_hash");

-- CreateIndex
CREATE INDEX "content_chunks_embedding_status_idx" ON "content_chunks"("embedding_status");

-- CreateIndex
CREATE UNIQUE INDEX "content_chunks_doc_ordinal_key" ON "content_chunks"("document_id", "ordinal");

-- CreateIndex
CREATE INDEX "objective_anchors_lookup_idx" ON "objective_anchors"("user_id", "course_name", "exam_name", "objective_id");

-- CreateIndex
CREATE UNIQUE INDEX "objective_anchors_unique_key" ON "objective_anchors"("user_id", "course_name", "exam_name", "objective_id", "chunk_id");

-- CreateIndex
CREATE INDEX "practice_sets_user_course_exam_idx" ON "practice_sets"("user_id", "course_name", "exam_name");

-- CreateIndex
CREATE INDEX "practice_questions_practice_set_id_idx" ON "practice_questions"("practice_set_id");

-- CreateIndex
CREATE INDEX "evidence_papers_user_id_idx" ON "evidence_papers"("user_id");

-- CreateIndex
CREATE INDEX "evidence_cards_evidence_paper_id_idx" ON "evidence_cards"("evidence_paper_id");

-- CreateIndex
CREATE INDEX "attempt_citations_attempt_id_idx" ON "attempt_citations"("attempt_id");

-- CreateIndex
CREATE INDEX "attempt_citations_chunk_id_idx" ON "attempt_citations"("chunk_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_citations_attempt_chunk_key" ON "attempt_citations"("attempt_id", "chunk_id");

-- CreateIndex
CREATE INDEX "study_plan_items_plan_id_idx" ON "study_plan_items"("plan_id");

-- CreateIndex
CREATE INDEX "study_plan_items_plan_start_idx" ON "study_plan_items"("plan_id", "start_time");

-- CreateIndex
CREATE INDEX "study_plan_items_plan_status_idx" ON "study_plan_items"("plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "study_plan_items_plan_id_session_id_key" ON "study_plan_items"("plan_id", "session_id");

-- CreateIndex
CREATE INDEX "plan_reflow_audits_plan_created_idx" ON "plan_reflow_audits"("plan_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "plan_calendar_publications_user_id_provider_idx" ON "plan_calendar_publications"("user_id", "provider");

-- CreateIndex
CREATE INDEX "plan_calendar_publications_plan_id_idx" ON "plan_calendar_publications"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_calendar_publications_provider_plan_key" ON "plan_calendar_publications"("provider", "plan_id");

-- CreateIndex
CREATE INDEX "plan_item_external_events_provider_plan_id_idx" ON "plan_item_external_events"("provider", "plan_id");

-- CreateIndex
CREATE INDEX "plan_item_external_events_user_id_provider_idx" ON "plan_item_external_events"("user_id", "provider");

-- CreateIndex
CREATE INDEX "plan_item_external_events_calendar_id_event_id_idx" ON "plan_item_external_events"("calendar_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_item_external_events_provider_item_key" ON "plan_item_external_events"("provider", "plan_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_integrations_user_id_key" ON "google_integrations"("user_id");

-- CreateIndex
CREATE INDEX "google_integrations_status_idx" ON "google_integrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");

-- CreateIndex
CREATE INDEX "ai_call_logs_user_id_created_at_idx" ON "ai_call_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_task_created_at_idx" ON "ai_call_logs"("task", "created_at");

-- CreateIndex
CREATE INDEX "ai_cache_task_expires_at_idx" ON "ai_cache"("task", "expires_at");

-- CreateIndex
CREATE INDEX "job_queue_status_run_after_priority_idx" ON "job_queue"("status", "run_after", "priority");

-- CreateIndex
CREATE INDEX "job_queue_type_status_idx" ON "job_queue"("type", "status");

-- CreateIndex
CREATE INDEX "objective_mastery_user_id_course_name_next_due_at_idx" ON "objective_mastery"("user_id", "course_name", "next_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "objective_mastery_user_course_key" ON "objective_mastery"("user_id", "course_name", "objective_key");

-- AddForeignKey
ALTER TABLE "session_runs" ADD CONSTRAINT "session_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_attempts" ADD CONSTRAINT "session_attempts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "session_runs"("run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_error_logs" ADD CONSTRAINT "session_error_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "session_runs"("run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_run_prompts" ADD CONSTRAINT "session_run_prompts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "session_runs"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "content_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_anchors" ADD CONSTRAINT "objective_anchors_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "content_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_questions" ADD CONSTRAINT "practice_questions_practice_set_id_fkey" FOREIGN KEY ("practice_set_id") REFERENCES "practice_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_papers" ADD CONSTRAINT "evidence_papers_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "content_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_cards" ADD CONSTRAINT "evidence_cards_evidence_paper_id_fkey" FOREIGN KEY ("evidence_paper_id") REFERENCES "evidence_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_citations" ADD CONSTRAINT "attempt_citations_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "session_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_citations" ADD CONSTRAINT "attempt_citations_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "content_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plan_items" ADD CONSTRAINT "study_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "study_plans"("plan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_calendar_publications" ADD CONSTRAINT "plan_calendar_publications_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "study_plans"("plan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_item_external_events" ADD CONSTRAINT "plan_item_external_events_plan_item_id_fkey" FOREIGN KEY ("plan_item_id") REFERENCES "study_plan_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
