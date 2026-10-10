# Panduan instalasi dari awal (produksi, dengan domain + SSL)

Berlaku untuk **Ubuntu 22.04 / 24.04 / 26.04+, Debian 12/13, Rocky / AlmaLinux / CentOS Stream / Fedora** (x86_64 / arm64). Tidak terkunci ke satu versi Ubuntu: skrip memilih `apt` atau `dnf` sesuai OS dan memakai repo resmi Docker.

## 0. Yang perlu disiapkan lebih dulu (checklist)
| # | Hal | Keterangan |
|---|---|---|
| 1 | Server / VM | min. 2 vCPU, **4 GB RAM** (atau 2 GB + swap), 20 GB disk, akses `sudo` |
| 2 | **IP publik** server | alamat yang bisa dijangkau dari internet (catat; `curl https://api.ipify.org` di server) |
| 3 | **Nama domain** | mis. `wo.perusahaan.co.id` (Let's Encrypt **tidak** menerbitkan sertifikat untuk alamat IP) |
| 4 | **DNS A record** | `wo.perusahaan.co.id → <IP publik server>`; tunggu menyebar (cek: `getent hosts wo.perusahaan.co.id`). Bila memakai Cloudflare, awalnya set **DNS only (abu-abu)** |
| 5 | **Port 80 & 443 terbuka** | di firewall penyedia VPS/cloud **dan** di OS; 80 wajib untuk verifikasi Let's Encrypt. Bila server di belakang NAT/router kantor: port-forward 80 & 443 ke server |
| 6 | Port 80/443 **kosong** | tidak ada nginx/apache lain di server (`sudo ss -ltnp | grep -E ':80 |:443 '`) |
| 7 | Email admin | untuk pemberitahuan Let's Encrypt (opsional tetapi disarankan) |
| 8 | Akses ke repo | repo private → Personal Access Token (Contents: read-only) atau Deploy Key, lihat README §4 |

## 1. (Hanya bila mengulang dari instalasi lama) — bersihkan
> ⚠️ Langkah ini **menghapus semua data** aplikasi lama. Bila ada data penting, backup dulu (README → *Backup harian*).
```bash
cd /opt/staging/projects/Maung-Wo-Inv        # folder instalasi lama
docker compose down -v --remove-orphans      # hentikan + hapus volume (database, foto, sertifikat lama)
cd ~ && rm -rf /opt/staging/projects/Maung-Wo-Inv
```
Cara paling bersih: pakai VM baru. Bila VM sama, pastikan tidak ada container lain yang memakai port 80/443 (`docker ps`).

## 2. Siapkan server
```bash
sudo timedatectl set-timezone Asia/Jakarta
git clone https://<USERNAME>:<TOKEN>@github.com/thuekx/Maung-Wo-Inv.git && cd Maung-Wo-Inv
sudo bash scripts/install-server.sh                       # Docker + Compose + Portainer
#   tambahan sesuai kebutuhan:  SETUP_FIREWALL=1  (buka SSH, 80, 443, 9443)   SETUP_SWAP=2G  (RAM kecil)
newgrp docker                                             # agar grup docker langsung aktif
docker compose version                                    # harus ≥ 2.24
```
Skrip mengenali OS otomatis. Untuk rilis OS yang belum ada di repo Docker, repo LTS terakhir dipakai (paketnya kompatibel).

## 3. Pasang aplikasi dengan SSL
```bash
bash scripts/deploy.sh --domain wo.perusahaan.co.id --email admin@perusahaan.co.id
```
Skrip akan: membuat `.env` (secret acak) → **memeriksa DNS & port** (memberi peringatan bila belum siap) → build → menjalankan → menunggu API sehat → seed akun awal. Di akhir dicetak URL & password akun demo.

Setelah ±1–2 menit, Caddy menerbitkan sertifikat Let's Encrypt otomatis:
```bash
docker compose logs -f caddy          # cari: "certificate obtained successfully"
```
Lalu buka **https://wo.perusahaan.co.id** → login `admin@l1v.local` (password dicetak skrip; juga: `grep ^SEED_PASSWORD= .env`) → **ganti password semua akun**.

### Yang terjadi otomatis
- **Perpanjangan:** Caddy memperbarui sertifikat ±30 hari sebelum kedaluwarsa (tanpa cron/certbot). Data sertifikat disimpan di volume `caddy_data` — jangan dihapus.
- **Redirect HTTP → HTTPS:** aktif otomatis setelah sertifikat sah terpasang. Sebelum itu, aplikasi tetap bisa dibuka lewat HTTP supaya Anda tidak terkunci.
- **Tautan di email/WhatsApp/Telegram** otomatis memakai `https://wo.perusahaan.co.id`.

### Mengatur SSL dari halaman Admin
**Admin → Pengaturan → SSL & Domain**: status sertifikat (penerbit, berlaku sampai, sisa hari), ganti domain/email, sakelar **SSL aktif**, sakelar **Paksa HTTPS**. Perubahan dimuat Caddy dalam hitungan detik.
- **Mematikan SSL** → aplikasi hanya HTTP (kamera/GPS di HP dan webhook Telegram butuh HTTPS). Sertifikat tetap tersimpan sehingga menyalakan lagi cepat.
- **Jalur pemulihan:** `http://<IP-server>` selalu melayani HTTP biasa. Jika halaman Admin tak terjangkau lewat domain, buka lewat IP lalu perbaiki pengaturan.
- **Pemulihan darurat tanpa Admin:** `docker compose exec caddy sh -c 'printf ":80 {\n\treverse_proxy web:3000\n}\n" > /etc/caddy/Caddyfile'` (HTTP saja; Caddy memuat ulang otomatis).

## 4. Konfigurasi lanjutan (semua lewat Admin)
1. **Admin → Pengaturan → Email (SMTP)**, **Telegram**, **WhatsApp (Fonnte / Kanca)** — masukkan kredensial lalu *Kirim tes*.
2. **Admin → Tampilan & brand**: logo, warna, teks login.
3. **Admin → Pengaturan → MSRadius** bila memakai sinkron pelanggan.
4. Webhook Telegram / Kanca memakai URL `https://wo.perusahaan.co.id/api/...` (lihat halaman API Kanca & pengaturan Telegram).

## 5. Pembaruan & perawatan
```bash
cd Maung-Wo-Inv && git pull origin main && bash scripts/deploy.sh      # data & sertifikat tetap; mode (domain/IP) otomatis dipertahankan
docker compose ps                                                      # semua running/healthy
```
Backup harian + pulihkan: README §4 *Catatan operasional*. Pembaruan keamanan OS otomatis: Ubuntu/Debian `unattended-upgrades`, RHEL-keluarga `dnf-automatic`.

## 6. Tanpa domain (uji / jaringan internal)
`bash scripts/deploy.sh` → `http://<IP-server>:3000` (tanpa SSL; buka port 3000). Kamera & GPS di HP **tidak** berfungsi tanpa HTTPS. Bisa dinaikkan ke SSL kapan saja: `bash scripts/deploy.sh --domain …`.

## 7. Masalah umum
| Gejala | Penyebab / solusi |
|---|---|
| Sertifikat tidak terbit / Admin menampilkan "Menunggu sertifikat" | DNS belum mengarah ke IP server, port 80/443 tertutup (cek firewall **penyedia VPS** juga), proxy CDN aktif, atau 80/443 dipakai proses lain. Lihat `docker compose logs caddy`. Let's Encrypt membatasi percobaan gagal — perbaiki DNS/port lalu tunggu beberapa menit |
| `permission denied ... docker.sock` | `newgrp docker` atau login ulang |
| Build web "Killed" | RAM kurang → `sudo SETUP_SWAP=2G bash scripts/install-server.sh` |
| `deploy.sh` mengeluh port 80/443 dipakai | `sudo systemctl disable --now nginx apache2` lalu ulangi |
| Ingin ganti domain | `bash scripts/deploy.sh --domain domain-baru.co.id` (DNS baru harus sudah mengarah ke server) |
