-- Uji sambung CRM→WO: penanda demo pada penawaran dan PR proyek turunannya (WO/pelanggan memakai source 'CRM_DEMO')
ALTER TABLE "CrmQuotation" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseRequest" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
