# Aturan migrasi database

Migrasi Prisma ada di `apps/api/prisma/migrations/<UTC-timestamp>_<nama>/migration.sql` dan dijalankan service `migrate` (`prisma migrate deploy`) sebelum API/worker start.

1. **Buat dengan stempel waktu asli (UTC).** Pakai `bash scripts/new-migration.sh nama_singkat` (atau `npx prisma migrate dev --create-only --name nama`). **Jangan** membuat/menamai folder migrasi manual, dan jangan memajukan tanggalnya agar "pasti terurut" — urutan sudah terjamin oleh waktu pembuatan sebenarnya. Skrip menolak stempel yang tidak lebih baru dari migrasi terakhir.
2. **Migrasi yang sudah di-push tidak boleh diubah isinya maupun namanya.** Database yang sudah menjalankannya mencatat nama + checksum; mengganti salah satunya membuat `migrate deploy` mengulang atau menolak migrasi. Perbaikan = migrasi baru.
3. Bila penggantian nama tak terhindarkan (pernah terjadi satu kali, lihat di bawah), daftarkan pasangan nama lama→baru di `apps/api/prisma/reconcile-migrations.ts` (`RENAMED`). Service `migrate` menjalankannya sebelum `migrate deploy`; aman diulang dan tidak berefek pada database baru.
4. Perubahan data (UPDATE/DELETE pembersihan) boleh ditulis di file migrasi yang sama sebelum DDL (mis. `20261008054937_roles_masters_audit` memetakan peran lama; `…_inbox_user_fk` membuang baris yatim sebelum memasang foreign key).
5. Sebelum push: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` harus keluar 0 setelah migrasi diterapkan (tidak ada selisih schema vs database).

## Catatan sejarah (satu kali)
Tiga migrasi awal sempat bernama tanggal 9–11 Okt 2026 padahal dibuat 8 Okt 2026 (UTC). Telah diganti ke stempel waktu commit sebenarnya:

| Nama lama | Nama baru |
|---|---|
| `20261009000000_roles_masters_audit` | `20261008054937_roles_masters_audit` |
| `20261010000000_scale_indexes` | `20261008163030_scale_indexes` |
| `20261011000000_inbox` | `20261008175007_inbox` |

Database yang sudah memakai nama lama diselaraskan otomatis oleh `reconcile-migrations` (terverifikasi pada database lama dan baru).

## Relasi & penghapusan user
- `Inbox.userId` punya foreign key ke `User` dengan `ON DELETE CASCADE`: menghapus user ikut menghapus kotak masuknya.
- Tabel lain yang menyimpan id user tanpa foreign key **sengaja** begitu: `AuditLog` (jejak audit harus tetap ada walau user dihapus), `Notification` (log pengiriman), `Attachment.uploadedBy`, `StockMovement.actorId`. User dengan riwayat WO tidak dapat dihapus (hanya dinonaktifkan), jadi sisa referensi itu hanya log historis.
