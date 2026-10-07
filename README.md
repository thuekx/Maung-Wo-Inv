# Maung-Wo-Inv — L1V WO & Inventory

Aplikasi Work Order + Inventori multi-gudang untuk ISP (MKT · NOC · FOC · PROC/GA · FIN), terintegrasi dua arah dengan aplikasi Billing/Finance eksisting. Semua perpindahan tahap dikirim ke **email dan Telegram**.

## 1. Stack yang dipilih (dan alasannya)

| Lapisan | Pilihan | Alasan singkat |
|---|---|---|
| Frontend | **Next.js 15 (React 19) + Tailwind** | Responsif; teknisi memakai HP di lapangan (kamera untuk scan SN & foto). Form dirender dinamis dari metadata workflow. |
| Backend | **Node.js 22 + Express 5 + TypeScript** | Satu bahasa dengan frontend. Alur WO ditulis sebagai *state machine* berbasis data (`workflows.ts`). |
| ORM | **Prisma 6** | Skema bertipe, migrasi, transaksi interaktif (stok & status WO harus atomik). |
| Database | **PostgreSQL 16** | Transaksi ACID untuk stok, JSONB untuk laporan lapangan. |
| Redis | **Redis 7 + BullMQ** | Antrian notifikasi & event billing (retry/backoff), job terjadwal, kode tautan Telegram. |
| Alternatif backend | Laravel / NestJS | Bisa; yang dipindahkan hanya lapisan API. Aturan bisnis ada di `workflows.ts` + `inventory.ts`. |

**Mengapa bukan Python/Laravel?** Tidak ada yang salah dengan keduanya. Node dipilih karena tim hanya perlu satu bahasa (TS) untuk web + API + worker, dan BullMQ matang untuk pola *outbox → queue*.

## 2. Arsitektur & infrastruktur

```
Browser/HP ──HTTPS──► Reverse proxy (Nginx/Caddy/Traefik, TLS)
                        ├─► web  (Next.js :3000)
                        └─► api  (Express :4000) ──► PostgreSQL
                                   │                    ▲
                                   ├──► Redis ◄── worker (BullMQ)
                                   │                │
   Billing eksisting ──x-api-key──►│                ├─► SMTP (email)
   Billing eksisting ◄─HMAC webhook────────────────├─► Telegram Bot API
                                                    └─► Billing webhook
```

