#!/usr/bin/env bash
# MAUNG — backup Garage bersama: snapshot metadata konsisten (`garage meta snapshot`) + arsip snapshot & data ke ~/maung-garage-backups/ (simpan 3 terakhir).
# Jalankan:  cd ~/Maung-Wo-Inv && bash scripts/garage-backup.sh </dev/null      (cron harian disarankan; SALIN hasilnya keluar VM)
# Catatan: blok data Garage tidak berubah setelah ditulis, jadi arsip data saat Garage berjalan aman; metadata diambil dari snapshot, bukan dari LMDB yang sedang dipakai.
set -uo pipefail
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"; KEEP="${KEEP:-3}"
LOG_DIR="$HOME/maung-wo-logs"; BK_DIR="$HOME/maung-garage-backups"; TS="$(date +%Y%m%d-%H%M%S)"; LOG="$LOG_DIR/garage-backup-$TS.log"
GC=maung-garage; N=5; STATUS=FAIL; REASON="-"; V_SNAP="n/a"; V_FILE="-"; V_SIZE="-"; V_KEPT="-"
banner() { printf '\n==================================================================\n  %s\n==================================================================\n' "$1"; }
phase()  { printf '\n[%s/%s] %s\n' "$1" "$N" "$2"; }
ok()     { printf '  ✓ %s\n' "$*"; }
warn()   { printf '  ! %s\n' "$*"; }
bad()    { printf '  ✗ %s\n' "$*"; }
result() { banner "RESULT"; cat <<EOF
status=$STATUS
reason=$REASON
snapshot=$V_SNAP
arsip=$V_FILE
ukuran=$V_SIZE
arsip_tersimpan=$V_KEPT
cakupan=$([ "${META_ONLY:-0}" = 1 ] && echo "snapshot metadata saja" || echo "snapshot metadata + data")
log_file=$LOG
EOF
sleep 1; }
abort() { STATUS=ABORT; REASON="$1"; bad "$1"; result; exit 2; }
die() { REASON="$1"; bad "$1"; result; exit 1; }
banner "MAUNG — backup Garage bersama ($TS)"
phase 1 "Guard"
[ "$(hostname)" = "$EXPECT_HOST" ] || abort "host '$(hostname)' ≠ '$EXPECT_HOST'"
[ "$(id -u)" != 0 ] || abort "jangan jalankan sebagai root/sudo"
docker info >/dev/null 2>&1 || abort "tidak bisa mengakses Docker"
mkdir -p "$LOG_DIR" "$BK_DIR" && chmod 700 "$LOG_DIR" "$BK_DIR"; exec > >(tee -a "$LOG") 2>&1
[ "$(docker inspect -f '{{.State.Running}}' "$GC" 2>/dev/null)" = true ] || abort "Garage bersama ($GC) tidak berjalan"
ok "Garage berjalan; log: $LOG"
phase 2 "Volume"
META_VOL="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/garage/meta"}}{{.Name}}{{end}}{{end}}' "$GC")"; DATA_VOL="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/garage/data"}}{{.Name}}{{end}}{{end}}' "$GC")"
[ -n "$META_VOL" ] && [ -n "$DATA_VOL" ] || abort "volume meta/data tidak terbaca dari container"
ok "meta: $META_VOL | data: $DATA_VOL"
phase 3 "Snapshot metadata (konsisten)"
docker exec "$GC" /garage meta snapshot >/dev/null 2>&1 || die "'garage meta snapshot' gagal"
sleep 2
V_SNAP="$(docker run --rm -v "$META_VOL":/m:ro alpine sh -c 'ls -1 /m/snapshots 2>/dev/null | tail -1' 2>/dev/null | tr -d '\r\n')"
[ -n "$V_SNAP" ] && ok "snapshot terbaru: $V_SNAP" || die "snapshot tidak ditemukan di $META_VOL/snapshots"
phase 4 "Arsipkan"
F="$BK_DIR/garage-$TS.tgz"
if [ "${META_ONLY:-0}" = 1 ]; then SRC="m/snapshots"; else SRC="m/snapshots d"; fi
docker run --rm -v "$META_VOL":/m:ro -v "$DATA_VOL":/d:ro -v "$BK_DIR":/b alpine sh -c "tar czf /b/garage-$TS.tgz -C / $SRC && chown $(id -u):$(id -g) /b/garage-$TS.tgz && chmod 600 /b/garage-$TS.tgz" >/dev/null 2>&1 && [ -s "$F" ] || { rm -f "$F"; die "pembuatan arsip gagal"; }
V_FILE="$F"; V_SIZE="$(du -h "$F" | cut -f1)"; ok "arsip: $F ($V_SIZE)"
tar tzf "$F" >/dev/null 2>&1 && ok "arsip dapat dibaca (verifikasi daftar isi)" || die "arsip rusak (tar tzf gagal)"
phase 5 "Retensi"
ls -1t "$BK_DIR"/garage-2*.tgz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
V_KEPT="$(ls -1 "$BK_DIR"/garage-2*.tgz 2>/dev/null | wc -l) (maks. $KEEP)"; ok "arsip tersimpan: $V_KEPT"
warn "SALIN arsip keluar VM (satu node tanpa replika): mis. rsync/scp ke mesin lain"
STATUS=OK; REASON="-"; result
