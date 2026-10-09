-- CreateEnum
CREATE TYPE "SubRole" AS ENUM ('MANAGER', 'SUPERVISOR', 'STAFF');

-- AlterEnum
ALTER TYPE "WoType" ADD VALUE 'STOCK_RETURN';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "subRole" "SubRole" NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE "WoEvent" ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "actorSubRole" TEXT;


-- Data: riwayat lama diberi peran pelaku sesuai peran akun saat ini (snapshot sebenarnya mulai dari sini)
UPDATE "WoEvent" e SET "actorRole" = u."role"::text FROM "User" u WHERE e."actorId" = u."id" AND e."actorRole" IS NULL;
