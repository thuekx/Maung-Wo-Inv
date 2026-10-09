-- AlterTable
ALTER TABLE "PoLine" ADD COLUMN     "description" TEXT,
ADD COLUMN     "unitPrice" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "poDate" TIMESTAMP(3),
ADD COLUMN     "prId" TEXT,
ADD COLUMN     "taxPct" DECIMAL(5,2),
ADD COLUMN     "vendorId" TEXT;

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Bandung',
    "docDate" TIMESTAMP(3),
    "taxPct" DECIMAL(5,2) NOT NULL DEFAULT 11,
    "note" TEXT,
    "woId" TEXT,
    "createdById" TEXT NOT NULL,
    "signRequester" TEXT,
    "signRequesterTitle" TEXT,
    "signKnow" TEXT,
    "signApprove" TEXT,
    "issuedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvalRef" TEXT,
    "approvalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrLine" (
    "id" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Unit',
    "itemId" TEXT,
    "note" TEXT,
    "poLineId" TEXT,

    CONSTRAINT "PrLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrQuote" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "chosen" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PrQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_number_key" ON "PurchaseRequest"("number");

-- CreateIndex
CREATE INDEX "PurchaseRequest_status_createdAt_idx" ON "PurchaseRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseRequest_createdById_idx" ON "PurchaseRequest"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "PrLine_poLineId_key" ON "PrLine"("poLineId");

-- CreateIndex
CREATE INDEX "PrLine_prId_idx" ON "PrLine"("prId");

-- CreateIndex
CREATE UNIQUE INDEX "PrQuote_lineId_vendorId_key" ON "PrQuote"("lineId", "vendorId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_prId_idx" ON "PurchaseOrder"("prId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_woId_fkey" FOREIGN KEY ("woId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrLine" ADD CONSTRAINT "PrLine_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrLine" ADD CONSTRAINT "PrLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrLine" ADD CONSTRAINT "PrLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PoLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrQuote" ADD CONSTRAINT "PrQuote_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PrLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrQuote" ADD CONSTRAINT "PrQuote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: nama vendor pada PO lama → master Vendor
INSERT INTO "Vendor" ("id", "name") SELECT 'ven' || substr(md5(v), 1, 20), v FROM (SELECT DISTINCT "vendor" AS v FROM "PurchaseOrder") x ON CONFLICT DO NOTHING;
UPDATE "PurchaseOrder" po SET "vendorId" = v."id" FROM "Vendor" v WHERE v."name" = po."vendor" AND po."vendorId" IS NULL;
