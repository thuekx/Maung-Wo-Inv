#!/usr/bin/env bash
# MAUNG WO — update aman (berfase): guard host/direktori → snapshot → backup volume Caddy → git pull → deploy → verifikasi → swa-uji jalur aplikasi.
# Tidak membuat/menimpa/mengubah .env (diverifikasi dengan checksum). Backup volume caddyconf dulu; rollback konfigurasi otomatis bila gagal.
# Jalankan:   cd ~/Maung-Wo-Inv && PREV_COMMIT=$(git rev-parse --short HEAD) && git pull --ff-only origin main && bash scripts/update-safe.sh </dev/null
#   (PREV_COMMIT hanya agar blok RESULT mencatat commit sebelum pull; boleh dihilangkan. Skrip ini juga melakukan git pull sendiri.)
set -uo pipefail

EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
APP_DIR="${APP_DIR:-$HOME/Maung-Wo-Inv}"
LOG_DIR="$HOME/maung-wo-logs"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/update-safe-$TS.log"
BK_DIR="$LOG_DIR"
BK_FILE="$BK_DIR/caddyconf-$TS.tgz"
CONF_VOL="maung-wo-inv_caddyconf"
N=10
STATUS="FAIL"; REASON=""; ROLLED="no"
COMMIT_BEFORE=""; COMMIT_AFTER=""; ENV_OK="n/a"; CADDY_IMPORT="n/a"; CADDY_VALIDATE="n/a"; NET="n/a"; HTTPS_CODE="n/a"; HTTP_CODE="n/a"; API_H="n/a"; SELFTEST="n/a"

banner() { printf '\n==================================================================\n  %s\n==================================================================\n' "$1"; }
phase()  { printf '\n[%s/%s] %s\n' "$1" "$N" "$2"; }
ok()     { printf '  ✓ %s\n' "$*"; }
warn()   { printf '  ! %s\n' "$*"; }
bad()    { printf '  ✗ %s\n' "$*"; }

result() {
  banner "RESULT"
  cat <<EOF
status=$STATUS
reason=${REASON:--}
host=$(hostname)
dir=$APP_DIR
commit_before=${COMMIT_BEFORE:--}
commit_after=${COMMIT_AFTER:--}
env_unchanged=$ENV_OK
network_maung_edge=$NET
api_health=$API_H
caddy_import=$CADDY_IMPORT
caddy_validate=$CADDY_VALIDATE
apps_path_selftest=$SELFTEST
https_status=$HTTPS_CODE
http_status=$HTTP_CODE
rolled_back=$ROLLED
backup_caddyconf=${BK_FILE}
log_file=$LOG
rollback_config_cmd=docker run --rm -v ${CONF_VOL}:/dst -v ${BK_DIR}:/in:ro alpine sh -c 'rm -rf /dst/* /dst/.[!.]* 2>/dev/null; tar xzf /in/$(basename "$BK_FILE") -C /dst'
rollback_code_cmd=cd $APP_DIR && git reset --hard ${COMMIT_BEFORE:-HEAD} && bash scripts/deploy.sh
EOF
  sleep 1
}

compose() { docker compose "${FILES[@]}" "$@"; }

restore_caddy_conf() {
  [ -s "$BK_FILE" ] || { bad "backup caddyconf tidak ada — tidak bisa rollback konfigurasi"; return 1; }
  docker run --rm -v "$CONF_VOL":/dst -v "$BK_DIR":/in:ro alpine sh -c "rm -rf /dst/* /dst/.[!.]* 2>/dev/null; tar xzf /in/$(basename "$BK_FILE") -C /dst" >/dev/null 2>&1 \
    && ok "isi volume caddyconf dikembalikan dari backup" || { bad "restore volume gagal"; return 1; }
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    && ok "Caddy memuat ulang konfigurasi lama" || warn "reload Caddy gagal — coba: docker compose restart caddy"
  ROLLED="config"
}

die() { # die "alasan"  → rollback konfigurasi Caddy bila sudah dibackup, lalu RESULT
  REASON="$1"; bad "$1"
  if [ -s "$BK_FILE" ] && [ "${CADDY_TOUCHED:-0}" = 1 ]; then banner "ROLLBACK konfigurasi Caddy"; restore_caddy_conf; fi
  result; exit 1
}

