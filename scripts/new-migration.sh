#!/usr/bin/env bash
# Membuat migrasi Prisma baru dengan stempel waktu ASLI (UTC) dari perbedaan schema.prisma vs database dev.
# Pakai:  bash scripts/new-migration.sh nama_singkat     (jalankan setelah mengedit apps/api/prisma/schema.prisma;
#         DATABASE_URL harus menunjuk database dev yang sudah memakai semua migrasi sebelumnya)
set -euo pipefail
NAME="${1:?isi nama migrasi, mis. add_invoice_note}"
[[ "$NAME" =~ ^[a-z0-9_]+$ ]] || { echo "Nama hanya huruf kecil, angka, underscore."; exit 1; }
cd "$(dirname "$0")/../apps/api"
DIR="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_$NAME"
LAST="$(ls prisma/migrations | grep -E '^[0-9]{14}_' | sort | tail -1)"
[[ "${DIR#prisma/migrations/}" > "$LAST" ]] || { echo "Stempel waktu ($DIR) tidak lebih baru dari migrasi terakhir ($LAST). Periksa jam sistem."; exit 1; }
mkdir -p "$DIR"
trap '[ -s "$DIR/migration.sql" ] || rm -rf "$DIR"' EXIT # jangan tinggalkan folder kosong bila gagal
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > "$DIR/migration.sql"
if [ ! -s "$DIR/migration.sql" ] || grep -q "^-- This is an empty migration" "$DIR/migration.sql"; then rm -rf "$DIR"; echo "Tidak ada perubahan schema."; exit 1; fi
echo "Dibuat: apps/api/$DIR"
echo "Periksa isinya (tambahkan UPDATE/DELETE data bila perlu), lalu: npx prisma migrate deploy && commit."
