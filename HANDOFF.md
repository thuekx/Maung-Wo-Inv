# HANDOFF — Maung-Wo-Inv

Dokumen serah-terima agar pekerjaan bisa dilanjutkan di komputer/sesi mana pun.

## Status (2026-10-08)
Kode lengkap tahap awal sudah ditulis, **belum pernah dijalankan, di-typecheck, atau diuji** (lingkungan pembuatnya tidak punya Node/Docker). Anggap ini "draft lengkap yang perlu di-debug", bukan "siap produksi".

## Langkah pertama di komputer Anda
```bash
git clone https://github.com/thuekx/Maung-Wo-Inv.git && cd Maung-Wo-Inv
cd apps/api && npm install && npm run typecheck   # perbaiki error tipe bila ada
cd ../web && npm install && npm run typecheck
```
Lalu jalankan penuh: `sudo bash scripts/install-server.sh` lalu `bash scripts/deploy.sh` — lihat README bagian 4. **Platform target: Ubuntu 24.04 LTS saja** (skrip Windows sudah dihapus). Skrip instalasi belum pernah dijalankan; uji di VM Ubuntu 24.04 bersih dulu (Node 24 untuk typecheck: `sudo INSTALL_NODE=1 bash scripts/install-server.sh` atau nvm, ada `.nvmrc`).
Uji alur wajib: **Pasang Baru** (mkt → noc → otomatis cek stok → budi (FOC) jadwal/ambil material/lapor → noc aktivasi → mkt kirim BA) dengan login `*@l1v.local` / `Passw0rd!`. Perhatikan: SN demo ada di Gudang Pusat (`ONT-DEMO-0001…`); pelanggan di Cabang A sengaja kekurangan stok sehingga memicu WO Permintaan Barang otomatis.

## Keputusan desain (jangan diubah tanpa alasan)
- Stack: Next.js 16 + React 19.2, Node 24 LTS, Express 5 + TypeScript 5.9, Prisma 7 (adapter-pg, klien di `src/generated/prisma` format CJS), PostgreSQL 16, Redis 7 + BullMQ 5, Tailwind 3.
- Upgrade Prisma 6→7 & Next 15→16 ditulis tanpa dijalankan: periksa `apps/api/src/orm.ts`, `db.ts`, `prisma.config.ts`, `schema.prisma` (generator `prisma-client`) bila build gagal. TypeScript sengaja ditahan di 5.9 (TS 7 = compiler native, belum diuji); Tailwind tetap v3 (v4 butuh migrasi config).
- Semua alur = **satu mesin workflow data-driven** (`apps/api/src/workflows.ts` + `engine.ts`). Menambah/ubah tahap = edit definisi status/aksi; frontend merender form otomatis dari metadata (`GET /api/work-orders/meta`).
- Efek samping (notifikasi email/Telegram, event ke billing) ditulis ke DB dalam transaksi yang sama (outbox), dikirim worker BullMQ setelah commit.
- Stok kuantitas lewat `moveStock` (atomik, tidak boleh negatif); aset ber-SN lewat `moveAsset`. Setiap teknisi punya gudang `MOBILE`.
- Cek stok pasang baru otomatis berdasar `Item.installDefaultQty` di gudang pelanggan; kurang → WO anak `STOCK_REQUEST`, induk lanjut sendiri saat anak selesai.
- Finance hanya **pengingat** (Telegram + email) saat NOC aktivasi dan saat Marketing kirim BA; tidak ada event ke billing. Data keluar lewat Export API (`routes/export.ts`, `docs/API.md`).
- Pengaturan Admin (SMTP, Telegram, logo PT, kebijakan GPS) disimpan di tabel `Setting` (rahasia AES-GCM, kunci dari `JWT_SECRET`), dibaca lewat `src/settings.ts` dengan cache 10 dtk; `.env` hanya fallback. Foto lapangan: watermark di browser (`web/src/lib/photo.ts`), metadata GPS di `Attachment`; progres lapangan `POST /work-orders/:id/progress`.
- Data demo: `prisma/seed-demo.ts` (menjalankan engine asli; notifikasi demo di-set SKIPPED).
- Tema terang/gelap/ikuti-sistem: `apps/web/src/lib/theme.tsx` (kelas `dark`, override di `globals.css`); grafik SVG tanpa library di `components/charts.tsx`.