Rekomendasi minimum produksi (≈ 200–500 pelanggan aktif/bulan baru, puluhan user):
- 1 VM 2 vCPU / 4 GB RAM (Docker Compose) — web, api, worker, postgres, redis.
- Disk terpisah / object storage (S3-compatible, mis. MinIO) untuk foto lapangan; saat ini disimpan di volume `uploads`.
- Reverse proxy dengan TLS (Let's Encrypt), firewall hanya 80/443.
- Backup `pg_dump` harian + retensi 14 hari ke storage lain; Redis memakai AOF.
- Monitoring: UptimeKuma/Prometheus pada `GET /health`; log Docker ke Loki/ELK bila perlu.
- Tumbuh lebih besar: pisahkan Postgres managed, jalankan >1 replika `api`/`worker` (state ada di DB & Redis, jadi stateless).

## 3. Library dan fungsinya

**API** — `express` (HTTP) · `zod` (validasi input) · `@prisma/client`/`prisma` (ORM & migrasi) · `bullmq` + `ioredis` (antrian & cron) · `nodemailer` (email SMTP) · `jsonwebtoken` + `bcryptjs` (login & hash password) · `helmet` + `cors` + `express-rate-limit` (hardening) · `multer` (upload foto) · `dotenv` (env) · `tsx`/`typescript` (dev/build). Telegram memakai `fetch` bawaan Node ke Bot API.

**Web** — `next`/`react` (UI) · `tailwindcss` (styling) · `html5-qrcode` (scan QR/barcode lewat kamera) · `qrcode.react` (membuat label QR aset).

## 4. Instalasi & menjalankan

Repo ini **private**. Untuk clone di server/komputer lain gunakan salah satu: GitHub Desktop / Git Credential Manager (login akun), **Personal Access Token** (`https://<TOKEN>@github.com/thuekx/Maung-Wo-Inv.git`, scope `repo` read-only), atau **Deploy Key** SSH (Settings → Deploy keys, read-only).

### A. Server produksi / staging (Ubuntu 22.04+ atau Debian 12+) — direkomendasikan

```bash
git clone https://github.com/thuekx/Maung-Wo-Inv.git && cd Maung-Wo-Inv

# 1) Pasang Docker Engine + Compose plugin + Portainer (butuh sudo)
sudo bash scripts/install-server.sh
#   opsi: SETUP_FIREWALL=1 (aktifkan UFW)  |  SKIP_PORTAINER=1
#   logout/login ulang agar user masuk grup docker

# 2) Buat .env (secret acak otomatis), build, jalankan, seed data awal
bash scripts/deploy.sh                        # akses http://IP-SERVER:3000
bash scripts/deploy.sh --host wo.contoh.co.id # pakai nama domain (tetap HTTP)
bash scripts/deploy.sh --caddy wo.contoh.co.id api-wo.contoh.co.id   # HTTPS otomatis (Let's Encrypt)
```
Skrip mencetak URL, URL Portainer, dan password akun demo di akhir. Untuk `--caddy`, arahkan DNS kedua domain ke server dan buka port 80/443 lebih dulu. Ganti password semua akun demo setelah login pertama.

Pembaruan berikutnya: `git pull && bash scripts/deploy.sh` (data Postgres/Redis/foto ada di volume Docker dan tidak hilang).

### B. Windows 10/11 (uji lokal / pengembangan)
PowerShell **Administrator** di folder repo:
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1 -Portainer -Up
```
Memasang Git, Node.js LTS, Docker Desktop (via winget; mungkin perlu restart lalu jalankan ulang), menjalankan `npm install` di `apps/api` & `apps/web`, membuat `.env`, memasang Portainer, dan menyalakan seluruh stack. Web: http://localhost:3000 · API: http://localhost:4000 · Portainer: https://localhost:9443.

### C. Deploy lewat Portainer (GUI)
1. Buka `https://IP-SERVER:9443`, buat akun admin (dalam 5 menit pertama setelah container start, atau Portainer terkunci — restart container `portainer` bila terlewat).
2. **Stacks → Add stack → Repository**: URL `https://github.com/thuekx/Maung-Wo-Inv`, branch `main`, Compose path `docker-compose.yml`. Karena repo private, aktifkan **Authentication** dan isi username GitHub + Personal Access Token.
3. Isi **Environment variables** (minimal): `POSTGRES_PASSWORD`, `JWT_SECRET`, `WEB_URL`, `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`; opsional `SMTP_*`, `TELEGRAM_BOT_TOKEN`, `BILLING_WEBHOOK_URL`. Daftar lengkap ada di `.env.example`. Buat secret dengan `openssl rand -hex 32`.
4. **Deploy the stack**. Lalu seed sekali: Containers → `maung-wo-inv-api-1` → Console → `node dist/prisma/seed.js`.
5. Pembaruan: Stack → *Pull and redeploy*. (Opsional: GitOps updates / webhook agar otomatis saat `git push`.)

> `NEXT_PUBLIC_API_URL` ikut dibake saat build web — ubah nilainya berarti harus rebuild (*Pull and redeploy* dengan *Re-pull image*/rebuild).

### D. Pengembangan lokal tanpa Docker untuk app (hanya DB & Redis di Docker)
```bash
npm run install:all                                   # npm install api+web, prisma generate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis   # butuh POSTGRES_PASSWORD di .env (default dev: l1v_dev_pw)
cp .env.example .env && cp .env.example apps/api/.env   # ubah POSTGRES_PASSWORD=l1v_dev_pw di keduanya agar cocok dengan DATABASE_URL
cd apps/api && npx prisma migrate dev && npm run db:seed
npm run dev            # terminal 1 (API :4000)
npm run dev:worker     # terminal 2 (worker notifikasi)
cd ../web && npm run dev   # terminal 3 (web :3000)
```
Cek mutu: `npm run typecheck` (di root).

### Ringkasan skrip

| Skrip | Fungsi |
|---|---|
| `scripts/install-server.sh` | Docker Engine, Compose plugin, Portainer CE, (opsional) UFW — Ubuntu/Debian |
| `scripts/deploy.sh` | `.env` + secret acak, build, up, seed; mode `--host` / `--caddy` |
| `scripts/setup-windows.ps1` | Git, Node LTS, Docker Desktop, npm install, `.env`, (opsi) Portainer & up |
| `docker-compose.yml` | postgres, redis, api, worker, web (semua config via variabel) |
| `docker-compose.caddy.yml` + `proxy/Caddyfile` | HTTPS otomatis (overlay) |
| `docker-compose.dev.yml` | membuka port Postgres/Redis untuk dev lokal |
| `package.json` (root) | `install:all`, `typecheck`, `up`, `down`, `logs`, `seed` |

### Keamanan operasional
- Jangan commit `.env` (sudah di `.gitignore`). Simpan salinannya di password manager.
- Portainer memegang akses penuh ke Docker host: aktifkan 2FA/SSO bila ada, batasi port 9443 (firewall VPS / VPN), jangan diekspos publik tanpa pembatasan IP.
- Docker mem-bypass UFW untuk port yang dipublikasikan; gunakan `--caddy` (hanya 80/443 terbuka) atau firewall dari penyedia VPS.
- Backup: `docker compose exec -T postgres pg_dump -U l1v l1v_wo | gzip > backup_$(date +%F).sql.gz` (jadwalkan via cron) + simpan volume `uploads`.

> Container `api` memakai `prisma db push` agar langsung jalan. Sebelum produksi sungguhan, buat migrasi (`npm run db:migrate`), commit `prisma/migrations`, dan ganti perintah start ke `prisma migrate deploy`.

## 5. Pemetaan alur ke aplikasi

Semua alur memakai engine yang sama (`apps/api/src/engine.ts`); setiap status punya **divisi pemilik** dan **aksi yang boleh dilakukan per peran**. Transisi + perubahan stok + notifikasi terjadi dalam **satu transaksi** (outbox pattern), lalu dikirim oleh worker.

| # | Alur | Status utama |
|---|---|---|
| 1–3 | **Pasang Baru** | `NOC_VALIDATION` → `STOCK_CHECK` (otomatis) → `READY_TO_SCHEDULE` → `SCHEDULED` (ambil material → Mobile Stock) → `IN_PROGRESS` (laporan: scan SN, meter kabel, material, OPM, foto) → `PHYSICAL_DONE` → `AWAITING_BA` → `CLOSED` |
| 4 | **Trouble Ticket** | `NOC_DIAGNOSE` → (selesai remote → `CLOSED`) atau `FIELD_DISPATCH` → `FIELD_IN_PROGRESS` (SN baru/lama) → `NOC_VERIFY` → `MKT_CONFIRM` → `CLOSED` |
| 5 | **Permintaan Barang / PO** | `PROC_REVIEW` → mutasi antar-gudang (`AWAITING_RECEIPT`) atau PO (`PO_ISSUED`) → penerimaan + QC + label QR → `CLOSED` |
| 6 | **Suspend / Unsuspend** | `NOC_ISOLATE` / `NOC_RESTORE` |
| 7 | **Terminate** | `NOC_DEACTIVATE` → `DISMANTLE_*` (scan SN) → `QC_PENDING` (GA: Refurbished / Damaged / Scrap) → `FIN_CLOSE` → `CLOSED` |

Aturan yang sudah ditegakkan sistem:
- **Cek stok otomatis** saat NOC selesai validasi: kebutuhan standar = item dengan `installDefaultQty` (ONT 1, Dropcore 100 m, dst.) di gudang pelanggan. Aman → langsung ke penjadwalan. Kurang → otomatis membuat WO *Permintaan Barang* anak (modul 5); begitu anak selesai, WO induk mengecek ulang sendiri.
- **Mobile Stock teknisi**: setiap teknisi punya gudang `MOBILE`. Saat laporan dikirim, SN harus ada di Mobile Stock teknisi itu; kabel/material berkurang dari sana; SN berpindah ke pelanggan (`INSTALLED`). Stok tidak bisa negatif.
- **Validasi NOC**: IP dan port ODP tidak boleh dobel antar pelanggan.
- **Teknisi** hanya bisa mengerjakan WO yang ditugaskan padanya; setiap aksi dicek per peran di server.
- **Penarikan aset**: perangkat yang tidak di-scan wajib diberi alasan (ditandai `SCRAP`); QC harus lengkap sebelum lanjut ke Finance.
- **3 kategori barang**: `CONSUMABLE` (qty/meter), `NETWORK` (wajib SN + QR), `GA` (kode aset otomatis `GA-0001`, jadwal maintenance, pengingat harian 08:00 WIB ke GA).
- **Stock opname** untuk material, dengan selisih tercatat sebagai mutasi.

### Trigger Finance (sesuai catatan tambahan)
1. NOC menekan *Service Active* → event `service.activated` ke billing **+** notifikasi ke Finance: "siapkan invoice".
2. Marketing mengirim BA Digital (email ke pelanggan) → event `invoice.prepare` ke billing **+** notifikasi Finance.
3. Terminate selesai → `account.closed`; suspend/unsuspend → `service.suspended` / `service.restored`.

## 6. Integrasi Billing eksisting

**Billing → WO App** (`x-api-key: $BILLING_API_KEY`), idempoten (WO terbuka yang sama dijawab `duplicate:true`):
```http
POST /api/integrations/billing/events
{ "event": "suspend" | "unsuspend" | "terminate", "customerCode": "CUST-20261007-0001", "reason": "...", "invoiceRef": "INV-123" }
GET  /api/integrations/billing/customers/:code     # status layanan
```
**WO App → Billing**: `POST $BILLING_WEBHOOK_URL` dengan header `x-signature` (HMAC-SHA256 dari body memakai `BILLING_WEBHOOK_SECRET`), `x-event`, `idempotency-key`. Body: `{ id, event, occurredAt, data }`. Retry eksponensial 6x; riwayat terlihat di Admin → *Event ke Billing*.

`customerCode` WO App (`CUST-…`) perlu dipetakan ke ID pelanggan di billing — saat ini disimpan di sisi WO App; sesuaikan bila billing punya ID sendiri (tambahkan kolom `externalId` di `Customer`).

## 7. Notifikasi

- **Email**: ke semua user aktif pada divisi pemilik status berikutnya (+ teknisi yang ditugaskan, + pembuat WO saat selesai, + email pelanggan untuk BA).
- **Telegram**: ke chat pribadi user (tautkan di *Profil* → kirim `/link KODE` ke bot) dan/atau grup per divisi (`TELEGRAM_ROLE_CHATS`). Set webhook bot sekali: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://API_DOMAIN/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`.
- Tanpa kredensial SMTP/Telegram aplikasi tetap jalan (dry-run, tercatat di log Admin).

## 8. Struktur

```
apps/api/prisma/schema.prisma   model data (WO, event, gudang, item, aset, stok, PO, notifikasi, outbox)
apps/api/src/workflows.ts       definisi 6 workflow (status, peran, form, aturan bisnis)
apps/api/src/engine.ts          mesin transisi + hak akses + notifikasi otomatis
apps/api/src/inventory.ts       mutasi stok/aset, mobile stock, QC
apps/api/src/worker.ts          pengirim email/Telegram/billing, cron
apps/api/src/routes/*           REST API
apps/web/src/components/DynamicForm.tsx   form dinamis (scan SN, foto, material, QC)
apps/web/src/app/(app)/*        dashboard, WO, pelanggan, inventori, PO, admin
```

## 9. Batasan saat ini / langkah berikutnya

- Belum ada test otomatis; kode ditulis tanpa dijalankan di lingkungan pembuatnya — jalankan `npm run typecheck` di `apps/api` dan `apps/web` serta uji satu alur penuh (Pasang Baru) sebelum dipakai.
- Foto disimpan lokal dan URL-nya tidak bertanda (acak, sulit ditebak) — pindahkan ke S3 dengan signed URL untuk produksi.
- Token login disimpan di `localStorage` (12 jam); untuk kebutuhan lebih ketat pindah ke cookie `httpOnly` + CSRF.
- Reservasi stok belum ada: dua pasang baru bersamaan bisa sama-sama melihat stok "aman" yang sama.
- Laporan/ekspor (SLA, MTTR, stok), integrasi OLT/Mikrotik otomatis, dan peta teknisi dapat ditambahkan di atas model yang ada.
