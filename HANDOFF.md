# HANDOFF — Maung-Wo-Inv (MAUNG by LIV · WO & Inventory ISP)

> Diperbarui di akhir sesi. **Satu-satunya sumber serah-terima**; dokumen rinci ada di `docs/`.

## Kalimat pembuka untuk sesi baru (salin-tempel)
```
Lanjutkan proyek Maung-Wo-Inv (repo thuekx/Maung-Wo-Inv, branch main, sudah ter-clone di sesi ini).
Baca dulu HANDOFF.md (bagian "STATUS TERKINI" dan "Panduan sesi berikutnya"), lalu docs/DEMO.md dan docs/RADIUS-API.md.
Seluruh backlog 36 butir + batch F sudah selesai dan ter-deploy ke staging (commit 823190c, database demo baru).
Tugas sekarang: bantu saya UAT/validasi di staging (per peran), perbaiki temuan saya ("catatan minor"), dan uji
integrasi MSRadius dengan token asli. Jangan menambah fitur di luar yang saya minta; Bahasa Indonesia; identitas git
thuekx <thuekx@kolu.web.id> tanpa trailer/atribusi Claude; uji sungguhan (API + browser) sebelum push;
beri perintah update satu baris; perbarui HANDOFF.md di akhir.
```

## STATUS TERKINI (2026-10-09)
- **Kode**: `origin/main` = `823190c` (Batch A–F selesai). Staging **sudah di-deploy fresh** dengan data demo terbaru (semua secret `.env` dirotasi). Repo di staging: `/opt/staging/projects/Maung-Wo-Inv`; backup pra-reset (`.env` lama, dump DB, uploads) di `~/backups/maung-pre-clean-<stempel>/` pada VM.
- **Password**: semua akun demo memakai satu `SEED_PASSWORD` di `.env` VM (`grep ^SEED_PASSWORD .env`; jangan ditempel ke chat). Akun: `admin` (Admin), `mkt` (Marketing·Supervisor), `noc` (NOC·Supervisor), `citra` (FOC·Manager), `budi` (FOC·Supervisor), `andi` (FOC·Staff), `ga` (GA·Manager), `fin` (Finance·Manager) — semua `@l1v.local`.
- **Belum teruji (hanya bisa di staging)**: Docker penuh di sandbox, token MSRadius asli (hanya server tiruan 2.320 pelanggan), hasil cetak PDF nyata (PR, BA, Formulir Berlangganan; aktifkan "Grafik latar belakang"), GPS foto (butuh HTTPS), Telegram/SMTP (belum diisi → status NOT_SENT).
- **Langkah pertama pemilik di staging**: ganti password admin → Admin → Pengaturan: isi MSRadius (token, Uji koneksi, Tarik data), hubungkan tiap Area ke gudang (Master Data → Area), isi SMTP/Telegram, cek logo/kop/formulir (Branding) → uji per peran sesuai `docs/DEMO.md`.

- **UAT 2026-10-09 (sesi lanjutan)**: (1) `docs/Authentication API.pdf` sudah di repo — dicek: **tidak ada** field/endpoint `status` online/offline/waiting (hanya `last_login/last_logout/first_login`, `disabled_username`, `expired_at`); jangan memetakan status dari dugaan. (2) Server MSRadius membalas **301** pada `curl` tanpa `-L` (aplikasi memakai `fetch` yang mengikuti pengalihan, uji koneksi OK); minta pemilik menempel `URL akhir` hasil `curl -L` bila perlu. (3) Admin → Pengaturan → logo: pratinjau kini punya sakelar latar Terang/Gelap (logo gelap tak terlihat di kotak navy), keterangan "Baru diunggah <jam>: <berkas>", tautan "buka", cache-buster, verifikasi file bisa dimuat setelah unggah (galat bila tidak), pesan jika gambar gagal dimuat. **Belum terjawab**: penyebab semua logo berubah ke "logo tak dikenal" — tidak bisa direproduksi di sandbox (unggah 3 varian berurutan lewat API + browser: file & Setting benar); menunggu hasil diagnosa DB/uploads dari VM.