# ─────────────────────────────── [1/9] GUARD ───────────────────────────────
banner "MAUNG WO — update aman  ($TS)"
phase 1 "Guard host & direktori"
[ "$(hostname)" = "$EXPECT_HOST" ] || { bad "host '$(hostname)' ≠ '$EXPECT_HOST' — dihentikan (bukan VM yang dituju)"; STATUS=ABORT; REASON="host salah"; result; exit 2; }
ok "host = $EXPECT_HOST"
[ "$(id -u)" != 0 ] || { bad "jangan jalankan sebagai root/sudo (membuat file milik root di repo)"; STATUS=ABORT; REASON="root"; result; exit 2; }
ok "dijalankan sebagai $(id -un)"
[ -d "$APP_DIR/.git" ] || { bad "$APP_DIR bukan repo git"; STATUS=ABORT; REASON="direktori salah"; result; exit 2; }
cd "$APP_DIR" || exit 2
git remote get-url origin 2>/dev/null | grep -qi 'thuekx/Maung-Wo-Inv' || { bad "origin bukan thuekx/Maung-Wo-Inv"; STATUS=ABORT; REASON="repo salah"; result; exit 2; }
ok "repo: $APP_DIR (origin thuekx/Maung-Wo-Inv)"
[ -f .env ] || { bad ".env tidak ada — skrip ini TIDAK akan membuatnya. Dihentikan"; STATUS=ABORT; REASON=".env tidak ada"; result; exit 2; }
ok ".env ada (hanya dibaca)"
docker info >/dev/null 2>&1 || { bad "tidak bisa mengakses Docker sebagai $(id -un) (jangan pakai sudo; lihat: sudo usermod -aG docker \$USER lalu login ulang)"; STATUS=ABORT; REASON="docker"; result; exit 2; }
ok "Docker dapat diakses"
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
exec > >(tee -a "$LOG") 2>&1
ok "log audit: $LOG"

if grep -q '^WEB_DOMAIN=.\+' .env; then FILES=(-f docker-compose.yml -f docker-compose.caddy.yml); ok "mode Caddy/HTTPS (WEB_DOMAIN terdeteksi)"; else FILES=(-f docker-compose.yml); warn "tanpa Caddy (WEB_DOMAIN kosong) — bagian Caddy dilewati"; fi
DOMAIN="$(grep '^WEB_DOMAIN=' .env | head -1 | cut -d= -f2-)"
HAS_CADDY=0; [ -n "$DOMAIN" ] && HAS_CADDY=1

# ─────────────────────────────── [2/9] SNAPSHOT ────────────────────────────
phase 2 "Snapshot keadaan sebelum perubahan"
COMMIT_BEFORE="${PREV_COMMIT:-$(git rev-parse --short HEAD)}"; ok "commit sebelum update: $COMMIT_BEFORE"
ENV_SUM_BEFORE="$(sha256sum .env | cut -d' ' -f1)"; ok "checksum .env dicatat (isi tidak ditampilkan)"
DIRTY="$(git status --porcelain --untracked-files=no | wc -l)"; [ "$DIRTY" = 0 ] && ok "working tree bersih" || warn "$DIRTY berkas terlacak berubah di server (git pull bisa gagal)"
AVAIL_MB="$(df -Pm "$APP_DIR" | awk 'NR==2{print $4}')"; [ "${AVAIL_MB:-0}" -gt 2000 ] && ok "ruang disk bebas ${AVAIL_MB} MB" || warn "ruang disk bebas hanya ${AVAIL_MB:-?} MB (build butuh ±2 GB)"
compose ps --format '{{.Service}}={{.State}}' 2>/dev/null | tr '\n' ' ' | sed 's/^/  • layanan sebelum: /; s/$/\n/'

# ─────────────────────────────── [3/9] BACKUP ──────────────────────────────
phase 3 "Backup volume Caddy (caddyconf)"
if [ "$HAS_CADDY" = 1 ]; then
  docker volume inspect "$CONF_VOL" >/dev/null 2>&1 || die "volume $CONF_VOL tidak ditemukan"
  # container berjalan sebagai root → berkas dimiliki root; serahkan ke pemilik sebenarnya (chown di dalam container) lalu batasi izin
  docker run --rm -e OWN="$(id -u):$(id -g)" -v "$CONF_VOL":/src:ro -v "$BK_DIR":/out alpine sh -c "tar czf /out/$(basename "$BK_FILE") -C /src . && chown \$OWN /out/$(basename "$BK_FILE") && chmod 600 /out/$(basename "$BK_FILE")" >/dev/null 2>&1 || die "backup volume caddyconf gagal"
  [ -s "$BK_FILE" ] || die "berkas backup kosong"
  ok "backup: $BK_FILE ($(du -h "$BK_FILE" | cut -f1))"
  docker run --rm -v "$CONF_VOL":/src:ro alpine sh -c 'cat /src/Caddyfile' > "$BK_DIR/Caddyfile-before-$TS.txt" 2>/dev/null && ok "salinan Caddyfile lama: $BK_DIR/Caddyfile-before-$TS.txt"
