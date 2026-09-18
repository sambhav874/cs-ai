-- P7.5.4 — Tamper-evident hash chain on audit_events.
--
-- We add two nullable text columns:
--   hash     — SHA256 of the canonical JSON of this row (including prevHash).
--   prevHash — The hash column of the previous row (by createdAt) for the
--              same orgId. Null on the first event in an org's chain.
--
-- Backfill is deferred to the application: existing rows stay null until
-- a verify-pass walks the chain and recomputes them. New events going
-- forward will compute hash/prevHash inside createAuditEvent().

ALTER TABLE "audit_events"
  ADD COLUMN "hash"     TEXT,
  ADD COLUMN "prevHash" TEXT;
