-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Customer_archivedAt_idx" ON "Customer"("archivedAt");


-- "Mobile stock" diganti istilah "Stok berjalan" pada nama gudang milik teknisi
UPDATE "Warehouse" SET "name" = replace("name", 'Mobile Stock', 'Stok Berjalan') WHERE "kind" = 'MOBILE';
