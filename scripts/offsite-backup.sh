#!/usr/bin/env bash
# MAUNG — backup harian ke luar VM (TrueNAS) lewat rsync+SSH (kunci SSH, tanpa password di chat/skrip).
# Isi satu set backup: dump semua database Postgres yang berjalan (WO, CRM, …), arsip volume *_uploads, arsip Garage (bila ada).
#
# Pemakaian (di VM, sebagai user biasa, BUKAN sudo):
#   bash scripts/offsite-backup.sh setup <host> <user> <folder> [port]   # sekali: simpan tujuan + buat kunci SSH, tampilkan kunci publik
#   bash scripts/offsite-backup.sh test                                  # uji koneksi ke TrueNAS
#   bash scripts/offsite-backup.sh run                                   # buat backup lalu kirim (bawaan bila tanpa argumen)
#   bash scripts/offsite-backup.sh cron                                  # pasang jadwal harian 03:30 (crontab user, tanpa sudo)
# Tujuan disimpan di ~/.maung-offsite.conf (bukan .env). Kunci: ~/.ssh/maung_offsite_ed25519.
# Di TrueNAS isi folder tujuan selalu = set terbaru (rsync --delete); RIWAYAT disimpan oleh Periodic Snapshot TrueNAS
# (lihat docs/BACKUP-TRUENAS.md) — snapshot ZFS tidak bisa dihapus dari VM, jadi aman bila VM disusupi.
set -uo pipefail
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
CONF="${OFFSITE_CONF:-$HOME/.maung-offsite.conf}"; KEY="${OFFSITE_KEY:-$HOME/.ssh/maung_offsite_ed25519}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/maung-wo-logs"; STAGE_ROOT="$HOME/maung-offsite"; KEEP_LOCAL="${KEEP_LOCAL:-2}"
TS="$(date +%Y%m%d-%H%M%S)"; LOG="$LOG_DIR/offsite-backup-$TS.log"
MODE="${1:-run}"; STATUS=FAIL; REASON="-"; N=5
V_DEST="-"; V_SET="-"; V_SIZE="-"; V_DB="-"; V_UP="-"; V_GARAGE="-"; V_VERIFY="-"
banner() { printf '\n==================================================================\n  %s\n==================================================================\n' "$1"; }
phase()  { printf '\n[%s/%s] %s\n' "$1" "$N" "$2"; }
ok()     { printf '  ✓ %s\n' "$*"; }
warn()   { printf '  ! %s\n' "$*"; }
bad()    { printf '  ✗ %s\n' "$*"; }
result() { banner "RESULT"; cat <<EOF
status=$STATUS
reason=$REASON
mode=$MODE
tujuan=$V_DEST
set=$V_SET
ukuran=$V_SIZE
database=$V_DB
uploads=$V_UP
garage=$V_GARAGE
verifikasi=$V_VERIFY
log_file=$( [ -f "$LOG" ] && echo "$LOG" || echo - )
EOF
sleep 1; }
abort() { STATUS=ABORT; REASON="$1"; bad "$1"; result; exit 2; }
die()   { REASON="$1"; bad "$1"; [ -n "${SET:-}" ] && rm -rf "$SET" && warn "set tidak lengkap $SET dihapus (salinan di TrueNAS tidak diubah)"; result; exit 1; }

guard() {
  [ "$(hostname)" = "$EXPECT_HOST" ] || abort "host '$(hostname)' ≠ '$EXPECT_HOST' (bukan VM yang dituju)"
  [ "$(id -u)" != 0 ] || abort "jangan jalankan sebagai root/sudo"
  command -v ssh >/dev/null && command -v rsync >/dev/null || abort "ssh/rsync belum terpasang (sudo apt-get install -y rsync openssh-client)"
}
load_conf() {
  [ -f "$CONF" ] || abort "tujuan belum diatur — jalankan dulu: bash scripts/offsite-backup.sh setup <host> <user> <folder>"
  # shellcheck disable=SC1090
  . "$CONF"
  [ -n "${OFFSITE_HOST:-}" ] && [ -n "${OFFSITE_USER:-}" ] && [ -n "${OFFSITE_PATH:-}" ] || abort "$CONF tidak lengkap — jalankan setup lagi"
  OFFSITE_PORT="${OFFSITE_PORT:-22}"; V_DEST="$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_PATH (port $OFFSITE_PORT)"
  [ -f "$KEY" ] || abort "kunci SSH $KEY tidak ada — jalankan setup lagi"
  SSH_CMD="ssh -i $KEY -p $OFFSITE_PORT -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$HOME/.ssh/known_hosts_maung_offsite"
}
remote_ok() { # uji: bisa login & folder tujuan dapat ditulis (lewat rsync, tidak butuh shell interaktif)
  local probe; probe="$(mktemp -d)"; echo "maung $TS" > "$probe/.maung-offsite-probe"
  rsync -a -e "$SSH_CMD" "$probe/.maung-offsite-probe" "$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_PATH/" >/dev/null 2>"$probe/err"; local rc=$?
  RERR="$(tail -n 3 "$probe/err" | tr '\n' ' ')"; rm -rf "$probe"; return $rc
}

