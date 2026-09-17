-- AlterTable
ALTER TABLE "contract_versions" ADD COLUMN     "changeSummary" TEXT,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ALTER COLUMN "htmlContent" SET DEFAULT '',
ALTER COLUMN "plainText" SET DEFAULT '';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "counterpartyId" TEXT,
ADD COLUMN     "keyTerms" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "counterparties" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "website" TEXT,
    "crmId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_embeddings" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counterparties_orgId_idx" ON "counterparties"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_orgId_name_key" ON "counterparties"("orgId", "name");

-- CreateIndex
CREATE INDEX "contract_embeddings_versionId_idx" ON "contract_embeddings"("versionId");

-- CreateIndex
CREATE INDEX "contracts_orgId_counterpartyId_idx" ON "contracts"("orgId", "counterpartyId");

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_embeddings" ADD CONSTRAINT "contract_embeddings_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "contract_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
