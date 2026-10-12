-- Tahap 2b integrasi CRM: WO Order Jasa/Produk, status aset "dibeli pelanggan", jejak marketing pada PR proyek
ALTER TYPE "WoType" ADD VALUE IF NOT EXISTS 'SERVICE_ORDER';
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'SOLD_TO_CUSTOMER';
ALTER TABLE "PurchaseRequest" ADD COLUMN "crmMarketingUserId" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "crmMarketingName" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "crmQuotationNo" TEXT;
