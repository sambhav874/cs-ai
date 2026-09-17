-- AlterTable
ALTER TABLE "contract_clauses" ADD COLUMN     "interpretation" TEXT,
ADD COLUMN     "riskRating" TEXT,
ADD COLUMN     "sectionRef" TEXT;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "overallConfidence" DOUBLE PRECISION,
ADD COLUMN     "riskFactors" TEXT[] DEFAULT ARRAY[]::TEXT[];
