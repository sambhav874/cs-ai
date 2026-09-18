-- Phase 6.5.1: User & Organization Management — schema additions
-- Aligned with 03-DATA-MODEL.md and 06-SECURITY-GOVERNANCE.md

-- ─── Users: add status, invite, lastActiveAt ────────────────────────────────

ALTER TABLE "users" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "users" ADD COLUMN "inviteToken" TEXT;
ALTER TABLE "users" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_inviteToken_key" ON "users"("inviteToken");
CREATE INDEX "users_orgId_status_idx" ON "users"("orgId", "status");

-- ─── Roles: add description, updatedAt ──────────────────────────────────────

ALTER TABLE "roles" ADD COLUMN "description" TEXT;
ALTER TABLE "roles" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill updatedAt for existing rows to createdAt
UPDATE "roles" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Now make it NOT NULL (Prisma @updatedAt requires non-null)
ALTER TABLE "roles" ALTER COLUMN "updatedAt" SET NOT NULL;

-- ─── UserRoles: add grantedBy ───────────────────────────────────────────────

ALTER TABLE "user_roles" ADD COLUMN "grantedBy" TEXT;
