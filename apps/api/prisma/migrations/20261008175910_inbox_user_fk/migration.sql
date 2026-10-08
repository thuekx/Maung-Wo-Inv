-- Inbox.userId kini punya foreign key ke User (ON DELETE CASCADE).
-- Baris yatim (user sudah tidak ada) dibersihkan dulu agar constraint dapat dipasang.
DELETE FROM "Inbox" WHERE "userId" NOT IN (SELECT "id" FROM "User");

-- AddForeignKey
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
