-- B.5.7 — per-clause review state, powering the Focused Review drawer's
-- Accept / Reject / Mark-Reviewed actions and the "N / M reviewed" counter
-- at the top of the detail-page rail.
ALTER TABLE "contract_clauses" ADD COLUMN "reviewState"  TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE "contract_clauses" ADD COLUMN "reviewedAt"   TIMESTAMP(3);
ALTER TABLE "contract_clauses" ADD COLUMN "reviewedById" TEXT;