## Panduan sesi berikutnya
- **Reset bersih staging** (menghapus semua data & rotasi secret; simpan ke file lalu jalankan dengan stdin kosong agar `docker compose exec` tidak memakan script): backup `.env`+`pg_dump -U l1v -d l1v_wo`+uploads → `git reset --hard origin/main` → `docker compose down -v --remove-orphans` → `rm -f .env` → `DEMO=1 bash scripts/deploy.sh` → `bash /tmp/script.sh </dev/null`. Tanpa hapus data: `git fetch origin && git reset --hard origin/main && bash scripts/deploy.sh` (migrasi otomatis; **tanpa** `DEMO=1` data demo tidak bertambah).
- **Sandbox**: Postgres/Redis lokal (`l1v:l1v@localhost:5432/l1v_wo`, DB bersih uji `l1v_fresh`) harus dinyalakan manual; API `npx tsx src/index.ts`, worker `npx tsx src/worker.ts`, web `npx next dev`; server MSRadius tiruan ada di scratchpad sesi lama (tidak persisten — tulis ulang bila perlu: `GET /api/radius/{masterdata/area/list,databilling/profile,databilling/data}` dengan header `X-TOKEN`).
- **Catatan desain penting**: sub-role hanya membedakan FOC (jadwal = supervisor/manager); Admin bisa "Bertindak sebagai" peran lain; pelanggan MSRadius hanya-baca untuk nama/telepon/alamat/paket; Area menggantikan gudang/cabang (`Customer.warehouseId` diturunkan dari `Area.warehouseId`); PR→PO Accurate dicatat ulang (nomor PO Accurate = nomor PO); Reg. No. formulir = awalan `SM` + 3 digit tahun + isian.
- **Kandidat tindak lanjut (bukan fitur baru, hanya bila pemilik meminta)**: tombol "serah-terima sisa" otomatis dari laporan instalasi; filter pelanggan per Area; ekspor Excel kolom IP Publik; pembatasan akses file `uploads` (tanda tangan manager saat ini publik via URL).

## 1. Ringkasan proyek
Aplikasi Work Order + Inventori multi-gudang untuk ISP. Brand **MAUNG by LIV** ("Gerak Cepat, Kerja Tepat."). Repo privat `github.com/thuekx/Maung-Wo-Inv`, branch `main`. Pengguna berbahasa Indonesia; UI dan dokumen berbahasa Indonesia.

| | |
|---|---|
| Stack | Next.js 16 + React 19 + Tailwind 3 (web) · Node 24 + Express 5 + TypeScript 5.9 (api) · Prisma 7 (adapter-pg) · PostgreSQL 16 · Redis 7 + BullMQ · Docker Compose |
| Staging pemilik | VirtualBox Ubuntu 24.04, 4 vCPU/6 GB, `http://172.24.12.23` (web :3000, api :4000), Docker sudah berjalan; **HTTP polos → GPS browser dan webhook Telegram belum bisa** (butuh HTTPS/Caddy) |
| Deploy | `git fetch origin && git reset --hard origin/main && bash scripts/deploy.sh` (**satu baris dengan `&&`**). `DEMO=1` menambah data demo. Service `migrate` menjalankan `reconcile-migrations` lalu `prisma migrate deploy` |
| Akun demo | `*@l1v.local` (admin, mkt, noc, citra, budi, andi, ga, fin), kata sandi = `SEED_PASSWORD` di `.env` (deploy.sh membuat acak) |
| Peran | `ADMIN, MKT, NOC, FOC, GA (GA+Procurement satu peran), FIN` (PROC sudah dihapus) |
| Peringatan tooling | jangan `pkill -f <pola>` (membunuh shell sendiri) → pakai `fuser -k 3000/tcp`; `redis-server` harus hidup untuk API; Postgres lokal sering mati (`service postgresql start`); Playwright ada di `/opt/node-tools/node_modules/playwright-core` dengan `executablePath: '/opt/pw-browsers/chromium'`; skrip uji di `/tmp` **tidak persisten** |

