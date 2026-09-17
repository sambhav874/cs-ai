-- A.5 — Hybrid canonical artifact: add rendered-PDF tracking to contract_versions
-- See docs/25-CONTRACT-FLOW-FIX-PLAN.md Phase A.5.
--
-- `s3Key` continues to hold the SOURCE file (original PDF on upload, or
-- template-generated file for drafts). `renderedPdfKey` holds a Gotenberg-
-- rendered PDF produced from the current `htmlContent`, written on every
-- HTML save. When `renderedPdfKey` is non-null it is the canonical artifact
-- (what approvers, signers, and counterparties see). The source is kept
-- forever so we can always produce a diff against the original.

ALTER TABLE "contract_versions" ADD COLUMN "renderedPdfKey" TEXT;
ALTER TABLE "contract_versions" ADD COLUMN "renderedAt" TIMESTAMP(3);
