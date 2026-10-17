# DRAF Dokumentasi Teknis — Maung WO (Work Order & Inventori ISP)

> **Status: draf mentah** (dibuat dari analisis kode `main` per 2026-10-17, commit `5b17abe`). Belum direview pemilik.
> Angka baris kode dihitung dari berkas yang di-commit (tanpa `generated/`, `node_modules`). Bagian bertanda **[cek]** perlu dikonfirmasi.

## 1. Gambaran umum
Maung WO (brand **MAUNG by LIV**) adalah aplikasi Work Order + inventori multi-gudang untuk ISP. Aplikasi ini juga berperan sebagai **"super app satu pintu"**: satu domain (`maung.liv.net.id`), satu login (WO menjadi penerbit identitas), beranda `/apps` berisi ikon aplikasi lain (mis. CRM di jalur `/crm`).

| Lapisan | Teknologi |
|---|---|
| Web | Next.js 16 + React 19.2 + Tailwind 3, `html5-qrcode` (scan SN/QR), `qrcode.react`, `leaflet` (peta) |
| API | Node.js 24 + Express 5 + TypeScript 5.9, Zod (validasi), JWT + bcryptjs, helmet/cors/rate-limit, multer + sharp (unggahan & kompresi gambar), exceljs (impor/ekspor Excel), nodemailer |
| Data | PostgreSQL 16 lewat Prisma 7 (`@prisma/adapter-pg`), 31 migrasi di `apps/api/prisma/migrations` |
| Antrian | Redis 7 + BullMQ (notifikasi, outbox, job terjadwal) |
| Infrastruktur | Docker Compose (`postgres`, `redis`, `migrate`, `api`, `worker`, `web`), overlay Caddy untuk HTTPS Let's Encrypt, Garage (S3) bersama di `platform/garage` |

## 2. Struktur repositori
```
apps/api/                    backend (Express + Prisma + worker)
  prisma/schema.prisma       33 model, 8 enum
  prisma/migrations/         31 migrasi (stempel UTC, lihat docs/MIGRATIONS.md)
  prisma/seed.ts, seed-demo.ts, reconcile-migrations.ts
  src/index.ts               server HTTP, urutan router, penanganan error (pesan Zod → Indonesia)
  src/workflows.ts (1559 b)  definisi 9 jenis WO: status, pemilik, aksi per peran, form, aturan bisnis
  src/engine.ts              mesin transisi status + cek hak akses + efek (notifikasi, stok)
  src/inventory.ts           mutasi stok/aset, Mobile Stock teknisi, QC
  src/effects.ts, queue.ts, worker.ts, senders.ts   outbox → BullMQ → email/Telegram/WhatsApp/webhook, cron
  src/access.ts              matriks hak akses fitur × divisi × sub-role (Admin → Hak Akses)
  src/radius.ts              sinkronisasi baca-saja dari MSRadius
  src/kanca.ts               integrasi WhatsApp (Kanca)
  src/backup.ts              backup/restore dari aplikasi (Admin → Data & Backup)
  src/ssl.ts                 pengelolaan Caddyfile / domain dari Admin
  src/routes/*.ts            21 modul REST (lihat §5)
  test/*.test.ts             6 berkas tes (node:test)
apps/web/                    frontend Next.js (App Router)
  src/app/(app)/*            halaman setelah login (dashboard, WO, pelanggan, inventori, PR/PO, master, laporan, …)
  src/app/admin/             panel Admin (21 tab)
  src/app/doc/{ba,form,pr,report}/[id]   dokumen cetak (BA digital, formulir berlangganan, PR berkop, laporan)
  src/app/a/[sn]             halaman publik info aset dari label QR
  src/app/qr-print, login, reset-password, apps (beranda launcher)
  src/components/            DynamicForm (form dinamis dari metadata workflow), DataTable (server-side), Scanner, MapPicker, …
  src/lib/                   api, auth, brand/tema, photo (GPS + banner logo), pr, terms
scripts/                     skrip operasi server (deploy, update-safe, setup, app-route, garage-*, offsite-backup, diagnose*)
scripts/tests/               tes skrip dengan docker tiruan (app-route, garage)
platform/garage/             stack Garage S3 bersama (WO + CRM)
proxy/                       Caddy (Caddyfile.init, entrypoint, sites/*.caddy, apps/)
docker-compose*.yml          stack utama, overlay Caddy, overlay dev
docs/                        dokumen rinci (API, INSTALL, FITUR, NOTIFIKASI, RADIUS-API, SCALE, BACKUP-NAS, maung-crm/…)
HANDOFF.md                   sumber serah-terima antar sesi
```