### Aturan kerja yang disepakati dengan pemilik
- Semua commit atas nama **thuekx <thuekx@kolu.web.id>**, **tanpa** trailer Co-Authored-By/Claude dan tanpa kata "claude" di repo.
- Uji sungguhan (typecheck API+web, API nyata, browser Playwright, data besar bila relevan) sebelum push; laporkan jujur apa yang belum teruji (Docker penuh tidak bisa dijalankan di sandbox).
- Pemilik mereview kode dan mengirim "catatan minor" — tanggapi, perbaiki, push. Beri perintah update satu baris.
- Keputusan desain besar/ambigu → tanyakan dulu (mis. butir 29). Migrasi: ikuti `docs/MIGRATIONS.md` (stempel UTC asli via `scripts/new-migration.sh`, migrasi yang sudah di-push tidak diubah).
- Tidak ada API billing untuk Finance: Finance hanya **pengingat** Telegram/email. Foto lapangan: GPS + banner logo di browser.

## 2. Apa yang sudah ada (jangan dibuat ulang)
Dokumen: `README.md`, `docs/{API,BRANDING,DEMO,FITUR,MIGRATIONS,NOTIFIKASI,RADIUS-API,SCALE,UI-DESIGN}.md`.
- **Alur WO** (satu mesin data-driven `apps/api/src/workflows.ts` + `engine.ts`): Pasang Baru, Trouble Ticket, Suspend, Unsuspend, Terminate (+penarikan aset/QC), Permintaan Barang/PO. Outbox notifikasi → BullMQ (`effects.ts`, `worker.ts`).
- **Inventori**: gudang (termasuk MOBILE per teknisi), item (CONSUMABLE/NETWORK/GA), aset ber-SN, merk/tipe, QC, opname, PO + penerimaan, QR massal A4 (`/qr-print`).
- **Admin**: user (edit, reset password satuan/massal, hapus), pengaturan SMTP/Telegram/branding (tabel `Setting`, rahasia terenkripsi), log notifikasi, log audit (edit/hapus tercatat; hapus oleh non-Admin memberi notif ke Admin).
- **Pelanggan**: input manual, impor/ekspor Excel, master paket, paginasi server.
- **Foto lapangan**: GPS + banner logo dibubuhkan di browser, galeri di WO, progres lapangan.
- **UI**: tema MAUNG (navy/emas, Playfair+Inter self-host), top bar + sidebar ciut, pencarian global, lonceng + kotak masuk (`Inbox`, FK cascade ke User), tema terang/gelap/sistem di kanan atas, `DataTable` server-side, `Toast` belum ada.
- **Skala**: paginasi/urut/cari di server, dashboard agregasi SQL (29 dtk → ±50 ms pada 100 rb pelanggan/300 rb WO), indeks trigram.
- **Export API** baca-saja `/api/export/*` (`EXPORT_API_KEY`), `docs/API.md`.
- Peta file penting: `apps/api/src/{workflows,engine,inventory,dashboard,paging,settings,audit,effects,worker}.ts`, `routes/{core,wo,inventory,masters,admin,export,integrations}.ts`, `prisma/{schema.prisma,seed.ts,seed-demo.ts,reconcile-migrations.ts}`; web: `apps/web/src/app/(app)/*`, `components/{DataTable,DynamicForm,ui,icons,SearchBox,NotificationBell,Tip}.tsx`, `lib/{api,auth,brand,theme,photo}.ts`.

