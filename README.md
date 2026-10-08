# Maung-Wo-Inv — L1V WO & Inventory

Aplikasi Work Order + Inventori multi-gudang untuk ISP (MKT · NOC · FOC · PROC/GA · FIN), terintegrasi dua arah dengan aplikasi Billing/Finance eksisting. Semua perpindahan tahap dikirim ke **email dan Telegram**.

## 1. Stack yang dipilih (dan alasannya)

| Lapisan | Pilihan | Alasan singkat |
|---|---|---|
| Frontend | **Next.js 16 (React 19.2) + Tailwind 3** | Responsif; teknisi memakai HP di lapangan (kamera untuk scan SN & foto). Form dirender dinamis dari metadata workflow. |
| Backend | **Node.js 24 LTS + Express 5 + TypeScript 5.9** | Satu bahasa dengan frontend. Alur WO ditulis sebagai *state machine* berbasis data (`workflows.ts`). |
| ORM | **Prisma 7** (driver adapter `pg`) | Skema bertipe, migrasi, transaksi interaktif (stok & status WO harus atomik). Klien di-generate ke `apps/api/src/generated` (tidak di-commit). |
| Database | **PostgreSQL 16** | Transaksi ACID untuk stok, JSONB untuk laporan lapangan. |
| Redis | **Redis 7 + BullMQ** | Antrian notifikasi (retry/backoff), job terjadwal, kode tautan Telegram. |
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

**API** — `express` (HTTP) · `zod` (validasi input) · `prisma` + `@prisma/client` + `@prisma/adapter-pg` (ORM, migrasi, driver PostgreSQL) · `bullmq` + `ioredis` (antrian & cron) · `nodemailer` (email SMTP) · `jsonwebtoken` + `bcryptjs` (login & hash password) · `helmet` + `cors` + `express-rate-limit` (hardening) · `multer` (upload foto) · `dotenv` (env) · `tsx`/`typescript` (dev/build). Telegram memakai `fetch` bawaan Node ke Bot API.

**Web** — `next`/`react` (UI) · `tailwindcss` (styling) · `html5-qrcode` (scan QR/barcode lewat kamera) · `qrcode.react` (membuat label QR aset).

## 4. Instalasi & menjalankan (Ubuntu 24.04 LTS)

Target tunggal: **Ubuntu Server 24.04 LTS (noble), x86_64/arm64**. Spesifikasi minimum 2 vCPU / **4 GB RAM** (build Next.js butuh memori; di 2 GB tambahkan swap) / 20 GB disk. Seluruh aplikasi berjalan di container Docker, jadi **Node.js tidak perlu dipasang di server** (Node 24 hanya untuk pengembangan, lihat bagian D).

Repo ini **private**. Cara clone di server: **Personal Access Token** (GitHub → Settings → Developer settings → fine-grained token, akses *Contents: read-only* ke repo ini) atau **Deploy Key** SSH (repo → Settings → Deploy keys, read-only).

```bash
# opsi token
git clone https://<USERNAME>:<TOKEN>@github.com/thuekx/Maung-Wo-Inv.git
# opsi deploy key:
#   ssh-keygen -t ed25519 -f ~/.ssh/maung_deploy -N ""   (tambahkan file .pub ke Deploy keys)
#   GIT_SSH_COMMAND="ssh -i ~/.ssh/maung_deploy" git clone git@github.com:thuekx/Maung-Wo-Inv.git
```

### A. Instalasi cepat (skrip)

```bash
cd Maung-Wo-Inv
sudo timedatectl set-timezone Asia/Jakarta          # waktu jadwal & cron

# 1) Docker Engine + Compose plugin + Portainer
sudo bash scripts/install-server.sh
#    opsi: SETUP_FIREWALL=1 (aktifkan UFW) | SKIP_PORTAINER=1 | INSTALL_NODE=1 (Node 24 untuk dev)
newgrp docker                                        # atau logout/login agar grup docker aktif

# 2) Buat .env (secret acak), build, jalankan, seed data awal
bash scripts/deploy.sh                               # tanpa domain  -> http://IP-SERVER:3000
bash scripts/deploy.sh --host wo.contoh.co.id        # dengan domain -> tetap HTTP
bash scripts/deploy.sh --caddy wo.contoh.co.id api-wo.contoh.co.id   # HTTPS otomatis (Let's Encrypt)
```
Di akhir, skrip mencetak URL web, URL Portainer, dan password akun demo. Untuk `--caddy`: arahkan DNS **kedua** domain (A record) ke IP server dan pastikan port 80/443 terbuka sebelum menjalankan. **Ganti password semua akun demo** setelah login pertama (menu Profil / Admin).

