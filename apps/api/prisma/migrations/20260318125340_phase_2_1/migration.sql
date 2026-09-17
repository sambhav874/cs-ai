/*
  Warnings:

  - You are about to drop the `contract_embeddings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "contract_embeddings" DROP CONSTRAINT "contract_embeddings_versionId_fkey";

-- AlterTable
ALTER TABLE "contract_requests" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "requestNumber" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'web_form';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "contractNumber" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "fieldConfidence" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "jurisdiction" TEXT,
ADD COLUMN     "parentContractId" TEXT;

-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "contacts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "legalName" TEXT;

-- DropTable
DROP TABLE "contract_embeddings";

-- CreateTable
CREATE TABLE "contract_clauses" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "clauseType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(1536),
    "embeddedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_field_definitions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractType" TEXT,
    "fieldKey" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contract_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_clauses_versionId_idx" ON "contract_clauses"("versionId");

-- CreateIndex
CREATE INDEX "contract_clauses_clauseType_idx" ON "contract_clauses"("clauseType");

-- CreateIndex
CREATE INDEX "contract_field_definitions_orgId_contractType_idx" ON "contract_field_definitions"("orgId", "contractType");

-- CreateIndex
CREATE UNIQUE INDEX "contract_field_definitions_orgId_contractType_fieldKey_key" ON "contract_field_definitions"("orgId", "contractType", "fieldKey");

-- CreateIndex
CREATE INDEX "contract_requests_orgId_source_idx" ON "contract_requests"("orgId", "source");

-- CreateIndex
CREATE INDEX "contracts_orgId_jurisdiction_idx" ON "contracts"("orgId", "jurisdiction");

-- CreateIndex
CREATE INDEX "contracts_orgId_expiryDate_idx" ON "contracts"("orgId", "expiryDate");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_parentContractId_fkey" FOREIGN KEY ("parentContractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "contract_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_field_definitions" ADD CONSTRAINT "contract_field_definitions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