### Tambahan sesi 2026-10-09 (batch B–E)
- **Peran**: sub-role MANAGER/SUPERVISOR/STAFF (`User.subRole`; hanya FOC yang dibedakan: jadwal = supervisor/manager). Admin bisa **bertindak sebagai** peran+sub-role lain (header `X-Act-As`/`X-Act-Sub`, banner kuning). Menu & API per peran (NOC tanpa inventori/master/tambah pelanggan; FOC hanya "Stok Saya"). Jejak WO menyimpan nama+peran+sub-role pelaku.
- **Serah-terima sisa material**: WO `STOCK_RETURN` (FOC mengajukan → GA terima semua/sebagian/tolak; yang belum diterima tetap di Stok Berjalan teknisi).
- **Pengadaan**: master Vendor; Purchase Request (≥2 vendor per baris, PPN, nomor surat `n/L1V/PNJ-BDG/ROMAWI/tahun`, status DRAFT→SUBMITTED→ISSUED→APPROVED→PO_ENTERED); PDF berkop (`/doc/pr/:id`, kop A4 bisa diganti di Admin → Branding); PO dari Accurate dicatat ulang (nomor PO Accurate = nomor PO) lalu penerimaan/QC; BA Digital pratinjau/cetak (`/doc/ba/:id`). Pembuat PR: GA atau supervisor/manager mana pun.
- **MSRadius** (baca-saja): `src/radius.ts`, `routes/radius.ts`, worker cron; lihat `docs/RADIUS-API.md`.
- **Demo baru**: akun `citra@` (FOC manager), `budi@` (supervisor), `andi@` (staff), NOC/MKT supervisor, GA/FIN manager; PR di tiap tahap, PO dari PR, serah-terima sisa, aset GA berflag perawatan + kendaraan berplat.
- Uji di sandbox: DB baru (migrate + seed + seed-demo) OK, `next build` OK, API/Playwright untuk alur utama; **belum** diuji dengan Docker penuh dan token MSRadius asli.

### Tambahan sesi 2026-10-09 (batch F)
- **Area** menggantikan "gudang/cabang" pada pelanggan (`Area` + `Customer.areaId`; `warehouseId` pelanggan diturunkan dari area). Disinkron dari MSRadius; tautan area→gudang diatur di Master Data → Area.
- **Nama pelanggan MSRadius**: `_` → spasi otomatis (opsi toggle dihapus). **Anti-ganda**: input manual dengan nama/telepon sama meminta konfirmasi. Pelanggan MSRadius: hanya nama/telepon/alamat/paket yang terkunci.
- **Formulir Berlangganan digital** (`Subscription`, menu *Form Berlangganan*, cetak `/doc/form/:id`; format dari "Draft FAB Sunmori"): Reg. No. `SM`+3 digit tahun+isian; semua isian opsional kecuali Reg. No.; paket & harga dari Master Paket (MSRadius); pembayaran bawaan Transfer; Manager Marketing bawaan M Gugi Granada (isian); logo formulir (bawaan Sunmori) & tanda tangan manager diunggah di Admin → Branding; dapat dijadikan WO Pasang Baru (prefill, tertaut). Syarat & ketentuan disalin dari dokumen (`apps/web/src/lib/terms.ts`).

## 3. BACKLOG — 36 butir dari pemilik (SEMUA sudah dikerjakan: batch A–E)
Status: ✅ selesai · ◑ sebagian · ☐ belum · ⛔ menunggu keputusan/berkas. Batch = urutan kerja yang disarankan (A→E).

