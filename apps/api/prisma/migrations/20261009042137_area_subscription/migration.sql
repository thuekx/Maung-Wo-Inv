-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "areaId" TEXT;

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "warehouseId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "regNo" TEXT NOT NULL,
    "formDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "referral" TEXT,
    "packageName" TEXT,
    "serviceNote" TEXT,
    "installFee" DECIMAL(18,2),
    "monthlyFee" DECIMAL(18,2),
    "picName" TEXT,
    "picPhone" TEXT,
    "payment" TEXT NOT NULL DEFAULT 'TRANSFER',
    "marketingName" TEXT,
    "managerName" TEXT,
    "createdById" TEXT NOT NULL,
    "customerId" TEXT,
    "woId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Area_code_key" ON "Area"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Area_name_key" ON "Area"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_regNo_key" ON "Subscription"("regNo");

-- CreateIndex
CREATE INDEX "Subscription_createdAt_idx" ON "Subscription"("createdAt");

-- CreateIndex
CREATE INDEX "Subscription_name_idx" ON "Subscription"("name");

-- CreateIndex
CREATE INDEX "Customer_areaId_idx" ON "Customer"("areaId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: tiap gudang non-berjalan menjadi Area awal (nama tanpa awalan "Gudang"), pelanggan ditautkan ke area gudangnya
INSERT INTO "Area" ("id", "name", "warehouseId", "source")
SELECT 'are' || substr(md5("id"), 1, 20), regexp_replace("name", '^Gudang\s+', ''), "id", 'MANUAL' FROM "Warehouse" WHERE "kind" IN ('MAIN', 'BRANCH')
ON CONFLICT DO NOTHING;
UPDATE "Customer" c SET "areaId" = a."id" FROM "Area" a WHERE a."warehouseId" = c."warehouseId" AND c."areaId" IS NULL;

-- Sinkron MSRadius sekarang juga membawa master Area
ALTER TABLE "SyncRun" ADD COLUMN IF NOT EXISTS "areas" INTEGER NOT NULL DEFAULT 0;
