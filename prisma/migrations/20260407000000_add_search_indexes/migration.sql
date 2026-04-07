-- GIN index for full-text search on content_chunks.text
-- Dramatically speeds up tsvector @@ tsquery lookups
CREATE INDEX IF NOT EXISTS idx_content_chunks_text_fts
  ON content_chunks USING gin (to_tsvector('english', text));

-- HNSW index for pgvector cosine similarity search
-- Only indexes rows that have an embedding (non-null)
CREATE INDEX IF NOT EXISTS idx_content_chunks_embedding_hnsw
  ON content_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