| # | Butir | Status | Catatan analisis / rencana |
|---|---|---|---|
| 1 | Alert modal → flash/toast | ✅ A | Buat `Toast` (provider + `useToast`), ganti `window.alert/confirm` (mis. `doDelete`, prompt merk) dengan toast + dialog konfirmasi kustom |
| 2 | Error isian form inline di bawah field | ✅ A | Backend: ubah `ZodError` handler agar mengembalikan `{error, fields:{path:msg}}`; `DynamicForm` tampilkan per-field; `api()` lempar error ber-`fields` |
| 3 | Lat/lng pelanggan tidak wajib | ✅ A | `NEW_INSTALL.createFields` + zod `lat/lng` → opsional; form pelanggan sudah opsional |
| 4 | Customer ID dari API radius | ✅ | `Customer.code` = `kode` MSRadius; WO Pasang Baru: pilih dari hasil sinkron atau ketik manual (butir 28). Butuh butir 35 |
| 5 | PR (Purchase Request) → PO oleh sistem lain (Accurate) → PO diinput ulang dengan detail barang riil | ✅ | Ganti alur `create_po`: PR di Maung; PO dicatat Procurement (nomor Accurate, vendor, baris barang riil ≠ pengajuan); lalu QC + penerimaan. Lihat butir 23/27 |
| 6 | Superadmin bisa "act as" NOC/FOC/GA/MKT | ✅ | ADMIN sudah lolos semua cek peran; "act as" = pemilih peran efektif di top bar (klaim `actAs` di JWT/sesi), menu & aksi mengikuti peran itu, jejak "Admin (sebagai NOC)" |
| 7 | Sidebar: "Selamat datang, nama/role" | ✅ A | Profil kini di menu akun top bar; tambahkan sapaan di top bar/sidebar |
| 8 | Pilihan terang/gelap/sistem di kanan atas | ✅ | selesai (segmented control + tooltip) |
| 9 | Ikon notif kanan atas per peran + show all ke daftar tindakan | ✅ A | Lonceng + `Inbox` + `/notifications` ada; tambahkan bagian "Butuh tindakan (N)" per peran dan "Lihat semua" → daftar WO yang harus ditindak |
| 10 | itemId/warehouseId tampil kode, bukan nama | ✅ A | Sumber: `DataView` pada "Detail & laporan" menampilkan JSON mentah. Perbaiki: resolver referensi di backend (`itemId`, `warehouseId`, `technicianId`, `serials` → nama) atau simpan nama saat transisi |
| 11 | Sembunyikan menu & tab yang tak relevan per peran | ✅ | Matriks izin tunggal (server + web); contoh FOC tidak melihat Inventori & Aset |
| 12 | Teknisi punya riwayat permintaan barang | ✅ | Halaman "Permintaan saya" (WO STOCK_REQUEST/PR milik pembuat + status + penerimaan/pengembalian) |
| 13 | Galat XML `demo-photo-041.svg` (`&` tak di-escape) | ✅ A | Escape label di `seed-demo.ts` (`&amp;`); file di volume VM sudah rusak → skrip perbaikan sekali jalan (`&` → `&amp;` pada `uploads/demo-photo-*.svg`) |
| 14 | Pratinjau BA Digital pelanggan | ✅ | Halaman/preview BA (logo, data pelanggan, paket, tanggal, nomor BA) sebelum "Kirim BA"; cetak/PDF |
| 15 | NOC tidak boleh tambah pelanggan, lihat inventori, master data | ✅ | Bagian matriks izin (butir 11) |
| 16 | Sub-role (manager/supervisor/staff); penjadwalan FOC hanya supervisor/manager | ✅ | `User.subRole` (MANAGER/SUPERVISOR/STAFF); untuk sekarang hanya FOC yang dibedakan; peran lain tetap bisa diberi sub-role tapi fungsi sama |
| 17 | FOC staff: hanya minta material + laporan survei/instalasi/troubleshooting; manager/supervisor semua | ✅ | Hak aksi `schedule/start/…` per sub-role di definisi workflow (`ActionDef.subRoles`) |
| 18 | Laporan instalasi: material habis pakai hanya yang diajukan di awal; rekonsiliasi sisa; belum dikembalikan/diterima GA tetap atas nama teknisi | ✅ C | Perlu daftar "material dibawa" per WO (dari pickup/permintaan); laporan membatasi pilihan; langkah pengembalian sisa diterima GA; selisih tercatat |
| 19 | Celah pemakaian kabel tanpa catatan pengambilan | ✅ C | Hapus `cableMeters` hardcode DROPCORE; kabel = item master dengan atribut **jumlah core**; harus diminta di pengajuan/pickup; pemakaian hanya dari yang dibawa |
| 20 | Input SN di kantor: peringatan jika teks belum "Tambah" | ✅ C | `SerialInput`: deteksi teks tertunda + pesan inline; info jika nilai sudah ditambahkan |
| 21 | Hapus pelanggan: pesan muncul tapi data masih ada | ✅ A | Reproduksi dulu: kemungkinan daftar tidak segar, atau pelanggan berstatus TERMINATED/ber-WO (dihapus diblokir). Cek `DELETE /customers/:id`, cache `DataTable`, dan "penumpukan data" (arsip/sembunyikan TERMINATED?) |
| 22 | Cegah IP sama pada VLAN sama; batasi isian IP & VLAN | ✅ C | Kebijakan: format IPv4, rentang VLAN valid, subnet per VLAN (master), unik `(ip, vlan)` aktif, bukan network/broadcast; perlu rencana VLAN/subnet pemilik |
| 23 | Form Purchase Request sesuai PDF pengajuan + perbandingan harga vendor (master vendor) | ✅ | **Berkas PDF/gambar form PR tidak terlampir di sesi ini** → minta ulang. Perlu master Vendor, form PR, perbandingan ≥ 2–3 vendor, persetujuan |
| 24 | Registrasi aset: perlu maintenance atau tidak (juga dari penerimaan PR); dashboard item jatuh tempo | ✅ C | `Asset.maintenanceRequired`, interval; dashboard "maintenance jatuh tempo" sudah ada untuk GA → perluas |
| 25 | Kendaraan: nomor plat, nomor rangka, catatan | ✅ C | Atribut tambahan aset GA (plat, rangka, mesin, STNK/pajak) bila item bertipe kendaraan |
| 26 | Riwayat: tampilkan nama + role + sub-role pelaku | ✅ | `WoEvent` simpan snapshot `actorRole`, `actorSubRole`; tampilkan di timeline |
| 27 | Permintaan pembelian hanya supervisor/manager + GA/Procurement | ✅ | Izin aksi PR berdasarkan sub-role (butir 16) |
| 28 | Pelanggan existing dari API; yang baru bisa kode manual + info "tarik data API" bila otomatis gagal | ✅ | Form Pasang Baru: pilih dari hasil sinkron atau ketik kode; pesan inline + tombol tarik data |
| 29 | Tentukan field/master dari API | ✅ | **Menunggu konfirmasi pemilik** — usulan di `docs/RADIUS-API.md` |
| 30 | Tombol tarik data (MKT & Admin) + otomatis; IP dari API dipakai cek/isi saat NOC isi VLAN+IP | ✅ | Cron BullMQ + tombol; `SyncRun`; upsert by `kode`; lihat rancangan di `docs/RADIUS-API.md` |
| 31 | ODP/port diisi NOC tetapi FOC boleh ubah di lapangan (cek duplikat); IP & VLAN tetap | ✅ C | Aksi/field FOC di laporan instalasi; validasi unik ODP+port |
| 32 | Log notifikasi: jangan "SENT" bila belum diset; status Failed/Not sent + alasan + tombol kirim ulang | ✅ A | Sekarang dry-run mencatat SENT. Ubah: `NOT_SENT` (alasan "SMTP/Telegram belum diatur"), tombol kirim ulang (endpoint + antre ulang) |
| 33 | "Stock mobile" → "Stok berjalan" | ✅ A | Ganti label di UI & dokumen (kode `MOBILE` boleh tetap) |
| 34 | Logo GPS (banner foto) terpisah dari logo aplikasi | ✅ A | Varian branding baru `gpsLogoUrl` (logo perusahaan); `photo.ts` memakainya; fallback logo horizontal |
| 35 | Admin: menu token API + form lain | ✅ | Kartu "Integrasi MSRadius" di Admin → Pengaturan (URL, token terenkripsi, sakelar auto-sync, interval, uji koneksi, riwayat) |
| 36 | Daftar data/fitur Maung vs data API yang bisa dipakai | ✅ | `docs/RADIUS-API.md` (menunggu persetujuan butir 29) |