## 3. Arsitektur
```
Browser/HP ──HTTPS──► Caddy (80/443, Let's Encrypt)
                       ├─ /            → web (Next.js :3000)
                       ├─ /api         → api (Express :4000) ──► PostgreSQL
                       ├─ /crm         → aplikasi CRM (repo terpisah)       ▲
                       └─ /<app>       → aplikasi lain (scripts/app-route.sh) │
api ──► Redis ◄── worker (BullMQ) ──► SMTP · Telegram · WhatsApp (Kanca) · webhook billing (non-aktif)
worker ──► MSRadius (polling 5 menit, baca-saja)
```
- **Transaksi atomik**: perubahan status WO, mutasi stok, dan baris notifikasi (outbox) ditulis dalam satu transaksi Prisma; worker yang mengirim keluar (retry/backoff BullMQ).
- **Stateless**: state ada di Postgres & Redis, sehingga `api`/`worker` bisa direplikasi.
- **Migrasi**: service `migrate` menjalankan `reconcile-migrations` lalu `prisma migrate deploy` sebelum `api`/`worker` start.

## 4. Model data (ringkas)
| Kelompok | Model |
|---|---|
| Pengguna & akses | `User` (role + subRole), `AuditLog`, `Inbox`, `Setting` (termasuk rahasia terenkripsi, matriks akses) |
| Pelanggan & layanan | `Customer`, `CustomerChange`, `Area`, `Package`, `Subscription` (formulir berlangganan), `SyncRun` (MSRadius) |
| Work Order | `WorkOrder`, `WoEvent` (jejak per aksi, pelaku + peran + sub-role), `Attachment` (foto + GPS), `Counter`/nomor dokumen |
| Inventori | `Warehouse` (termasuk `MOBILE` per teknisi), `Item` (CONSUMABLE / NETWORK / GA), `StockLevel`, `StockMovement`, `Asset` (SN, status), `AssetBrand`, `AssetModel` |
| Pengadaan | `Vendor`, `PurchaseRequest`, `PrLine`, `PrQuote`, `PurchaseOrder`, `PoLine` |
| Notifikasi & integrasi | `Notification`, `OutboundEvent` (outbox), `WaTemplate`, `KancaEvent`, `CrmQuotation`, `CrmNotification` |

Enum penting: `Role` = ADMIN, MKT, NOC, FOC, GA (GA + Procurement digabung), FIN · `SubRole` = MANAGER, SUPERVISOR, STAFF · `WoType` (9 jenis, §6).

## 5. API REST (`/api`)
Urutan router di `src/index.ts`. Router tanpa JWT dipasang lebih dulu, masing-masing dengan pengamannya sendiri.

| Modul | Autentikasi | Endpoint utama |
|---|---|---|
| `kanca` (webhook) | HMAC | `POST /integrations/kanca/webhook` |
| `img` | publik | `GET /img` (versi terkompresi unggahan) |
| `integrations` | API key / secret | `POST /integrations/billing/events`, `GET /integrations/billing/customers/:code`, `POST /telegram/webhook/:secret`, `GET /branding` |
| `export` | `EXPORT_API_KEY` | `GET /export`, `GET /export/:resource` (JSON/CSV, paginasi, `since`) — docs/API.md |
| `crm` | `CRM_INTEGRATION_KEY` | katalog & quotation CRM, notifikasi CRM |
| `public` | publik | `GET /public/asset/:sn` (data aset aman untuk label QR) |
| `core` | JWT | auth (`/auth/me`, refresh, ganti password, kode Telegram), users, customers (baca), unggahan, inbox, dashboard, log notifikasi, pencarian global |
| `team` | JWT | tim FOC per manager |
| `admin` | JWT Admin | setelan SMTP/Telegram/WhatsApp/branding/keamanan/aplikasi, matriks hak akses |
| `masters` | JWT + fitur | CRUD pelanggan, impor/ekspor Excel, paket, merk/tipe, reset password, audit |
| `wo` | JWT + aturan workflow | `GET /work-orders/meta`, daftar/buat/detail, `POST /work-orders/:id/actions/:key`, cek stok, QC, progres lapangan |
| `inventory` | JWT + fitur | gudang, item, stok (mine/all/mutasi/transfer/opname), aset (register/QC/by-serial), PO + penerimaan |
| `procurement` | JWT + fitur | vendor, Purchase Request (submit/issue/decision/cancel → PO) |
| `radius` | JWT | setelan & sinkron MSRadius, tarik data per pelanggan |
| `areas`, `reports`, `sysapi`, `ssl`, `data`, `subscriptions`, `launcher` | JWT | master area, laporan & riwayat gangguan, katalog API sistem, SSL/domain, backup/restore/purge, formulir berlangganan, beranda `/apps` |

