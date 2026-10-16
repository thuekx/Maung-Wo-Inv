# Backup harian ke NAS (UGREEN atau TrueNAS)

Skrip: `scripts/offsite-backup.sh`. Setiap malam jam 03:30 VM membuat satu set backup lalu mengirimnya ke NAS.

**Isi satu set**
| Berkas | Isi |
|---|---|
| `db-<container>.sql.gz` | `pg_dumpall` tiap container Postgres/PostGIS yang berjalan (WO, CRM, aplikasi lain) |
| `vol-<volume>.tgz` | volume Docker berakhiran `_uploads` (foto/berkas WO, CRM bila ada) |
| `garage-*.tgz` | arsip Garage (berkas S3 bersama), lewat `garage-backup.sh`. Dilewati bila Garage tidak berjalan |
| `SHA256SUMS`, `INFO.txt` | checksum tiap berkas, host, commit WO, waktu |

Di VM disimpan 2 set terakhir (`~/maung-offsite/`).

| | UGREEN NAS (utama) | TrueNAS (cadangan lama) |
|---|---|---|
| Cara kirim | SMB + **restic** (terenkripsi, deduplikasi) | rsync + SSH (kunci SSH) |
| Riwayat | restic: 7 harian, 4 mingguan, 6 bulanan | Periodic Snapshot TrueNAS |
| Verifikasi tiap malam | snapshot dipulihkan lagi dari NAS lalu dicek checksum + `restic check` | `rsync --checksum` |
| Jaringan | langsung, atau lewat **Tailscale container** bila UGREEN hanya terjangkau via Tailscale | langsung (port 22) |

Untuk UGREEN semua alat berjalan sebagai container Docker (`rclone/rclone`, `restic/restic`, `tailscale/tailscale`). Tidak perlu sudo, tidak ada paket yang dipasang di VM, dan jaringan VM tidak diubah.

## A. Persiapan di UGREEN (sekali, lewat web UGOS)
1. **SMB aktif**: *Control Panel → File Service → SMB*, aktifkan.
2. **User**: *Control Panel → User → Create*: username `maung_backup`, password kuat (diketik nanti di skrip VM, jangan dikirim di chat).
3. **Shared folder**: *Control Panel → Shared Folder → Create*: nama `Maung_Backup`. Di *Permissions* beri `maung_backup` **Read/Write**; user lain sebaiknya tanpa akses.
4. **Tailscale** (bila UGREEN hanya terjangkau lewat Tailscale): app Tailscale di UGREEN sudah login. Catat **IP Tailscale UGREEN** (100.x.x.x) dari app itu atau dari login.tailscale.com → *Machines*.
5. (Disarankan) Snapshot shared folder `Maung_Backup` harian di UGREEN bila fitur Snapshot tersedia, supaya backup tetap aman walau VM disusupi.

## B. Persiapan di TrueNAS (bila memakai TrueNAS)
1. **Dataset** `maung-backup` (*Datasets → Add Dataset*, preset *Generic*), mis. `/mnt/tank/maung-backup`.
2. **User** `maung-backup`: *Home Directory* = folder dataset, *Shell* = `bash`, centang *SSH password login disabled*. Di dataset → *Permissions*: owner `maung-backup`.
3. **SSH**: *System → Services → SSH* aktif + *Start Automatically*.
4. **Riwayat**: *Data Protection → Periodic Snapshot Tasks*: dataset `maung-backup`, 30 hari, harian 05:00.

## C. Di VM: satu perintah, tanya-jawab
```
cd ~/Maung-Wo-Inv && git pull --ff-only origin main && bash scripts/offsite-backup.sh siapkan
```
Tanpa `</dev/null`, karena skrip ini bertanya. Tekan Enter untuk memakai nilai di [kurung].

**UGREEN (pilihan 1)**: skrip menanyakan IP UGREEN (LAN atau Tailscale), port SMB `[445]`, shared folder `[Maung_Backup]`, user `[maung_backup]`, dan password user itu (diketik tersembunyi dua kali, disimpan tersamar di `~/.maung-offsite.d/rclone.env`, chmod 600). Lalu:
- Bila UGREEN **tidak** terjangkau langsung, skrip menawarkan **Tailscale container** `maung-offsite-ts`. Skrip menampilkan satu link `https://login.tailscale.com/a/…`: buka di HP/laptop, login ke akun Tailscale yang sama dengan UGREEN, klik *Connect*. Mesin baru bernama `maung-apps-backup` muncul di tailnet. Di login.tailscale.com → *Machines* → `maung-apps-backup` → ⋯ → **Disable key expiry** agar tidak perlu login ulang tiap 180 hari. Container ini otomatis hidup lagi setelah VM restart.
- Pertama kali, skrip membuat **password enkripsi backup** dan menampilkannya sekali. **Catat di password manager/kertas** lalu ketik `sudah`. Tanpa password ini backup tidak dapat dibuka bila VM hilang. Tersimpan di VM: `~/.maung-offsite.d/restic.pass`.
- Skrip menguji koneksi, menawarkan backup pertama, lalu memasang jadwal 03:30. Di akhir ditampilkan semua isian.