### Urutan batch yang disarankan
- **A (cepat, UX/infra)**: 1, 2, 3, 7, 9, 10, 13, 21, 26(sebagian), 32, 33, 34.
- **B (peran & izin)**: 16 → 17, 6, 11, 15, 12, 27(sebagian), 26. *Sub-role dulu karena menjadi dasar izin.*
- **C (logika lapangan & aset)**: 19 → 18, 20, 22, 31, 24, 25.
- **D (pengadaan)**: 23, 5, 27, 14 — butuh berkas form PR dan keputusan master Vendor.
- **E (integrasi MSRadius)**: 35 → 29 (konfirmasi) → 30 → 4/28.

## 4. Keputusan pemilik & pertanyaan terbuka
**Keputusan (sesi 2026-10-09):**
- **Sub-role (16/17)**: akun demo langsung diberi supervisor/manager agar bisa diuji (mis. satu FOC supervisor, satu FOC staff, satu manager); Admin menetapkan sub-role.
- **API MSRadius = BACA-SAJA.** Sistem ini tidak pernah menulis ke MSRadius; penghapusan pelanggan tidak dilakukan dari sini. Data pelanggan bersumber dari MSRadius (1 sumber). Akses lewat **HTTP polos**; token uji akan diberikan pemilik bila perlu.
- **IP/VLAN (22)**: IP internal wajib privat RFC 1918; **IP Publik** kolom opsional (tidak wajib), dicek duplikat hanya bila diisi dan hanya dengan nilai sama (nanti digabung IPAM). Tidak ada master subnet per VLAN untuk saat ini.
- **Form PR (23)**: file `Soft_Copy_pengajuan.pdf` sudah diterima (Pengajuan No. `250/L1V/PNJ-BDG/X/2026`, tabel No/Deskripsi/Qty/Satuan/Nominal/Total + PPN 11% + Grand Total, tanda tangan Mengajukan/Mengetahui/Menyetujui, halaman 2 tabel Perbandingan: No/Deskripsi/Vendor/Nominal/Total/Keterangan + Kebutuhan + Total). **Kop surat** A4 untuk semua dokumen laporan: `docs/branding/kop-surat-a4.jpg` (gambar latar penuh 2480×3508 px, dari `A4.docx`; margin 2,54 cm).

