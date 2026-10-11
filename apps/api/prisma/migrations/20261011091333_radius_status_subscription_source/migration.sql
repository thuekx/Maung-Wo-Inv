-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "radiusStatus" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "Customer_radiusStatus_idx" ON "Customer"("radiusStatus");

-- CreateIndex
CREATE INDEX "Subscription_customerId_idx" ON "Subscription"("customerId");

