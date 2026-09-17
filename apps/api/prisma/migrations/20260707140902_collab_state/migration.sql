-- CreateTable
CREATE TABLE "collab_states" (
    "documentName" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collab_states_pkey" PRIMARY KEY ("documentName")
);