else warn "dilewati (tanpa Caddy)"; fi

# ─────────────────────────────── [4/9] GIT PULL ────────────────────────────
phase 4 "Ambil kode terbaru (git pull --ff-only)"
git pull --ff-only origin main || die "git pull gagal (ada perubahan lokal / cabang menyimpang)"
COMMIT_AFTER="$(git rev-parse --short HEAD)"
ok "commit: $COMMIT_BEFORE → $COMMIT_AFTER"
[ -d proxy/sites ] && [ -d proxy/apps ] && ok "proxy/sites/ dan proxy/apps/ tersedia" || die "proxy/sites atau proxy/apps tidak ada — kode belum yang terbaru?"

# ─────────────────────────────── [5/9] DEPLOY ──────────────────────────────
phase 5 "Build & start (scripts/deploy.sh) — 502/500 singkat itu normal"
CADDY_TOUCHED=1
bash scripts/deploy.sh 2>&1 | sed -E 's#(Login +: ).*#\1[disembunyikan]#; s#(SEED_PASSWORD=).*#\1[disembunyikan]#' | tail -n 60
DEPLOY_RC=${PIPESTATUS[0]}
[ "$DEPLOY_RC" = 0 ] && ok "deploy.sh selesai" || die "deploy.sh gagal (kode $DEPLOY_RC) — lihat log migrate di atas"

# ─────────────────────────────── [6/9] VERIFIKASI .env ─────────────────────
phase 6 "Verifikasi .env tidak berubah"
ENV_SUM_AFTER="$(sha256sum .env | cut -d' ' -f1)"
if [ "$ENV_SUM_BEFORE" = "$ENV_SUM_AFTER" ]; then ENV_OK=yes; ok ".env identik (checksum sama)"; else ENV_OK=NO; bad ".env BERUBAH — periksa segera (backup tidak dibuat skrip ini)"; die ".env berubah"; fi

# ─────────────────────────────── [7/9] VERIFIKASI SISTEM ───────────────────
phase 7 "Verifikasi layanan, jaringan, dan Caddy"
for i in $(seq 1 40); do
  cid="$(compose ps -q api)"; st="$([ -n "$cid" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"
  [ "$st" = healthy ] && break; sleep 3
done
API_H="$st"; [ "$st" = healthy ] && ok "API healthy" || die "API tidak healthy ($st)"
for s in web worker postgres redis; do
  cid="$(compose ps -q $s)"; [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Running}}' "$cid")" = true ] && ok "$s berjalan" || die "$s tidak berjalan"
done
if [ "$HAS_CADDY" = 1 ]; then
  docker network inspect maung_edge >/dev/null 2>&1 && ok "jaringan maung_edge ada" || die "jaringan maung_edge tidak ada"
  ccid="$(compose ps -q caddy)"
  if [ -n "$ccid" ] && docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$ccid" | grep -qw maung_edge; then NET=ok; ok "Caddy tersambung ke maung_edge"; else NET=FAIL; die "Caddy tidak tersambung ke maung_edge"; fi
  for i in $(seq 1 20); do compose exec -T caddy grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/sites/' /etc/caddy/Caddyfile 2>/dev/null && break; sleep 3; done
  if compose exec -T caddy grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/sites/' /etc/caddy/Caddyfile 2>/dev/null; then CADDY_IMPORT=yes; ok "Caddyfile di volume memuat import sites/*.caddy"; else CADDY_IMPORT=NO; die "baris import belum ada di Caddyfile"; fi
  NAPPS="$(compose exec -T caddy grep -Ec '^[[:space:]]*import[[:space:]]+/etc/caddy/apps/' /etc/caddy/Caddyfile 2>/dev/null | tr -d '\r')"
  [ "${NAPPS:-0}" -ge 2 ] && ok "import apps/*.caddy ada di $NAPPS blok situs" || die "import apps/*.caddy belum ada di blok situs (ditemukan: ${NAPPS:-0})"
  compose exec -T caddy ls /etc/caddy/sites /etc/caddy/apps >/dev/null 2>&1 && ok "/etc/caddy/sites dan /etc/caddy/apps terpasang di container Caddy" || die "/etc/caddy/sites atau /etc/caddy/apps tidak terpasang"
  if compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then CADDY_VALIDATE=ok; ok "caddy validate: konfigurasi sah"; else CADDY_VALIDATE=FAIL; die "caddy validate GAGAL"; fi
  grep -q "^$DOMAIN\b\|$DOMAIN {" <(compose exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null) && ok "blok domain $DOMAIN tetap ada (tidak diubah)" || warn "blok domain $DOMAIN tidak terlihat di Caddyfile — periksa"
