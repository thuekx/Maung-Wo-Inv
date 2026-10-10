-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "providerMsgId" TEXT,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "providerStatus" TEXT;

-- CreateTable
CREATE TABLE "WaTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT,
    "body" TEXT,
    "varCount" INTEGER NOT NULL DEFAULT 1,
    "purpose" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KancaEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KancaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaTemplate_templateId_key" ON "WaTemplate"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "KancaEvent_deliveryId_key" ON "KancaEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "KancaEvent_receivedAt_idx" ON "KancaEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "Notification_providerRef_idx" ON "Notification"("providerRef");

-- CreateIndex
CREATE INDEX "Notification_providerMsgId_idx" ON "Notification"("providerMsgId");

