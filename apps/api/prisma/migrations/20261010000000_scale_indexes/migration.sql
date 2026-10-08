-- Indeks untuk pencarian ILIKE %kata% (pg_trigram) dan urutan/penyaringan di tabel besar
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");

-- CreateIndex
CREATE INDEX "Asset_itemId_status_idx" ON "Asset"("itemId", "status");

-- CreateIndex
CREATE INDEX "Asset_serial_trgm" ON "Asset" USING GIN ("serialNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Asset_code_trgm" ON "Asset" USING GIN ("assetCode" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");

-- CreateIndex
CREATE INDEX "Customer_name_trgm" ON "Customer" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_code_trgm" ON "Customer" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_phone_trgm" ON "Customer" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_ip_trgm" ON "Customer" USING GIN ("ip" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_createdAt_idx" ON "WorkOrder"("createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_closedAt_createdAt_idx" ON "WorkOrder"("closedAt", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_number_trgm" ON "WorkOrder" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "WorkOrder_title_trgm" ON "WorkOrder" USING GIN ("title" gin_trgm_ops);

