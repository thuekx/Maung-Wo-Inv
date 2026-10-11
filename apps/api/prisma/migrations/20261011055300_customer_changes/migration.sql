-- CreateTable
CREATE TABLE "CustomerChange" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" TEXT NOT NULL DEFAULT 'RADIUS',
    "syncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerChange_customerId_createdAt_idx" ON "CustomerChange"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerChange_syncRunId_idx" ON "CustomerChange"("syncRunId");