**TrueNAS (pilihan 2)**: tanya host/port/user/folder, tampilkan kunci publik untuk ditempel di TrueNAS (*Credentials → Users → maung-backup → Edit → Authorized Keys*), uji, backup pertama, jadwal.

Jalankan perintah yang sama kapan saja untuk mengubah isian atau pindah NAS. Perintah lain (tanpa tanya): `test`, `run`, `cron`, dan untuk TrueNAS `setup <host> <user> <folder> [port]`.

Cek hasil malam terakhir: `ls -t ~/maung-wo-logs/offsite-backup-*.log | head -1 | xargs tail -n 15`.

## Bila gagal
| Pesan | Penyebab umum |
|---|---|
| `username/password SMB ditolak UGREEN` | password berubah atau salah ketik. Jalankan `siapkan`, ketik password baru |
| `shared folder '…' tidak ditemukan` | nama shared folder harus persis sama (huruf besar-kecil) |
| `user … tidak punya izin baca/tulis` | langkah A3: beri `maung_backup` Read/Write |
| `port 445 (SMB) … tidak dapat dijangkau` | IP salah, SMB UGREEN mati, atau UGREEN hanya lewat Tailscale (jalankan `siapkan`, terima tawaran Tailscale) |
| `Tailscale backup belum login/terhubung` | login Tailscale kedaluwarsa atau dicabut. Jalankan `siapkan` dan buka link login lagi |
| `repositori restic … tidak bisa dibuka (password enkripsi berbeda?)` | `~/.maung-offsite.d/restic.pass` berubah/hilang. Kembalikan password yang dicatat ke berkas itu |
| `Permission denied (publickey)` (TrueNAS) | kunci publik belum ditempel di user TrueNAS |
| `port 22 … tidak dapat dijangkau` (TrueNAS) | firewall/router, IP salah, atau SSH TrueNAS mati |
| `dump … gagal` | container Postgres bermasalah. Set tidak lengkap dihapus, isi NAS tidak diubah |

## Pemulihan (ringkas)
**Dari UGREEN (restic)**: pemulihan memakai restic dan password enkripsi yang dicatat. Di VM yang masih punya isian, satu snapshot terbaru dapat diambil ke `~/pulih/maung-backup/`:
```
bash -c '. ~/.maung-offsite.conf; set -a; . ~/.maung-offsite.d/rclone.env; set +a; mkdir -p ~/pulih; N=(--network maung-offsite); [ "$OFFSITE_VIA" = TAILSCALE ] && N=(--network container:maung-offsite-ts); A=:8000; R=http://maung-offsite-rclone:8000/; [ "$OFFSITE_VIA" = TAILSCALE ] && A=127.0.0.1:8000 && R=http://127.0.0.1:8000/; docker network create maung-offsite >/dev/null 2>&1; docker run -d --rm --name maung-offsite-rclone --env-file ~/.maung-offsite.d/rclone.env "${N[@]}" rclone/rclone:1.75.2 serve restic "NAS:$OFFSITE_SHARE/$OFFSITE_FOLDER" --addr $A; sleep 5; docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e RESTIC_REPOSITORY=rest:$R -e RESTIC_PASSWORD_FILE=/run/restic.pass -v ~/.maung-offsite.d/restic.pass:/run/restic.pass:ro -v ~/pulih:/pulih "${N[@]}" restic/restic:0.19.1 --no-cache restore latest --target /pulih; docker rm -f maung-offsite-rclone >/dev/null; cd ~/pulih/maung-backup && sha256sum -c SHA256SUMS'
```
Untuk VM baru (isian hilang) atau snapshot tanggal tertentu, minta dipandu: perlu IP/user/password UGREEN dan password enkripsi yang dicatat.

**Dari TrueNAS**: ambil folder `latest/` atau snapshot lama (*Datasets → maung-backup → Snapshots*), salin ke VM, cek `sha256sum -c SHA256SUMS`.

**Setelah berkas ada di VM**:
1. Database WO (menimpa isi DB!): hentikan aplikasi (`docker compose stop api worker web`), lalu
   `zcat db-maung-wo-inv-postgres-1.sql.gz | docker exec -i maung-wo-inv-postgres-1 psql -U l1v -d postgres`
   (dump berisi `CREATE DATABASE`; bila DB masih ada, hapus dulu atau pulihkan ke VM baru). Untuk pemulihan sebagian tetap tersedia Admin → Data & Backup (backup aplikasi).
2. Volume unggahan: `docker run --rm -v maung-wo-inv_uploads:/dst -v "$PWD":/in:ro alpine tar xzf /in/vol-maung-wo-inv_uploads.tgz -C /dst`.
3. Garage: arsip berisi `m/snapshots/<waktu>` (metadata) dan `d/` (data). Prosedur pulih Garage belum diuji; minta dipandu saat dibutuhkan.