case "$MODE" in
# ─────────────────────────────── SETUP ───────────────────────────────
setup)
  N=2; banner "MAUNG — atur tujuan backup luar VM ($TS)"; phase 1 "Guard"; guard
  H="${2:-}"; U="${3:-}"; P="${4:-}"; PORT="${5:-22}"
  [ -n "$H" ] && [ -n "$U" ] && [ -n "$P" ] || abort "pakai: bash scripts/offsite-backup.sh setup <host/IP TrueNAS> <user> <folder, mis. /mnt/tank/maung-backup> [port]"
  [[ "$P" == /* ]] || abort "folder harus path absolut (mis. /mnt/tank/maung-backup)"
  [[ "$PORT" =~ ^[0-9]+$ ]] || abort "port harus angka"
  for v in "$H" "$U" "$P"; do [[ "$v" =~ ^[A-Za-z0-9._/@:-]+$ ]] || abort "isian '$v' memuat karakter tidak diizinkan"; done
  umask 077; printf 'OFFSITE_HOST=%s\nOFFSITE_USER=%s\nOFFSITE_PATH=%s\nOFFSITE_PORT=%s\n' "$H" "$U" "$P" "$PORT" > "$CONF"; chmod 600 "$CONF"
  ok "tujuan disimpan di $CONF"; V_DEST="$U@$H:$P (port $PORT)"
  phase 2 "Kunci SSH"
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  if [ -f "$KEY" ]; then ok "kunci sudah ada: $KEY (dipakai ulang)"; else ssh-keygen -q -t ed25519 -N '' -C "maung-backup@$(hostname)" -f "$KEY" </dev/null && ok "kunci baru dibuat: $KEY" || die "ssh-keygen gagal"; fi
  banner "KUNCI PUBLIK — tempel di TrueNAS (Credentials → Users → $U → Edit → Authorized Keys)"
  cat "$KEY.pub"
  echo "(Ini kunci PUBLIK, aman ditempel di TrueNAS/chat. Kunci privat $KEY tidak pernah ditampilkan.)"
  STATUS=OK; result;;

# ─────────────────────────────── TEST ───────────────────────────────
test)
  N=1; banner "MAUNG — uji koneksi ke TrueNAS ($TS)"; phase 1 "Koneksi"; guard; load_conf
  if remote_ok; then ok "login SSH & tulis ke $OFFSITE_PATH berhasil"; STATUS=OK; V_VERIFY="koneksi OK"; result
  else die "gagal menulis ke $V_DEST: ${RERR:-tidak ada keterangan} — cek docs/BACKUP-TRUENAS.md bagian 'Bila gagal'"; fi;;

# ─────────────────────────────── CRON ───────────────────────────────
cron)
  N=1; banner "MAUNG — pasang jadwal backup harian ($TS)"; phase 1 "Crontab"; guard; load_conf
  command -v crontab >/dev/null || abort "crontab tidak tersedia"
  LINE="30 3 * * * cd $APP_DIR && bash scripts/offsite-backup.sh run </dev/null >/dev/null 2>&1 # maung-offsite-backup"
  { crontab -l 2>/dev/null | grep -v '# maung-offsite-backup$'; echo "$LINE"; } | crontab - || die "crontab gagal dipasang"
  crontab -l 2>/dev/null | grep -q '# maung-offsite-backup$' && ok "terpasang: setiap hari 03:30 (setelah backup otomatis aplikasi 02:30)" || die "baris cron tidak ditemukan"
  ok "hasil tiap malam: ls -t ~/maung-wo-logs/offsite-backup-*.log | head -1 | xargs tail -n 15"
  STATUS=OK; V_VERIFY="cron 03:30"; result;;

# ─────────────────────────────── RUN ───────────────────────────────
run)
  banner "MAUNG — backup ke luar VM ($TS)"
  phase 1 "Guard"; guard; load_conf
  docker info >/dev/null 2>&1 || abort "tidak bisa mengakses Docker"
  mkdir -p "$LOG_DIR" "$STAGE_ROOT" && chmod 700 "$LOG_DIR" "$STAGE_ROOT"; exec > >(tee -a "$LOG") 2>&1
  ok "log: $LOG"
  remote_ok || die "TrueNAS tidak dapat ditulis ($V_DEST): ${RERR:-?} — jalankan: bash scripts/offsite-backup.sh test"
  ok "TrueNAS dapat ditulis: $V_DEST"
  SET="$STAGE_ROOT/$TS"; mkdir -p "$SET" && chmod 700 "$SET"; V_SET="$TS"

  phase 2 "Database (pg_dumpall tiap container Postgres yang berjalan)"
  n=0
  while read -r c img; do
    [ -n "$c" ] || continue
    f="$SET/db-$c.sql.gz"
    docker exec "$c" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' 2>"$SET/.err" | gzip > "$f"
    if [ "${PIPESTATUS[0]}" = 0 ] && gzip -t "$f" 2>/dev/null && zcat "$f" | tail -n 5 | grep -q 'PostgreSQL database cluster dump complete'; then
      n=$((n+1)); ok "$c ($img) → $(basename "$f") ($(du -h "$f" | cut -f1))"
    else die "dump $c gagal: $(tail -n 2 "$SET/.err" | tr '\n' ' ')"; fi
  done < <(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /^(docker\.io\/)?(library\/)?postgres[:@]/ || $2 == "postgres"')
  rm -f "$SET/.err"
  [ "$n" -gt 0 ] || die "tidak ada container Postgres yang berjalan"
  V_DB="$n"

  phase 3 "Berkas unggahan (volume *_uploads)"
  n=0
  for v in $(docker volume ls --format '{{.Name}}' | grep -E '_uploads$'); do
    f="$SET/vol-$v.tgz"
    docker run --rm -v "$v":/src:ro -v "$SET":/b alpine sh -c "tar czf /b/vol-$v.tgz -C /src . && chown $(id -u):$(id -g) /b/vol-$v.tgz" >/dev/null 2>&1 && tar tzf "$f" >/dev/null 2>&1 \
      && { n=$((n+1)); ok "$v → $(basename "$f") ($(du -h "$f" | cut -f1))"; } || die "arsip volume $v gagal"
  done
  V_UP="$n"; [ "$n" -gt 0 ] || warn "tidak ada volume *_uploads"

  phase 4 "Garage (berkas S3 bersama)"
  GC=""; [ "$(docker inspect -f '{{.State.Running}}' maung-garage 2>/dev/null)" = true ] && GC=maung-garage
  [ -z "$GC" ] && GC="$(docker ps --filter label=com.docker.compose.service=garage --format '{{.Names}}' | head -1)"
  if [ -z "$GC" ]; then V_GARAGE="tidak ada"; warn "tidak ada container Garage berjalan — dilewati"
  else
    GOUT="$(GC="$GC" EXPECT_HOST="$EXPECT_HOST" bash "$APP_DIR/scripts/garage-backup.sh" </dev/null 2>&1)"
    GF="$(printf '%s\n' "$GOUT" | sed -n 's/^arsip=//p' | tail -1)"
    if printf '%s\n' "$GOUT" | grep -q '^status=OK' && [ -s "$GF" ]; then { cp -l "$GF" "$SET/" 2>/dev/null || cp "$GF" "$SET/"; } && V_GARAGE="$GC → $(basename "$GF")" && ok "$V_GARAGE ($(du -h "$GF" | cut -f1))" || die "salin arsip Garage gagal"
    else die "garage-backup.sh ($GC) gagal: $(printf '%s\n' "$GOUT" | sed -n 's/^reason=//p' | tail -1)"; fi
  fi

  phase 5 "Kirim ke TrueNAS + verifikasi"
  ( cd "$SET" && sha256sum -- * > SHA256SUMS ) || die "checksum gagal"
  printf 'host=%s\ncommit_wo=%s\nwaktu=%s\n' "$(hostname)" "$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null)" "$TS" > "$SET/INFO.txt"
  V_SIZE="$(du -sh "$SET" | cut -f1)"
  rsync -a --delete --partial -e "$SSH_CMD" "$SET/" "$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_PATH/latest/" || die "rsync ke TrueNAS gagal"
  ok "terkirim ke $OFFSITE_PATH/latest/ ($V_SIZE)"
  DIFF="$(rsync -a --delete --checksum --dry-run --itemize-changes -e "$SSH_CMD" "$SET/" "$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_PATH/latest/" 2>&1)" || die "verifikasi rsync gagal"
  [ -z "$DIFF" ] && { V_VERIFY="isi di TrueNAS identik (checksum)"; ok "$V_VERIFY"; } || die "isi di TrueNAS berbeda setelah kirim: $(printf '%s' "$DIFF" | head -3 | tr '\n' ' ')"
  ls -1d "$STAGE_ROOT"/2*/ 2>/dev/null | sort | head -n -"$KEEP_LOCAL" | xargs -r rm -rf
  ok "salinan lokal disimpan $KEEP_LOCAL set terakhir di $STAGE_ROOT"
  STATUS=OK; result;;

*) echo "Mode tidak dikenal: $MODE (setup | test | run | cron)"; exit 1;;
esac
