-- Tahap 2a integrasi CRM: katalog jasa/produk (Package.kind/unit/crmId/sku) dan penawaran (CrmQuotation)
ALTER TABLE "Package" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'INTERNET';
ALTER TABLE "Package" ADD COLUMN "unit" TEXT;
ALTER TABLE "Package" ADD COLUMN "crmId" TEXT;
ALTER TABLE "Package" ADD COLUMN "sku" TEXT;
CREATE UNIQUE INDEX "Package_crmId_key" ON "Package"("crmId");

CREATE TABLE "CrmQuotation" (
    "id" TEXT NOT NULL,
    "crmId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "customerCode" TEXT,
    "customer" JSONB NOT NULL,
    "marketingUserId" TEXT,
    "marketingName" TEXT,
    "lines" JSONB NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "taxNote" TEXT,
    "terms" TEXT,
    "woId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmQuotation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrmQuotation_crmId_key" ON "CrmQuotation"("crmId");
CREATE INDEX "CrmQuotation_status_idx" ON "CrmQuotation"("status");
CREATE INDEX "CrmQuotation_updatedAt_idx" ON "CrmQuotation"("updatedAt");
