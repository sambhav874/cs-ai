-- DropForeignKey
ALTER TABLE "signature_events" DROP CONSTRAINT "signature_events_signatureRequestId_fkey";

-- DropForeignKey
ALTER TABLE "signers" DROP CONSTRAINT "signers_signatureRequestId_fkey";

-- CreateTable
CREATE TABLE "obligations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT NOT NULL DEFAULT 'unknown',
    "dueDate" TIMESTAMP(3),
    "recurrence" TEXT NOT NULL DEFAULT 'one-time',
    "trigger" TEXT,
    "quote" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "sectionRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completionNote" TEXT,
    "evidenceS3Key" TEXT,
    "evidenceFilename" TEXT,
    "evidenceMimeType" TEXT,
    "evidenceSize" INTEGER,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "obligations_orgId_status_idx" ON "obligations"("orgId", "status");

-- CreateIndex
CREATE INDEX "obligations_orgId_dueDate_idx" ON "obligations"("orgId", "dueDate");

-- CreateIndex
CREATE INDEX "obligations_orgId_status_dueDate_idx" ON "obligations"("orgId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "obligations_contractId_idx" ON "obligations"("contractId");

-- CreateIndex
CREATE INDEX "signers_token_idx" ON "signers"("token");

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signers" ADD CONSTRAINT "signers_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "signature_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "signature_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
