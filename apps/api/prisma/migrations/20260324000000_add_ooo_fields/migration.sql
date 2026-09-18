-- Phase 6.5.5: Team Workload — OOO fields
ALTER TABLE "users" ADD COLUMN "outOfOffice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "outOfOfficeUntil" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "delegateToId" TEXT;
