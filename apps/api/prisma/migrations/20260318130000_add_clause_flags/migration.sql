-- AlterTable
ALTER TABLE "contract_versions" ADD COLUMN "clauseFlags" JSONB NOT NULL DEFAULT '{}';
