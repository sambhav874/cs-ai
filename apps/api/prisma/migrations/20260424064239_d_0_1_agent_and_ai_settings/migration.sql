-- CreateTable
CREATE TABLE "agent_threads" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scopeType" TEXT,
    "scopeId" TEXT,
    "originSkillId" TEXT,
    "providerHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "agent_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "tier" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DECIMAL(10,6),
    "isByok" BOOLEAN NOT NULL DEFAULT false,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_calls" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "reversible" BOOLEAN NOT NULL DEFAULT false,
    "rollbackHook" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackById" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "contextScope" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "allowedTools" TEXT[],
    "modelTier" TEXT NOT NULL,
    "triggerTypes" TEXT[],
    "followUps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresRole" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_invocations" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "skillVersion" INTEGER NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contextType" TEXT,
    "contextId" TEXT,
    "inputMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_ai_keys" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "testStatus" TEXT,
    "testError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_ai_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_ai_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reasoningModel" TEXT,
    "defaultModel" TEXT,
    "fastModel" TEXT,
    "embedModel" TEXT,
    "rerankModel" TEXT,
    "visionOcrModel" TEXT,
    "dailyCostCapUsd" DECIMAL(10,2),
    "capPolicy" TEXT NOT NULL DEFAULT 'block',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_usage_daily" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "toolName" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "isByok" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "org_usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_threads_orgId_userId_updatedAt_idx" ON "agent_threads"("orgId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "agent_threads_orgId_scopeType_scopeId_idx" ON "agent_threads"("orgId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "agent_messages_threadId_createdAt_idx" ON "agent_messages"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_calls_threadId_createdAt_idx" ON "tool_calls"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_calls_entityType_entityId_idx" ON "tool_calls"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "skills_orgId_ownerType_isPublished_idx" ON "skills"("orgId", "ownerType", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "skills_orgId_slug_key" ON "skills"("orgId", "slug");

-- CreateIndex
CREATE INDEX "skill_invocations_orgId_userId_createdAt_idx" ON "skill_invocations"("orgId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "skill_invocations_skillId_createdAt_idx" ON "skill_invocations"("skillId", "createdAt");

-- CreateIndex
CREATE INDEX "org_ai_keys_orgId_isActive_idx" ON "org_ai_keys"("orgId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "org_ai_keys_orgId_provider_key" ON "org_ai_keys"("orgId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "org_ai_settings_orgId_key" ON "org_ai_settings"("orgId");

-- CreateIndex
CREATE INDEX "org_usage_daily_orgId_date_idx" ON "org_usage_daily"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "org_usage_daily_orgId_date_provider_model_tier_toolName_isB_key" ON "org_usage_daily"("orgId", "date", "provider", "model", "tier", "toolName", "isByok");

-- AddForeignKey
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_originSkillId_fkey" FOREIGN KEY ("originSkillId") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_invocations" ADD CONSTRAINT "skill_invocations_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_invocations" ADD CONSTRAINT "skill_invocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_invocations" ADD CONSTRAINT "skill_invocations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_ai_keys" ADD CONSTRAINT "org_ai_keys_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_ai_keys" ADD CONSTRAINT "org_ai_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_ai_settings" ADD CONSTRAINT "org_ai_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
