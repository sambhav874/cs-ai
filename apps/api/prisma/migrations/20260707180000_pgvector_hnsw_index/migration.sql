-- Wave 4 — ANN index for clause-embedding similarity search.
--
-- Retrieval's dense side runs `cc.embedding <=> $vec` (pgvector cosine
-- distance) over contract_clauses (see apps/api/src/lib/embeddings.ts). The
-- table had only a btree on versionId, so every similarity query was a
-- sequential scan over all clause vectors — fine at demo scale, quadratic pain
-- as the portfolio grows.
--
-- HNSW (vs ivfflat) needs no training/list tuning and indexes an initially-
-- empty or growing table cleanly, so it's the safer default for a migration.
-- vector_cosine_ops matches the `<=>` operator used in the query. 1536 dims is
-- within HNSW's 2000-dim ceiling. Built non-concurrently (Prisma runs each
-- migration in a transaction); it's a one-time cost on an existing table.
CREATE INDEX IF NOT EXISTS "contract_clauses_embedding_hnsw"
  ON "contract_clauses"
  USING hnsw ("embedding" vector_cosine_ops);
