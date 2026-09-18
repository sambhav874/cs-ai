-- Add chunking metadata columns to contract_clauses
-- Enables SOTA legal chunking: sub-chunk tracking, char offsets for highlight, ES indexing

ALTER TABLE "contract_clauses"
  ADD COLUMN "isSubChunk"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "windowIndex" INTEGER,
  ADD COLUMN "charStart"   INTEGER,
  ADD COLUMN "charEnd"     INTEGER;

-- Index for efficient RAG queries: "give me real clauses, not sub-chunks"
CREATE INDEX "contract_clauses_versionId_isSubChunk_idx"
  ON "contract_clauses" ("versionId", "isSubChunk");
