-- AlterTable
ALTER TABLE "agent_threads" ADD COLUMN     "matterId" TEXT;

-- AlterTable
ALTER TABLE "contract_requests" ADD COLUMN     "matterId" TEXT;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "matterId" TEXT;

-- CreateTable
CREATE TABLE "matters" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "counterpartyId" TEXT,
    "counterpartyName" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "matters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matters_orgId_status_idx" ON "matters"("orgId", "status");

-- CreateIndex
CREATE INDEX "matters_orgId_ownerId_idx" ON "matters"("orgId", "ownerId");

-- CreateIndex
CREATE INDEX "matters_orgId_counterpartyId_idx" ON "matters"("orgId", "counterpartyId");

-- CreateIndex
CREATE INDEX "agent_threads_orgId_matterId_idx" ON "agent_threads"("orgId", "matterId");

-- CreateIndex
CREATE INDEX "contract_requests_orgId_matterId_idx" ON "contract_requests"("orgId", "matterId");

-- CreateIndex
CREATE INDEX "contracts_orgId_matterId_idx" ON "contracts"("orgId", "matterId");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_requests" ADD CONSTRAINT "contract_requests_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
