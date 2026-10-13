-- Tautan CRM pada pelanggan (induk akun, nomor Lead) dan idempotensi notifikasi dari CRM
ALTER TABLE "Customer" ADD COLUMN "parentCustomerCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "crmLeadRef" TEXT;
CREATE UNIQUE INDEX "Customer_crmLeadRef_key" ON "Customer"("crmLeadRef");
CREATE INDEX "Customer_parentCustomerCode_idx" ON "Customer"("parentCustomerCode");

CREATE TABLE "CrmNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrmNotification_userId_dedupeKey_key" ON "CrmNotification"("userId", "dedupeKey");
CREATE INDEX "CrmNotification_createdAt_idx" ON "CrmNotification"("createdAt");