## Peta file
| Area | File |
|---|---|
| Model data | `apps/api/prisma/schema.prisma`, seed `apps/api/prisma/seed.ts` |
| Alur bisnis (6 workflow) | `apps/api/src/workflows.ts`, tipe `wf-types.ts` |
| Mesin transisi, hak akses | `apps/api/src/engine.ts` |
| Stok/aset/QC | `apps/api/src/inventory.ts`, `routes/inventory.ts` |
| Notifikasi & outbox | `effects.ts`, `worker.ts`, `senders.ts`, `queue.ts` |
| Integrasi billing & Telegram | `routes/integrations.ts` |
| Form dinamis (scan SN, foto, QC) | `apps/web/src/components/DynamicForm.tsx` |
| Halaman | `apps/web/src/app/(app)/*` |

## Daftar pekerjaan berikutnya (prioritas)
1. ~~Typecheck, migrasi Prisma, `migrate deploy`, lockfile + `npm ci`~~ — selesai (migrasi `20261008000000_init` diverifikasi terhadap Postgres 16). `next build` dan build API lolos. Masih perlu: uji stack Docker penuh di VM Ubuntu 24.04.
2. Uji end-to-end ke-7 alur; tulis test (Vitest) untuk `engine`, `inventory` (stok tak boleh negatif), dan webhook billing.
3. Hubungkan billing nyata: pemetaan `Customer.code` ↔ ID pelanggan billing (tambah `externalId`), isi `BILLING_*` di `.env`, sepakati format payload.
4. Set bot Telegram (webhook) dan SMTP nyata; uji notifikasi tiap tahap.
5. Reservasi stok untuk pasang baru bersamaan.
6. Produksi: foto ke S3 + signed URL, token ke cookie httpOnly, backup Postgres, reverse proxy TLS.
7. Opsional: laporan SLA/MTTR/stok, integrasi OLT/Mikrotik, peta teknisi.

## Melanjutkan pekerjaan
Buka folder repo di editor/asisten pengembangan Anda, lalu minta: *"Baca HANDOFF.md dan README.md, jalankan typecheck, lalu kerjakan butir 1 dan 2."* Kedua file itu cukup sebagai konteks.

## Fitur tambahan (selesai)
Sepuluh fitur tambahan sudah dikerjakan — lihat `docs/FITUR.md`: reset password satuan/massal, cetak QR massal A4, edit semua data master, GA+Procurement satu peran (migrasi `PROC`→`GA`), merk & tipe aset, impor/ekspor Excel pelanggan, dashboard WO > 7 hari, pelanggan manual, master paket/jasa, hapus per peran + notifikasi Admin + log audit.
Penambahan berikutnya akan diinfokan oleh pemilik proyek; jangan menambah fitur di luar daftar tanpa konfirmasi.

## Catatan teknis fitur tambahan
- Jejak audit: `src/audit.ts` (`auditedUpdate`, `auditedDelete`, `writeAudit`), tabel `AuditLog`; hapus oleh non-Admin → notify ADMIN.
- `routes/masters.ts`: pelanggan (manual/impor/ekspor, exceljs), paket, merk/tipe, reset password, hapus user, audit.
- Peran `PROC` dihapus dari enum (migrasi `20261009000000_roles_masters_audit`); owner status workflow memakai `GA`.
- Cetak QR: `web/src/app/qr-print/page.tsx` (di luar layout aplikasi; ukuran dalam mm).