Lain-lain: `GET /health` (di luar `/api`), `/uploads` (berkas statis). Token login JWT berumur 5–720 menit (bawaan 30 menit, diperbarui lewat `/auth/refresh`). Admin dapat **bertindak sebagai** peran lain lewat header `X-Act-As`/`X-Act-Sub`.

## 6. Mesin Work Order
Satu mesin data-driven: `workflows.ts` mendefinisikan status (label, divisi pemilik, final/tidak) dan aksi (peran yang boleh, status tujuan, isian form, validasi). `engine.ts` mengeksekusi aksi, mengecek peran/penugasan, menjalankan efek, dan menulis `WoEvent`.

| Jenis | Pembuat | Status (urut) |
|---|---|---|
| `NEW_INSTALL` Pasang Baru | MKT | FOC_VALIDATION → STOCK_CHECK (otomatis) → STOCK_PENDING → READY_TO_SCHEDULE → SCHEDULED → IN_PROGRESS → PHYSICAL_DONE (aktivasi NOC) → AWAITING_BA (BA digital MKT) → CLOSED · REJECTED |
| `TROUBLE` Trouble Ticket | MKT, NOC | NOC_DIAGNOSE → FIELD_DISPATCH → FIELD_SCHEDULED → FIELD_IN_PROGRESS → NOC_VERIFY → MKT_CONFIRM → CLOSED |
| `SUSPEND` / `UNSUSPEND` | MKT, FIN | NOC_ISOLATE → DONE / NOC_RESTORE → DONE |
| `TERMINATE` | MKT, FIN | NOC_DEACTIVATE → DISMANTLE_DISPATCH → DISMANTLE_SCHEDULED → DISMANTLE_IN_PROGRESS → QC_PENDING (GA) → FIN_CLOSE → CLOSED |
| `STOCK_REQUEST` Permintaan Barang | FOC, NOC, GA (atau otomatis dari cek stok) | PROC_REVIEW → AWAITING_RECEIPT (mutasi gudang) atau PO_ISSUED → CLOSED |
| `STOCK_RETURN` Serah-terima sisa material | FOC | AWAITING_RECEIPT → CLOSED · REJECTED |
| `MAINTENANCE` | FOC (supervisor/manager) | SCHEDULED → IN_PROGRESS → CLOSED |
| `SERVICE_ORDER` Order jasa dari CRM | dari quotation CRM (WON) | SO_NEW → SO_SOURCE_CHECK (otomatis) → SO_SOURCING → SO_SCHEDULING → SO_SCHEDULED → SO_IN_PROGRESS → SO_AWAITING_BA → SO_DONE · SO_CANCELLED |

Aturan bisnis yang ditegakkan server (dari README + kode):
- Cek stok otomatis berdasarkan `Item.installDefaultQty` di gudang area pelanggan; kurang → WO Permintaan Barang anak, induk mengecek ulang saat anak selesai.
- Mobile Stock: SN yang dipasang harus ada di gudang `MOBILE` teknisi; material yang dilaporkan ≤ yang diambil; stok tidak boleh negatif.
- Validasi jaringan: IP internal wajib privat (RFC 1918), IP/ODP+port tidak boleh dobel, VLAN 1–4094.
- Teknisi hanya mengerjakan WO yang ditugaskan; jadwal oleh supervisor/manager FOC.
- Penarikan aset: SN yang tidak di-scan wajib beralasan (SCRAP); QC GA (Refurbished/Damaged/Scrap) sebelum Finance.

## 7. Worker & job terjadwal (`worker.ts`)
| Job | Jadwal | Fungsi |
|---|---|---|
| `notifications` | antrian | kirim email / Telegram / WhatsApp sesuai outbox |
| `billing-out` | antrian | webhook ke billing (mesin ada, alur tidak memancarkan event) |
| `maintenance-reminder` | 08:00 WIB | pengingat aset GA jatuh tempo perawatan + pembersihan harian (inbox > 90 hari, event Kanca lama, foto yatim > 2 hari) |
| `radius-tick` | tiap 5 menit | sinkron MSRadius (bila diaktifkan) |
| `auto-backup` | 02:30 WIB | backup aplikasi otomatis (Admin → Data & Backup) |
| `kanca-tick` | tiap 2 menit | status pengiriman WhatsApp Kanca |
| `sweep` | tiap 2 menit | mengantrikan ulang notifikasi/outbox yang masih PENDING > 2 menit |

