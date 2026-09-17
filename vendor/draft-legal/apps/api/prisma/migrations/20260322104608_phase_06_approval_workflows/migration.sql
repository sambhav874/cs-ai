-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerRules" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instances" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentStepOrder" INTEGER NOT NULL DEFAULT 0,
    "submittedById" TEXT NOT NULL,
    "aiSummary" TEXT,
    "keyRisks" JSONB NOT NULL DEFAULT '[]',
    "nonStandardTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvalRecommendation" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "approvalInstanceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "comment" TEXT,
    "delegatedToId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "escalationJobId" TEXT,
    "escalateAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_definitions_orgId_isActive_idx" ON "workflow_definitions"("orgId", "isActive");

-- CreateIndex
CREATE INDEX "workflow_definitions_orgId_isDefault_idx" ON "workflow_definitions"("orgId", "isDefault");

-- CreateIndex
CREATE INDEX "approval_instances_orgId_status_idx" ON "approval_instances"("orgId", "status");

-- CreateIndex
CREATE INDEX "approval_instances_contractId_idx" ON "approval_instances"("contractId");

-- CreateIndex
CREATE INDEX "approval_instances_orgId_submittedById_idx" ON "approval_instances"("orgId", "submittedById");

-- CreateIndex
CREATE INDEX "approval_steps_approvalInstanceId_idx" ON "approval_steps"("approvalInstanceId");

-- CreateIndex
CREATE INDEX "approval_steps_approverId_status_idx" ON "approval_steps"("approverId", "status");

-- CreateIndex
CREATE INDEX "approval_steps_orgId_status_idx" ON "approval_steps"("orgId", "status");

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "notifications"("userId", "read");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