Verifikasi:
```bash
docker compose ps                                    # semua "running/healthy"
curl -s http://localhost:4000/health                 # {"ok":true}
docker compose logs -f --tail=100 api worker         # log
```
Build pertama memakan beberapa menit (unduh image + `npm install` + `next build`).

**Pembaruan:** `git pull && bash scripts/deploy.sh` — data Postgres, Redis, dan foto ada di volume Docker dan tidak hilang. `.env` tidak ditimpa.

### B. Deploy lewat Portainer (GUI)
1. Buka `https://IP-SERVER:9443`, buat akun admin **segera** (Portainer terkunci jika dibiarkan >5 menit; bila terlewat: `docker restart portainer`). Sertifikat awal self-signed, abaikan peringatan browser.
2. **Stacks → Add stack → Repository**: URL `https://github.com/thuekx/Maung-Wo-Inv`, branch `main`, Compose path `docker-compose.yml`. Repo private → aktifkan **Authentication**, isi username GitHub + token.
3. Isi **Environment variables** (minimal): `POSTGRES_PASSWORD`, `JWT_SECRET`, `WEB_URL`, `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`; opsional `SMTP_*`, `TELEGRAM_BOT_TOKEN`, `BILLING_WEBHOOK_URL`. Daftar lengkap di `.env.example`; buat secret dengan `openssl rand -hex 32`.
4. **Deploy the stack**, lalu seed sekali: Containers → `maung-wo-inv-api-1` → Console → `node dist/prisma/seed.js`.
5. Pembaruan: Stack → *Pull and redeploy*.

> `NEXT_PUBLIC_API_URL` ikut dibake saat build web — jika diubah, web harus di-build ulang (*Pull and redeploy* dengan opsi rebuild).

### C. Mode HTTPS (Caddy) — direkomendasikan untuk produksi
`bash scripts/deploy.sh --caddy <domain-web> <domain-api>` memakai `docker-compose.caddy.yml`: hanya port 80/443 yang terbuka ke luar, port 3000/4000 tidak dipublikasikan, sertifikat diurus otomatis. Perintah manual setara:
```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```
(butuh Docker Compose ≥ 2.24 — sudah terpenuhi oleh `install-server.sh`).

### D. Pengembangan di Ubuntu (opsional; Node 24 + DB/Redis di Docker)
```bash
sudo INSTALL_NODE=1 bash scripts/install-server.sh   # atau pasang Node 24 via nvm: nvm install 24 (ada .nvmrc)
npm run install:all                                  # npm install api+web + prisma generate
cp .env.example .env && cp .env.example apps/api/.env
sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=l1v_dev_pw/' .env apps/api/.env   # cocokkan dgn DATABASE_URL contoh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
cd apps/api && npx prisma migrate dev && npm run db:seed
npm run dev            # terminal 1: API :4000
npm run dev:worker     # terminal 2: worker notifikasi
cd ../web && npm run dev   # terminal 3: web :3000
```
Cek mutu dari root repo: `npm run typecheck`.

### Ringkasan berkas

| Berkas | Fungsi |
|---|---|
| `scripts/install-server.sh` | Docker Engine, Compose plugin, Portainer CE, opsional UFW & Node 24 (Ubuntu 24.04) |
| `scripts/deploy.sh` | `.env` + secret acak, build, up, seed; mode `--host` / `--caddy` |
| `docker-compose.yml` | postgres, redis, api, worker, web (semua config via variabel) |
| `docker-compose.caddy.yml` + `proxy/Caddyfile` | HTTPS otomatis (overlay) |
| `docker-compose.dev.yml` | membuka port Postgres/Redis untuk dev lokal |
| `package.json` (root) | `install:all`, `typecheck`, `up`, `down`, `logs`, `seed` |