## 8. Integrasi
- **MSRadius** (baca-saja): pelanggan, paket, area, status online/offline → `Customer.radiusStatus` (docs/RADIUS-API.md).
- **CRM** (`thuekx/maung-crm`, jalur `/crm`): WO = penerbit identitas (`/auth/me` mengembalikan `features`, fitur `app.crm`); CRM membaca Export API dan mengirim katalog/quotation; quotation WON → WO `SERVICE_ORDER`. Kontrak: `docs/maung-crm/INTEGRASI-WO.md`.
- **Notifikasi**: email SMTP, Telegram (chat pribadi via `/link KODE` + grup per divisi), WhatsApp via Kanca (template), lonceng dalam aplikasi (`Inbox`). Tanpa kredensial = dry-run tercatat.
- **Billing**: endpoint masuk (suspend/unsuspend/terminate) tersedia tetapi opsional; Finance hanya menerima pengingat.

## 9. Keamanan
- Password bcrypt; JWT; wajib ganti password setelah reset; lupa password dengan tautan 30 menit.
- Hak akses dua lapis: peran/aksi di workflow + matriks fitur (`access.ts`, `requireFeature`) yang diatur Admin; web menyembunyikan menu, server tetap menolak.
- Rahasia integrasi disimpan terenkripsi di `Setting`; `.env` tidak di-commit.
- helmet, CORS, rate limit; webhook diverifikasi HMAC; API eksternal memakai API key terpisah.
- Catatan risiko (README §9): token di `localStorage`; GPS foto divalidasi keberadaannya saja; belum ada reservasi stok.

## 10. Operasi & deploy
| Kebutuhan | Perintah / berkas |
|---|---|
| Instal baru | `scripts/setup.sh` (tanya-jawab) atau `install-server.sh` + `deploy.sh --domain …` (docs/INSTALL.md) |
| Update produksi | `cd ~/Maung-Wo-Inv && bash scripts/update-safe.sh </dev/null` (sudah menjalankan `deploy.sh`, ada rollback) |
| Jalur aplikasi lain di domain yang sama | `scripts/app-route.sh add|remove|status` |
| Garage S3 bersama | `scripts/garage-platform.sh`, `garage-app.sh`, `garage-backup.sh` |
| Backup ke NAS | `scripts/offsite-backup.sh siapkan|test|run|cron` → UGREEN (SMB + restic via Tailscale container), harian 03:30 (docs/BACKUP-NAS.md) |
| Diagnosa | `scripts/diagnose.sh`, `scripts/diagnose-login.sh` |

## 11. Pengujian & CI
- `apps/api`: `npm test` — 6 berkas tes (`caddy`, `crm`, `customer-links`, `export`, `launcher`, `service-order`) dengan DB uji.
- Skrip: `scripts/tests/app-route.test.sh`, `scripts/tests/garage.test.sh` (docker tiruan).
- GitHub Actions (`.github/workflows/ci.yml`): instal dependensi → Prisma generate + migrasi DB uji → typecheck API & web → tes API → tes skrip → `bash -n` semua skrip.
- Belum ada: tes end-to-end browser di CI, tes untuk alur WO lama (Pasang Baru, Trouble, Terminate) [cek].

## 12. Temuan selama analisis (untuk ditindaklanjuti)
1. README §5 menulis Pasang Baru dimulai `NOC_VALIDATION` dan "6 workflow"; kode sekarang dimulai `FOC_VALIDATION` dan ada 9 jenis WO.
2. README §9 menyebut "Belum ada test otomatis"; sekarang ada tes API + CI.
3. README "Backup harian" (cron `pg_dump` manual) sudah digantikan backup aplikasi 02:30 + `offsite-backup.sh` 03:30.
4. HANDOFF §5 menyebut migrasi terakhir `20261008175910_inbox_user_fk`; yang terbaru `20261013200000_crm_links_notify`.
5. `workflows.ts` (1559 baris) memuat semua alur dalam satu berkas; kandidat dipecah per jenis WO bila bertambah.
