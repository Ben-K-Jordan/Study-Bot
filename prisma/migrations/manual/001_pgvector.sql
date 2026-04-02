-- Enable pgvector extension (optional; code degrades gracefully if missing)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to content_chunks (1536-dim for text-embedding-3-small)
-- Using ALTER TABLE since Prisma cannot represent vector natively
ALTER TABLE content_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index for fast cosine similarity queries
CREATE INDEX IF NOT EXISTS content_chunks_embedding_hnsw_idx
  ON content_chunks
  USING hnsw (embedding vector_cosine_ops);
