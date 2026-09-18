-- P7.6.1 — Self-hosted eSignature backbone.
--
-- Three new tables:
--   signature_requests — one campaign per send-for-signature
--   signers            — one row per person who needs to sign
--   signature_events   — append-only audit trail (sent/viewed/signed/etc.)
--
-- Tokens are 32-byte hex (per Signer). The contract row stays the source
-- of truth for status; the signature flow flips contract.status to
-- EXECUTED once every signer has signed.

CREATE TABLE "signature_requests" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "contractId"   TEXT NOT NULL,
  "versionId"    TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "signOrder"    TEXT NOT NULL DEFAULT 'ANY',
  "expiresAt"    TIMESTAMP(3),
  "message"      TEXT,
  "createdById"  TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"  TIMESTAMP(3),
  "voidedAt"     TIMESTAMP(3),
  "voidedReason" TEXT,
  CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signature_requests_orgId_status_idx" ON "signature_requests"("orgId", "status");
CREATE INDEX "signature_requests_contractId_idx"  ON "signature_requests"("contractId");

CREATE TABLE "signers" (
  "id"                 TEXT NOT NULL,
  "signatureRequestId" TEXT NOT NULL,
  "email"              TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "role"               TEXT,
  "userId"             TEXT,
  "signOrder"          INTEGER NOT NULL DEFAULT 1,
  "token"              TEXT NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'PENDING',
  "signedAt"           TIMESTAMP(3),
  "declinedAt"         TIMESTAMP(3),
  "declinedReason"     TEXT,
  "signedName"         TEXT,
  "signedIp"           TEXT,
  "signedUserAgent"    TEXT,
  "signature"          JSONB NOT NULL DEFAULT '{}',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signers_token_key" ON "signers"("token");
CREATE INDEX "signers_signatureRequestId_idx" ON "signers"("signatureRequestId");
CREATE INDEX "signers_email_idx" ON "signers"("email");

CREATE TABLE "signature_events" (
  "id"                 TEXT NOT NULL,
  "signatureRequestId" TEXT NOT NULL,
  "signerId"           TEXT,
  "kind"               TEXT NOT NULL,
  "metadata"           JSONB NOT NULL DEFAULT '{}',
  "ipAddress"          TEXT,
  "userAgent"          TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signature_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signature_events_signatureRequestId_createdAt_idx"
  ON "signature_events"("signatureRequestId", "createdAt");

ALTER TABLE "signers"           ADD CONSTRAINT "signers_signatureRequestId_fkey"
  FOREIGN KEY ("signatureRequestId") REFERENCES "signature_requests"("id") ON DELETE CASCADE;
ALTER TABLE "signature_events"  ADD CONSTRAINT "signature_events_signatureRequestId_fkey"
  FOREIGN KEY ("signatureRequestId") REFERENCES "signature_requests"("id") ON DELETE CASCADE;
