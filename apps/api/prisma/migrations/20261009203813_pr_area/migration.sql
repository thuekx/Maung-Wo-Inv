-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "areaId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: kode surat PR memakai singkatan area (L1V/PNJ-{ALIAS}); yang masih bawaan lama diganti
UPDATE "Setting" SET "value" = jsonb_set("value", '{codePrefix}', '"L1V/PNJ-{ALIAS}"') WHERE "key" = 'docs' AND "value"->>'codePrefix' = 'L1V/PNJ-BDG';
