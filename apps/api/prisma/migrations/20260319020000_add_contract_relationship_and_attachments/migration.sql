-- Add relationship type and attachments to contracts
-- relationshipType: amendment | sow | order_form | renewal | nda | exhibit_only
-- attachments: JSON array [{filename, s3Key, mimeType, size, label}]

ALTER TABLE "contracts"
  ADD COLUMN "relationshipType" TEXT,
  ADD COLUMN "attachments"      JSONB NOT NULL DEFAULT '[]';

-- Index for quickly finding all children of a parent contract
CREATE INDEX "contracts_parentContractId_idx" ON "contracts" ("parentContractId");
