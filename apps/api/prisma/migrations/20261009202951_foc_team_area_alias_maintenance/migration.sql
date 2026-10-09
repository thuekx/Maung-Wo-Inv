-- AlterEnum
ALTER TYPE "WoType" ADD VALUE 'MAINTENANCE';

-- AlterTable
ALTER TABLE "Area" ADD COLUMN     "alias" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "pop" TEXT;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "teamIds" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- Data: tim = teknisi yang sudah ditugaskan; validasi teknis awal kini oleh FOC (bukan NOC); alias area awal dari 3 huruf pertama nama
UPDATE "WorkOrder" SET "teamIds" = ARRAY["assigneeId"] WHERE "assigneeId" IS NOT NULL AND cardinality("teamIds") = 0;
UPDATE "WorkOrder" SET "status" = 'FOC_VALIDATION' WHERE "type" = 'NEW_INSTALL' AND "status" = 'NOC_VALIDATION';
UPDATE "Area" SET "alias" = UPPER(LEFT(regexp_replace("name", '[^A-Za-z0-9]', '', 'g'), 3)) WHERE "alias" IS NULL;
