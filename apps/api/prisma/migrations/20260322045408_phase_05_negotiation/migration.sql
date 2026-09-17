-- CreateTable
CREATE TABLE "contract_comments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionId" TEXT,
    "clauseRef" TEXT,
    "parentId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_share_links" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "version_diff_cache" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "v1Id" TEXT NOT NULL,
    "v2Id" TEXT NOT NULL,
    "diffHtml" TEXT NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "version_diff_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_comments_orgId_contractId_idx" ON "contract_comments"("orgId", "contractId");

-- CreateIndex
CREATE INDEX "contract_comments_contractId_clauseRef_idx" ON "contract_comments"("contractId", "clauseRef");

-- CreateIndex
CREATE INDEX "contract_comments_contractId_parentId_idx" ON "contract_comments"("contractId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_share_links_token_key" ON "contract_share_links"("token");

-- CreateIndex
CREATE INDEX "contract_share_links_orgId_contractId_idx" ON "contract_share_links"("orgId", "contractId");

-- CreateIndex
CREATE INDEX "contract_share_links_token_idx" ON "contract_share_links"("token");

-- CreateIndex
CREATE INDEX "version_diff_cache_contractId_idx" ON "version_diff_cache"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "version_diff_cache_v1Id_v2Id_key" ON "version_diff_cache"("v1Id", "v2Id");

-- AddForeignKey
ALTER TABLE "contract_comments" ADD CONSTRAINT "contract_comments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_comments" ADD CONSTRAINT "contract_comments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_comments" ADD CONSTRAINT "contract_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "contract_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_share_links" ADD CONSTRAINT "contract_share_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_share_links" ADD CONSTRAINT "contract_share_links_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
