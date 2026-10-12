# Garage bersama (S3) — Maung

Satu Garage (single-node) untuk semua aplikasi: bucket + kunci per aplikasi (izin hanya pada bucketnya), kuota per bucket, tanpa port host, jaringan khusus `maung_storage`.

| Hal | Nilai |
|---|---|
| Container / alias jaringan | `maung-garage` (jaringan `maung_storage`) |
| Endpoint S3 untuk aplikasi | `http://maung-garage:3900`, region `garage`, **path-style** |
| Compose project | `maung-garage` (terpisah dari WO/CRM) |
| Volume | `maung-garage_meta`, `maung-garage_data` (atau volume CRM yang diadopsi: `maung-crm_garage_meta/data`) — eksternal, tidak terhapus oleh `down -v` |

## Skrip (jalankan dari `~/Maung-Wo-Inv`, tanpa sudo, `</dev/null`)
- `bash scripts/garage-platform.sh status` — baca-saja.
- `bash scripts/garage-platform.sh up` — pasang Garage baru (volume baru, layout awal).
- `bash scripts/garage-platform.sh adopt-crm` — pindahkan Garage CRM yang ada ke stack ini **tanpa menyalin data** (volume CRM diadopsi; bucket `crm-photos` & kunci `crm-key` ikut). Aplikasi CRM tetap berjalan lewat alias sementara `garage`.
- `bash scripts/garage-platform.sh finalize` — lepas alias sementara setelah CRM memakai `maung-garage` di `maung_storage`.
- `bash scripts/garage-app.sh <app> [--quota 10GiB] [--env-file <.env aplikasi>]` — buat bucket `<app>-photos` + kunci `<app>-key` (+ kuota), tulis kunci ke `.env` aplikasi hanya bila masih kosong, tanpa mencetak rahasia.
- `bash scripts/garage-backup.sh` — snapshot metadata (`garage meta snapshot`) + arsip snapshot & data ke `~/maung-garage-backups/` (simpan 3 terakhir).

## Aturan
- Jangan pernah menjalankan **dua** Garage pada volume yang sama.
- Satu aplikasi = satu bucket + satu kunci; jangan bagikan kunci antar aplikasi.
- Satu node tanpa replika: backup terjadwal adalah satu-satunya perlindungan — jadwalkan `garage-backup.sh` (mis. cron harian) dan salin hasilnya keluar VM.
