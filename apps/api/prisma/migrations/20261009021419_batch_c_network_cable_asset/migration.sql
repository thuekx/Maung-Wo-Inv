-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "chassisNumber" TEXT,
ADD COLUMN     "maintenanceIntervalDays" INTEGER,
ADD COLUMN     "needsMaintenance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plateNumber" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "publicIp" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "coreCount" INTEGER,
ADD COLUMN     "isVehicle" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Customer_publicIp_idx" ON "Customer"("publicIp");


-- Data: kabel dropcore bawaan = 1 core; aset GA yang sudah punya jadwal perawatan ditandai "perlu perawatan"
UPDATE "Item" SET "coreCount" = 1 WHERE "sku" = 'DROPCORE' AND "coreCount" IS NULL;
UPDATE "Asset" SET "needsMaintenance" = true WHERE "nextMaintenanceAt" IS NOT NULL;
UPDATE "Item" SET "isVehicle" = true WHERE "sku" IN ('CAR', 'MOTOR') AND "category" = 'GA';
