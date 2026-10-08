-- CreateTable
CREATE TABLE "Inbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "woId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Inbox_userId_createdAt_idx" ON "Inbox"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Inbox_userId_readAt_idx" ON "Inbox"("userId", "readAt");

