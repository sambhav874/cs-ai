-- AlterTable: add analysisStatus column with default PENDING
ALTER TABLE "contracts" ADD COLUMN "analysisStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- Mark existing contracts that already have AI data as DONE
UPDATE "contracts" SET "analysisStatus" = 'DONE' WHERE summary IS NOT NULL;