### Catatan operasional (Ubuntu 24.04)
- **Jangan commit `.env`** (sudah di `.gitignore`); simpan salinannya di password manager. Hak akses: `chmod 600 .env`.
- **Portainer = akses penuh ke Docker host.** Batasi port 9443 (firewall penyedia VPS / VPN / `ufw allow from <IP-kantor> to any port 9443`), aktifkan 2FA bila tersedia.
- **Docker mem-bypass UFW** untuk port yang dipublikasikan (`3000`, `4000`, `9443`). Gunakan mode `--caddy` + firewall penyedia VPS sebagai lapisan utama; `SETUP_FIREWALL=1` saja tidak cukup menutup port container.
- **Backup harian** (cron user yang masuk grup docker):
  ```bash
  mkdir -p ~/backups
  crontab -e   # tambahkan baris berikut (tanda % wajib di-escape di crontab):
  15 2 * * * cd ~/Maung-Wo-Inv && docker compose exec -T postgres pg_dump -U l1v l1v_wo | gzip > ~/backups/wo_$(date +\%F).sql.gz && find ~/backups -mtime +14 -delete
  ```
  Backup volume foto: `docker run --rm -v maung-wo-inv_uploads:/d -v ~/backups:/b alpine tar czf /b/uploads_$(date +%F).tgz -C /d .`
  Pulihkan DB: `gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U l1v l1v_wo`.
- **Restart otomatis:** semua container `restart: unless-stopped`, dan service `docker` aktif saat boot, sehingga stack hidup kembali setelah reboot.
- **Pembaruan keamanan OS:** `sudo apt install unattended-upgrades` lalu `sudo dpkg-reconfigure -plow unattended-upgrades`.

