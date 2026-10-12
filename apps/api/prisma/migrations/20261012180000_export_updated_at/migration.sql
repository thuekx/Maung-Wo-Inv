-- Export API: ?since memakai updatedAt (perubahan status pelanggan/paket terlihat di tarikan inkremental)
ALTER TABLE "Customer" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Customer" SET "updatedAt" = GREATEST("createdAt", COALESCE("syncedAt", "createdAt"));
CREATE INDEX "Customer_updatedAt_idx" ON "Customer"("updatedAt");

ALTER TABLE "Package" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Package" SET "updatedAt" = "createdAt";
