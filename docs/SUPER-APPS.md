# Menuju Super Apps (MAUNG)

Tujuan: beberapa aplikasi (WO + Inventori, **Sales Tracking**, dst.) terasa satu produk — satu login, satu menu, data saling merujuk — tanpa menggabungkan kode.

## Prinsip
1. **Satu identitas** — pengguna, divisi (`role`) dan sub-role (`subRole`) dikelola sekali di aplikasi inti (WO). Aplikasi lain *tidak* membuat tabel user sendiri.
2. **Satu alamat** — semua aplikasi di belakang satu domain (mis. `maung.perusahaan.co.id/wo`, `/sales`) lewat reverse proxy (Caddy/Nginx). Karena satu origin, token login dapat dipakai bersama dan tak perlu CORS.
3. **Data saling merujuk lewat ID** — mis. Sales Tracking menyimpan `customerId` milik WO, bukan menyalin data pelanggan. Baca data lewat API, bukan lewat database langsung.
4. **Tiap aplikasi tetap deploy sendiri** (container sendiri, database sendiri). Mudah di-update, gagal satu tidak menjatuhkan yang lain.

## Langkah bertahap
| Tahap | Pekerjaan | Keluaran |
|---|---|---|
| 0 (sudah) | WO punya API sistem + dokumentasi (Admin → API Sistem), API MSRadius baca-saja, URL aplikasi bisa diatur Admin | Aplikasi lain dapat membaca data WO |
| 1 | **Login terpusat**: aplikasi baru memvalidasi token WO lewat `GET /api/auth/introspect` (atau memverifikasi JWT dengan `JWT_SECRET` yang sama) | Satu akun, tanpa user ganda |
| 2 | **Reverse proxy satu domain** + halaman *Launcher* (kartu aplikasi sesuai peran) | Satu pintu masuk |
| 3 | **Navigasi bersama**: top bar/sidebar seragam (paket UI kecil dipakai bersama) | Terasa satu aplikasi |
| 4 | **Event antar-aplikasi** (webhook/antrian): mis. kontrak sales disetujui → WO Pasang Baru terbentuk | Alur lintas aplikasi |
| 5 | Pencarian global & dashboard gabungan | Super apps penuh |

## Satu pintu (visi launcher)
Tujuan: pengguna hanya mengenal **satu alamat (`maung.liv.net.id`) dan satu login**; setelah masuk memilih aplikasi lewat ikon (WO & Inventori, CRM/Sales, dst.) seperti beranda super-app. Dibangun bertahap:
1. **Identitas tunggal** — WO adalah penerbit login/peran; aplikasi lain memvalidasi token lewat `GET /api/auth/introspect` (lihat di bawah). Hak akses per divisi/sub-role dikelola di Admin → Hak Akses.
2. **Satu pintu jaringan** — Caddy meneruskan tiap aplikasi (`proxy/sites/*.caddy` + jaringan `maung_edge`, lihat docs/INSTALL.md). Aplikasi tetap container/database terpisah (terisolasi), hanya web-nya yang tampil di depan.
3. **Launcher** (belum dibuat) — beranda setelah login berisi ikon aplikasi yang boleh diakses peran pengguna; setiap ikon membuka aplikasinya dengan sesi yang sama (token yang sama, atau penukaran token singkat). Keputusan yang masih perlu: apakah tiap aplikasi di subdomain sendiri (`crm.liv.net.id`, mudah, perlu penerusan token) atau di jalur satu domain (`maung.liv.net.id/crm`, sesi/cookie otomatis sama, perlu pengaturan basePath tiap aplikasi).

## Validasi token (tahap 1)
```
GET /api/auth/introspect
Authorization: Bearer <token dari POST /api/auth/login>
→ 200 {"active":true,"sub":"<userId>","name":"…","email":"…","role":"MKT","subRole":"SUPERVISOR","exp":1760000000}
→ 401 bila token salah/kedaluwarsa
```
Aplikasi baru cukup memanggil ini (cache singkat, mis. 60 dtk) lalu memetakan `role`/`subRole` ke hak aksesnya sendiri.

## Untuk project Sales Tracking (berikutnya)
- Stack disarankan sama (Express + Prisma + Next) agar paket UI & pola auth bisa dipakai ulang.
- Jangan salin tabel `User`/`Customer`; rujuk `userId`/`customerId` WO lewat API Sistem.
- Peran sales memakai divisi **Marketing** yang sudah ada; sub-role Manager/Supervisor/Staff tetap.

## Konfigurasi tanpa IP
- Web berjalan **satu alamat**: browser hanya ke `http://<host>:3000`; `/api` dan `/uploads` diteruskan Next ke container `api` lewat nama host docker (`API_INTERNAL_URL`, bawaan `http://api:4000`). Tidak ada IP/port API yang tertanam saat build → ganti IP/domain server tanpa build ulang.
- Tautan di email/WhatsApp/Telegram memakai **URL aplikasi** yang diatur di *Admin → Pengaturan → Tampilan & brand* (kosong = `WEB_URL` di `.env`). Label QR aset memakai alamat yang sedang dibuka.
- `deploy.sh` tidak lagi menimpa `WEB_URL` yang sudah ada kecuali diberi `--host`.

## Penyimpanan berkas (MinIO / Garage)
Saat ini foto & logo disimpan di volume `uploads` pada container api (asli utuh; versi tampil dibuat on-demand di `uploads/.cache`). Bila kelak butuh object storage:
- **Gunakan container terpisah di VM yang sama** (bukan VM baru) — MinIO atau Garage (lebih ringan, cocok VM kecil) dengan volume sendiri. Pisahkan ke VM sendiri hanya bila berkas sangat besar atau API perlu multi-node.
- Perlu perubahan kecil di API (adapter unggah S3 + `/api/img` membaca dari S3). Belum dikerjakan karena volume lokal masih memadai; backup cukup `uploads` + dump Postgres.