### Troubleshooting
| Gejala | Penyebab / solusi |
|---|---|
| `permission denied ... docker.sock` | User belum di grup docker → `newgrp docker` atau login ulang. |
| `docker compose` tidak dikenal | Compose plugin belum terpasang → jalankan ulang `install-server.sh`. |
| Build web berhenti "Killed" | RAM kurang → tambah swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`. |
| Web tidak bisa login / CORS error | `NEXT_PUBLIC_API_URL`, `WEB_URL`, `CORS_ORIGIN` di `.env` tidak sama dengan URL yang dibuka di browser → perbaiki lalu `bash scripts/deploy.sh` (web di-build ulang). |
| Caddy gagal mendapat sertifikat | DNS belum mengarah ke server / port 80 tertutup → cek `docker compose logs caddy`. |
| `api` restart terus | `docker compose logs api` — biasanya `JWT_SECRET`/`POSTGRES_PASSWORD` kosong atau Postgres belum sehat. |
| Notifikasi tidak terkirim | Lihat Admin → Log notifikasi; tanpa `SMTP_HOST`/`TELEGRAM_BOT_TOKEN` sistem hanya mencatat (dry-run). |

> Skema database dikelola lewat migrasi (`apps/api/prisma/migrations`). Service `migrate` menjalankan `prisma migrate deploy` sekali sebelum `api` dan `worker` start. Setelah mengubah `schema.prisma`, buat migrasi baru di dev (`cd apps/api && npx prisma migrate dev --name <nama>`) dan commit foldernya; **jangan** memakai `db push` di staging/produksi. Build image memakai `npm ci` dari `package-lock.json` (commit lockfile bila dependency berubah).

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

### Finance: hanya pengingat (tidak terhubung ke aplikasi billing)
Finance **tidak** dihubungkan langsung ke aplikasi billing; sistem hanya mengingatkan lewat **Telegram dan email** (ke user divisi FIN dan grup `TELEGRAM_ROLE_CHATS.FIN`):
1. NOC menekan *Service Active* → pengingat `🔔 Pelanggan sudah AKTIF – segera siapkan invoice` (nama, kode, paket, tanggal aktif, tautan WO).
2. Marketing mengirim BA Digital → pengingat kedua: BA terkirim, pastikan invoice pertama sudah disiapkan.
3. Penyiapan invoice dilakukan manual Finance di sistem billing. Tidak ada event keluar ke billing yang dikirim.

## 6. Integrasi data

- **Menarik data keluar:** Export API baca-saja (`/api/export/*`, JSON/CSV, paginasi, filter `since`) — lihat **[docs/API.md](docs/API.md)**. Aktif bila `EXPORT_API_KEY` diisi.
- **Billing → WO App (opsional, tidak wajib):** endpoint masuk tetap tersedia bila suatu saat billing ingin membuat WO suspend/unsuspend/terminate otomatis. Header `x-api-key: $BILLING_API_KEY`, idempoten (`duplicate:true` bila WO terbuka sudah ada):
```http
POST /api/integrations/billing/events
{ "event": "suspend" | "unsuspend" | "terminate", "customerCode": "CUST-20261007-0001", "reason": "...", "invoiceRef": "INV-123" }
GET  /api/integrations/billing/customers/:code     # status layanan
```
- **WO App → Billing:** dinonaktifkan (tidak ada `emit` di alur). Mesin outbox (`OutboundEvent`, `BILLING_WEBHOOK_URL`) tetap ada di kode untuk integrasi mendatang.
- **MSRadius:** rencana ke depan; Export API di atas dapat dipakai sebagai jembatan awal.

## 7. Notifikasi

- **Email**: ke semua user aktif pada divisi pemilik status berikutnya (+ teknisi yang ditugaskan, + pembuat WO saat selesai, + email pelanggan untuk BA).
- **Telegram**: ke chat pribadi user (tautkan di *Profil* → kirim `/link KODE` ke bot) dan/atau grup per divisi.
- **Dikelola Admin dari aplikasi** (*Admin → Pengaturan*): SMTP (dengan tombol tes email), token bot Telegram (cek bot, pasang webhook, tes kirim), chat ID grup per divisi, logo/nama PT, dan kewajiban GPS foto. Rahasia disimpan terenkripsi. **Panduan langkah demi langkah: [docs/NOTIFIKASI.md](docs/NOTIFIKASI.md).**
- Tanpa kredensial SMTP/Telegram aplikasi tetap jalan (dry-run, tercatat di log Admin).

### Foto lapangan (GPS + logo PT)
Foto teknisi (FOC) diambil lewat kamera, lalu browser mengambil lokasi GPS dan menempelkan **banner logo PT, nama PT, nomor WO, koordinat (±akurasi), dan waktu** langsung pada piksel foto. Server menolak foto teknisi tanpa GPS (kebijakan dapat dimatikan Admin untuk uji tanpa HTTPS) dan menyimpan koordinat per foto; galeri **Foto lapangan** di WO menampilkan tautan peta. Teknisi juga dapat mengirim **Update progres lapangan** (foto bertanda GPS + catatan) tanpa mengubah tahap, dan NOC/pembuat WO diberi tahu. Logo PT diunggah sebagai master di *Admin → Pengaturan*. GPS browser hanya bekerja di **HTTPS** (atau localhost) — gunakan mode Caddy.

### Data demo
`docker compose exec api node dist/prisma/seed-demo.js` (atau `DEMO=1 bash scripts/deploy.sh`) membuat data contoh untuk semua alur di setiap tahap beserta skenario uji per akun: **[docs/DEMO.md](docs/DEMO.md)**.

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
- Watermark/GPS foto dibuat di browser dan koordinat divalidasi hanya keberadaannya di server (bukan keasliannya); untuk audit lebih ketat tambahkan penandaan sisi server. Foto disimpan lokal dan URL-nya tidak bertanda (acak, sulit ditebak) — pindahkan ke S3 dengan signed URL untuk produksi.
- Token login disimpan di `localStorage` (12 jam); untuk kebutuhan lebih ketat pindah ke cookie `httpOnly` + CSRF.
- Reservasi stok belum ada: dua pasang baru bersamaan bisa sama-sama melihat stok "aman" yang sama.
- Laporan SLA/MTTR, integrasi OLT/Mikrotik/MSRadius otomatis, dan peta teknisi dapat ditambahkan di atas model yang ada.
- Fitur yang direncanakan (belum dikerjakan) tercantum di `HANDOFF.md` bagian *Roadmap fitur*.
