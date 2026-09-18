-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "diligenceRoomId" TEXT;

-- CreateTable
CREATE TABLE "diligence_rooms" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "diligence_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diligence_rooms_orgId_status_idx" ON "diligence_rooms"("orgId", "status");

-- CreateIndex
CREATE INDEX "contracts_diligenceRoomId_idx" ON "contracts"("diligenceRoomId");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_diligenceRoomId_fkey" FOREIGN KEY ("diligenceRoomId") REFERENCES "diligence_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diligence_rooms" ADD CONSTRAINT "diligence_rooms_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
