-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "contractType" TEXT,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_sections" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',
    "conditionalLogic" JSONB,
    "clauseRefs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clause_categories" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentCategoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clause_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clause_library_items" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "riskRating" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "versions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clause_library_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbook_positions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clauseCategoryId" TEXT NOT NULL,
    "positionType" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "riskThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "contractTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playbook_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "templates_orgId_contractType_idx" ON "templates"("orgId", "contractType");

-- CreateIndex
CREATE INDEX "templates_orgId_isPublished_idx" ON "templates"("orgId", "isPublished");

-- CreateIndex
CREATE INDEX "template_sections_templateId_idx" ON "template_sections"("templateId");

-- CreateIndex
CREATE INDEX "clause_categories_orgId_idx" ON "clause_categories"("orgId");

-- CreateIndex
CREATE INDEX "clause_categories_orgId_parentCategoryId_idx" ON "clause_categories"("orgId", "parentCategoryId");

-- CreateIndex
CREATE INDEX "clause_library_items_orgId_categoryId_idx" ON "clause_library_items"("orgId", "categoryId");

-- CreateIndex
CREATE INDEX "clause_library_items_orgId_isApproved_idx" ON "clause_library_items"("orgId", "isApproved");

-- CreateIndex
CREATE INDEX "playbook_positions_orgId_clauseCategoryId_idx" ON "playbook_positions"("orgId", "clauseCategoryId");

-- CreateIndex
CREATE INDEX "playbook_positions_orgId_positionType_idx" ON "playbook_positions"("orgId", "positionType");

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_categories" ADD CONSTRAINT "clause_categories_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_categories" ADD CONSTRAINT "clause_categories_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "clause_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_library_items" ADD CONSTRAINT "clause_library_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_library_items" ADD CONSTRAINT "clause_library_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "clause_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_positions" ADD CONSTRAINT "playbook_positions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_positions" ADD CONSTRAINT "playbook_positions_clauseCategoryId_fkey" FOREIGN KEY ("clauseCategoryId") REFERENCES "clause_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
