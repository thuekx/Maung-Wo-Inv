# Backup harian ke TrueNAS

Skrip: `scripts/offsite-backup.sh`. Setiap malam VM membuat satu set backup lalu mengirimnya ke TrueNAS lewat rsync + SSH (kunci SSH; tidak ada password di skrip atau chat).

**Isi satu set**
| Berkas | Isi |
|---|---|
| `db-<container>.sql.gz` | `pg_dumpall` tiap container Postgres yang berjalan (WO, CRM, aplikasi lain) |
| `vol-<volume>.tgz` | volume Docker berakhiran `_uploads` (foto/berkas WO, CRM bila ada) |
| `garage-*.tgz` | arsip Garage (berkas S3 bersama), lewat `garage-backup.sh` — dilewati bila Garage tidak berjalan |
| `SHA256SUMS`, `INFO.txt` | checksum tiap berkas, host, commit WO, waktu |

Di TrueNAS folder `<folder>/latest/` selalu berisi set terbaru. **Riwayat harian disimpan oleh Periodic Snapshot TrueNAS** (langkah A4) — snapshot ZFS tidak dapat dihapus dari VM, jadi backup tetap aman walau VM rusak atau disusupi. Di VM disimpan 2 set terakhir (`~/maung-offsite/`).

## A. Persiapan di TrueNAS (sekali, lewat web TrueNAS SCALE)
1. **Dataset**: *Datasets* → pilih pool → *Add Dataset* → nama `maung-backup` (preset *Generic*). Folder tujuannya mis. `/mnt/tank/maung-backup` (ganti `tank` dengan nama pool).
2. **User**: *Credentials → Users → Add*: username `maung-backup`, isi password acak (tidak dipakai), *Home Directory* = `/mnt/tank/maung-backup`, *Shell* = `bash`, centang **SSH password login disabled**. Simpan. Lalu di dataset `maung-backup` → *Permissions* → *Edit*: owner user `maung-backup` (centang *Apply User*), simpan.
3. **SSH**: *System → Services* → **SSH** → aktifkan + *Start Automatically*. (Bila VM dan TrueNAS beda jaringan, pastikan port 22 TrueNAS dapat dijangkau dari VM.)
4. **Riwayat**: *Data Protection → Periodic Snapshot Tasks → Add*: dataset `maung-backup`, *Snapshot Lifetime* 30 hari, jadwal *Daily* jam **05:00** (setelah backup VM 03:30).

## B. Di VM (perintah salin-tempel)
1. Atur tujuan & buat kunci SSH (ganti IP, user, folder sesuai A):
   ```
   cd ~/Maung-Wo-Inv && git pull --ff-only origin main && bash scripts/offsite-backup.sh setup 192.168.1.10 maung-backup /mnt/tank/maung-backup </dev/null
   ```
   Skrip menampilkan **kunci publik** (`ssh-ed25519 AAAA… maung-backup@maung-apps`). Tempel di TrueNAS: *Credentials → Users → maung-backup → Edit → Authorized Keys* → simpan. (Kunci publik aman ditempel; kunci privat tidak pernah ditampilkan.)
2. Uji koneksi: `cd ~/Maung-Wo-Inv && bash scripts/offsite-backup.sh test </dev/null` → `status=OK`.
3. Backup pertama: `cd ~/Maung-Wo-Inv && bash scripts/offsite-backup.sh run </dev/null` → `status=OK`, `verifikasi=isi di TrueNAS identik (checksum)`.
4. Jadwal harian 03:30: `cd ~/Maung-Wo-Inv && bash scripts/offsite-backup.sh cron </dev/null`.

Cek hasil malam terakhir: `ls -t ~/maung-wo-logs/offsite-backup-*.log | head -1 | xargs tail -n 15`.

## Bila gagal
| Pesan | Penyebab umum |
|---|---|
| `Permission denied (publickey)` | kunci publik belum ditempel di user TrueNAS, atau user berbeda dari yang di `setup` |
| `Connection timed out` / `No route to host` | IP salah, SSH TrueNAS belum aktif, atau firewall memblokir port 22 dari VM |
| `rsync: … Permission denied` (saat menulis) | folder tujuan bukan milik user `maung-backup` (langkah A2 *Permissions*) |
| `rsync: command not found` / `connection unexpectedly closed` | *Shell* user TrueNAS masih `nologin` — ubah ke `bash` |
| `dump … gagal` | container Postgres bermasalah; set tidak lengkap dihapus, isi TrueNAS tidak diubah |

## Pemulihan (ringkas)
1. Ambil set dari TrueNAS (folder `latest/` atau snapshot lama: *Datasets → maung-backup → Snapshots*), salin ke VM, cek: `sha256sum -c SHA256SUMS`.
2. Database WO (menimpa isi DB!): hentikan aplikasi (`docker compose stop api worker web`), lalu
   `zcat db-maung-wo-inv-postgres-1.sql.gz | docker exec -i maung-wo-inv-postgres-1 psql -U l1v -d postgres`
   (dump berisi `CREATE DATABASE`; bila DB masih ada, hapus dulu atau pulihkan ke VM baru). Untuk pemulihan sebagian tetap tersedia Admin → Data & Backup (backup aplikasi).
3. Volume unggahan: `docker run --rm -v maung-wo-inv_uploads:/dst -v "$PWD":/in:ro alpine tar xzf /in/vol-maung-wo-inv_uploads.tgz -C /dst`.
4. Garage: arsip berisi `m/snapshots/<waktu>` (metadata) dan `d/` (data). Prosedur pulih Garage belum diuji; minta dipandu saat dibutuhkan (Garage dihentikan, isi volume meta dari snapshot, volume data dari `d/`).