fi

# ─────────────────────────────── [8/9] UJI AKSES ───────────────────────────
phase 8 "Uji akses HTTP/HTTPS"
if [ "$HAS_CADDY" = 1 ]; then
  HTTPS_CODE="$(curl -sk -o /dev/null -m 15 -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/branding" || echo 000)"
  LOGIN_CODE="$(curl -sk -o /dev/null -m 15 -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/login" || echo 000)"
  HTTP_CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/" || echo 000)"
  case "$HTTPS_CODE" in 200) ok "https://$DOMAIN/api/branding (API lewat web) → 200";; *) die "https://$DOMAIN/api/branding → $HTTPS_CODE";; esac
  case "$LOGIN_CODE" in 200) ok "https://$DOMAIN/login (halaman web) → 200";; *) die "https://$DOMAIN/login → $LOGIN_CODE";; esac
  case "$HTTP_CODE" in 200|301|302|308) ok "http://$DOMAIN/ → $HTTP_CODE";; *) die "http://$DOMAIN/ → $HTTP_CODE";; esac
  # jalur pemulihan :80 tanpa host tetap melayani
  IPC="$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1/ || echo 000)"; [ "$IPC" = 200 ] && ok "http://127.0.0.1/ (jalur pemulihan) → 200" || warn "http://127.0.0.1/ → $IPC"
else
  W="$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3000/ || echo 000)"; [ "$W" = 200 ] && ok "web :3000 → 200" || die "web :3000 → $W"
fi

# ─────────────────────────────── [9/10] SWA-UJI JALUR APLIKASI ──────────────
phase 9 "Swa-uji jalur aplikasi di domain WO (berkas sementara proxy/apps/_selftest.caddy)"
if [ "$HAS_CADDY" = 1 ]; then
  ST_FILE="$APP_DIR/proxy/apps/_selftest.caddy"; ST_BODY="$(mktemp)"
  cleanup_selftest() { rm -f "$ST_FILE" "$ST_BODY"; compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; }
  printf 'handle /_maung_selftest/* {\n\trespond "maung-ok" 200\n}\n' > "$ST_FILE"
  if compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    sleep 2
    ST_CODE="$(curl -sk -o "$ST_BODY" -m 15 -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/_maung_selftest/x" || echo 000)"
    if [ "$ST_CODE" = 200 ] && grep -q 'maung-ok' "$ST_BODY"; then SELFTEST=ok; ok "jalur aplikasi lewat berkas proxy/apps terbukti bekerja (200)"; else SELFTEST=FAIL; cleanup_selftest; die "swa-uji jalur aplikasi gagal (HTTP $ST_CODE)"; fi
    LOGIN_AFTER="$(curl -sk -o /dev/null -m 15 -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/login" || echo 000)"
    [ "$LOGIN_AFTER" = 200 ] && ok "halaman WO (/login) tetap 200 saat jalur aplikasi aktif" || { cleanup_selftest; die "WO terganggu oleh jalur aplikasi (/login → $LOGIN_AFTER)"; }
  else SELFTEST=FAIL; cleanup_selftest; die "caddy reload gagal saat swa-uji"; fi
  cleanup_selftest && ok "berkas swa-uji dihapus dan Caddy dimuat ulang" || warn "pembersihan swa-uji: periksa proxy/apps/"
  [ ! -e "$ST_FILE" ] && ok "proxy/apps bersih" || warn "berkas swa-uji masih ada: $ST_FILE"
else warn "dilewati (tanpa Caddy)"; fi

# ─────────────────────────────── [10/10] SELESAI ─────────────────────────────
phase 10 "Ringkasan"
STATUS=OK; REASON="-"
ok "selesai tanpa kesalahan"
cat <<'NOTE'

  Menambah aplikasi di jalur domain WO (mis. /crm): taruh proxy/apps/<nama>.caddy lalu
  docker compose -f docker-compose.yml -f docker-compose.caddy.yml exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  (caddy --watch tidak memantau berkas import). Panduan: docs/SUPER-APPS.md dan docs/INSTALL.md.
NOTE
result
