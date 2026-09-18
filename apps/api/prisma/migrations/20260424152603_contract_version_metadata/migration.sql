-- AlterTable
ALTER TABLE "contract_versions" ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}';