**Masih terbuka / untuk diverifikasi pemilik di staging:**
1. **Butir 29 (default sudah diterapkan)**: `databilling/data` → pelanggan, `databilling/profile` → Master Paket. Cek di data asli: field `name` berisi nama orang atau nama akun? (bila nama akun berformat `PANJI_AGUNG`, nyalakan opsi *Rapikan nama* di Admin → MSRadius).
2. Uji dengan token asli MSRadius (HTTP polos) — semua uji sejauh ini memakai server tiruan lokal (2.320 pelanggan).
3. Bagian *Perbandingan* di PR memakai kolom persis seperti PDF; periksa tampilan cetak (A4, "Grafik latar belakang" aktif) di printer/PDF nyata.
4. Semua batch A–E sudah dikerjakan; VM belum di-update (menunggu pemilik), lalu **database baru + data demo** (`deploy.sh` fresh).

### Urutan batch yang disarankan
- **A (cepat, UX/infra)**: 1, 2, 3, 7, 9, 10, 13, 21, 26(sebagian), 32, 33, 34.
- **B (peran & izin)**: 16 → 17, 6, 11, 15, 12, 27(sebagian), 26. *Sub-role dulu karena menjadi dasar izin.*
- **C (logika lapangan & aset)**: 19 → 18, 20, 22, 31, 24, 25.
- **D (pengadaan)**: 23, 5, 27, 14 — butuh berkas form PR dan keputusan master Vendor.
- **E (integrasi MSRadius)**: 35 → 29 (konfirmasi) → 30 → 4/28.

## 4. Keputusan pemilik & pertanyaan terbuka
**Keputusan (sesi 2026-10-09):**
- **Sub-role (16/17)**: akun demo langsung diberi supervisor/manager agar bisa diuji (mis. satu FOC supervisor, satu FOC staff, satu manager); Admin menetapkan sub-role.
- **API MSRadius = BACA-SAJA.** Sistem ini tidak pernah menulis ke MSRadius; penghapusan pelanggan tidak dilakukan dari sini. Data pelanggan bersumber dari MSRadius (1 sumber). Akses lewat **HTTP polos**; token uji akan diberikan pemilik bila perlu.
- **IP/VLAN (22)**: IP internal wajib privat RFC 1918; **IP Publik** kolom opsional (tidak wajib), dicek duplikat hanya bila diisi dan hanya dengan nilai sama (nanti digabung IPAM). Tidak ada master subnet per VLAN untuk saat ini.
- **Form PR (23)**: file `Soft_Copy_pengajuan.pdf` sudah diterima (Pengajuan No. `250/L1V/PNJ-BDG/X/2026`, tabel No/Deskripsi/Qty/Satuan/Nominal/Total + PPN 11% + Grand Total, tanda tangan Mengajukan/Mengetahui/Menyetujui, halaman 2 tabel Perbandingan: No/Deskripsi/Vendor/Nominal/Total/Keterangan + Kebutuhan + Total). **Kop surat** A4 untuk semua dokumen laporan: `docs/branding/kop-surat-a4.jpg` (gambar latar penuh 2480×3508 px, dari `A4.docx`; margin 2,54 cm).

**Masih terbuka:**
1. **Butir 29**: setujui pemetaan di `docs/RADIUS-API.md` (karena baca-saja & satu sumber: Customer ← `databilling/data` upsert by `kode`; Master Paket ← `databilling/profile` tanpa harga modal/komisi). Apakah `name` di API nama orang atau username PPPoE?
2. **Butir 23**: berapa vendor minimal untuk perbandingan; siapa yang menyetujui PR (Mengetahui/Menyetujui = siapa)?
3. **Butir 21**: konfirmasi bahwa perilaku arsip/hapus baru sudah menjawab keluhan.

### Urutan batch yang disarankan
- **A (cepat, UX/infra)**: 1, 2, 3, 7, 9, 10, 13, 21, 26(sebagian), 32, 33, 34.
- **B (peran & izin)**: 16 → 17, 6, 11, 15, 12, 27(sebagian), 26. *Sub-role dulu karena menjadi dasar izin.*
- **C (logika lapangan & aset)**: 19 → 18, 20, 22, 31, 24, 25.
- **D (pengadaan)**: 23, 5, 27, 14 — butuh berkas form PR dan keputusan master Vendor.
- **E (integrasi MSRadius)**: 35 → 29 (konfirmasi) → 30 → 4/28.

## 4. Pertanyaan terbuka untuk pemilik
1. **Butir 29**: setujui pemetaan di `docs/RADIUS-API.md` (Customer ← `databilling/data`; Master Paket ← `databilling/profile` tanpa harga modal/komisi; NAS/Area opsional; voucher & report tidak dipakai)? Apakah `name` di API nama orang atau username PPPoE? Apakah ID pelanggan = `kode`?
2. **Butir 23**: kirim ulang PDF/gambar form Purchase Request (tidak ada di sesi ini); berapa vendor minimal untuk perbandingan; siapa yang menyetujui PR?
3. **Butir 22**: rencana VLAN/subnet (daftar VLAN yang boleh, subnet per VLAN) agar validasi tidak menebak.
4. **Butir 35**: API MSRadius **HTTP polos** — apakah server bisa menjangkaunya lewat VPN/allowlist, atau bisa dimintakan HTTPS?
5. **Butir 21**: langkah persis saat hapus pelanggan yang datanya "masih ada" (halaman/akun/status).
6. **Butir 16/17**: siapa yang menetapkan sub-role (Admin saja?) dan apakah sub-role perlu tampil di label akun.

## 5. Catatan teknis & risiko
- Migrasi terakhir: `20261008175910_inbox_user_fk`. Tabel yang menyimpan id user tanpa FK sengaja: `AuditLog`, `Notification`, `Attachment.uploadedBy`, `StockMovement.actorId`.
- `seed-demo` hanya sekali (penanda `Setting.demoSeed`); foto demo SVG di volume `uploads` (butir 13).
- Logo yang diberikan pemilik memuat tagline di gambar; ada slot ikon ringkas untuk top bar (`docs/branding/logo-mark.png`).
- Kunci browser memakai `maung_*` (nilai `l1v_*` dimigrasi otomatis).
- Docker penuh tidak dapat dijalankan di sandbox: selalu sebutkan itu dan minta pemilik menguji di VM.
