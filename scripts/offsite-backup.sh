#!/usr/bin/env bash
# MAUNG — backup harian ke luar VM: UGREEN NAS (SMB + restic, terenkripsi, bisa lewat Tailscale) atau TrueNAS (rsync + SSH).
# Isi satu set backup: dump semua database Postgres yang berjalan (WO, CRM, …), arsip volume *_uploads, arsip Garage (bila ada).
#
# Pemakaian (di VM, sebagai user biasa, BUKAN sudo):
#   bash scripts/offsite-backup.sh siapkan        # PANDUAN TANYA-JAWAB (disarankan): pilih NAS, isi data, uji, backup pertama, jadwal
#   bash scripts/offsite-backup.sh test           # uji koneksi ke NAS
#   bash scripts/offsite-backup.sh run            # buat backup lalu kirim (bawaan bila tanpa argumen)
#   bash scripts/offsite-backup.sh cron           # pasang jadwal harian 03:30 (crontab user, tanpa sudo)
#   bash scripts/offsite-backup.sh setup <host> <user> <folder> [port]   # TrueNAS tanpa tanya: simpan tujuan + kunci SSH
# Isian: ~/.maung-offsite.conf (bukan .env). Rahasia UGREEN: ~/.maung-offsite.d/ (chmod 600). Panduan: docs/BACKUP-NAS.md.
# UGREEN: semua alat berjalan sebagai container Docker (rclone = klien SMB + server REST untuk restic, restic, Tailscale bila perlu) —
# tidak perlu sudo, tidak memasang paket, tidak mengubah jaringan VM. Riwayat: restic forget 7 harian / 4 mingguan / 6 bulanan.
set -uo pipefail
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
CONF="${OFFSITE_CONF:-$HOME/.maung-offsite.conf}"; KEY="${OFFSITE_KEY:-$HOME/.ssh/maung_offsite_ed25519}"
SECD="${OFFSITE_SECRETS:-$HOME/.maung-offsite.d}"; RCLONE_ENV="$SECD/rclone.env"; RESTIC_PW="$SECD/restic.pass"
RCLONE_IMG=rclone/rclone:1.75.2; RESTIC_IMG=restic/restic:0.19.1; TS_IMG=tailscale/tailscale:v1.104.1   # versi dikunci; naikkan di sini lalu jalankan 'test'
NET=maung-offsite; RC=maung-offsite-rclone; TSC=maung-offsite-ts; TS_NAME=maung-apps-backup
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/maung-wo-logs"; STAGE_ROOT="$HOME/maung-offsite"; KEEP_LOCAL="${KEEP_LOCAL:-2}"
TS="$(date +%Y%m%d-%H%M%S)"; LOG="$LOG_DIR/offsite-backup-$TS.log"
MODE="${1:-run}"; STATUS=FAIL; REASON="-"; N=5; RTMP=""
V_DEST="-"; V_SET="-"; V_SIZE="-"; V_DB="-"; V_UP="-"; V_GARAGE="-"; V_VERIFY="-"; V_SNAP="-"
banner() { printf '\n==================================================================\n  %s\n==================================================================\n' "$1"; }
phase()  { printf '\n[%s/%s] %s\n' "$1" "$N" "$2"; }
ok()     { printf '  ✓ %s\n' "$*"; }
warn()   { printf '  ! %s\n' "$*"; }
bad()    { printf '  ✗ %s\n' "$*"; }
result() { banner "RESULT"; cat <<EOR
status=$STATUS
reason=$REASON
mode=$MODE
tujuan=$V_DEST
set=$V_SET
ukuran=$V_SIZE
database=$V_DB
uploads=$V_UP
garage=$V_GARAGE
snapshot=$V_SNAP
verifikasi=$V_VERIFY
log_file=$( [ -f "$LOG" ] && echo "$LOG" || echo - )
EOR
sleep 1; }
abort() { STATUS=ABORT; REASON="$1"; bad "$1"; result; exit 2; }
die()   { REASON="$1"; bad "$1"; [ -n "${SET:-}" ] && rm -rf "$SET" && warn "set tidak lengkap $SET dihapus (isi NAS tidak diubah)"; result; exit 1; }
cleanup() { docker rm -f "$RC" >/dev/null 2>&1 || true; [ -n "$RTMP" ] && rm -rf "$RTMP"; }

guard() {
  [ "$(hostname)" = "$EXPECT_HOST" ] || abort "host '$(hostname)' ≠ '$EXPECT_HOST' (bukan VM yang dituju)"
  [ "$(id -u)" != 0 ] || abort "jangan jalankan sebagai root/sudo"
}
need_ssh() { command -v ssh >/dev/null && command -v rsync >/dev/null || abort "ssh/rsync belum terpasang (sudo apt-get install -y rsync openssh-client)"; }
load_conf() {
  [ -f "$CONF" ] || abort "tujuan belum diatur — jalankan dulu: bash scripts/offsite-backup.sh siapkan"
  # shellcheck disable=SC1090
  . "$CONF"
  OFFSITE_KIND="${OFFSITE_KIND:-TRUENAS}"
  if [ "$OFFSITE_KIND" = UGREEN ]; then
    NASNAME="UGREEN NAS"
    [ -n "${OFFSITE_HOST:-}" ] && [ -n "${OFFSITE_SHARE:-}" ] && [ -n "${OFFSITE_USER:-}" ] || abort "$CONF tidak lengkap — jalankan siapkan lagi"
    [ -s "$RCLONE_ENV" ] && [ -s "$RESTIC_PW" ] || abort "rahasia di $SECD hilang — jalankan siapkan lagi"
    OFFSITE_FOLDER="${OFFSITE_FOLDER:-maung-restic}"; OFFSITE_PORT="${OFFSITE_PORT:-445}"; OFFSITE_VIA="${OFFSITE_VIA:-LANGSUNG}"
    REMOTE="NAS:$OFFSITE_SHARE/$OFFSITE_FOLDER"
    if [ "$OFFSITE_VIA" = TAILSCALE ]; then NETOPT=(--network "container:$TSC"); SERVE_ADDR=127.0.0.1:8000; REPO_URL="rest:http://127.0.0.1:8000/"
    else NETOPT=(--network "$NET"); SERVE_ADDR=:8000; REPO_URL="rest:http://$RC:8000/"; fi
    V_DEST="smb://$OFFSITE_USER@$OFFSITE_HOST/$OFFSITE_SHARE/$OFFSITE_FOLDER ($( [ "$OFFSITE_VIA" = TAILSCALE ] && echo "lewat Tailscale container" || echo langsung))"
  else
    NASNAME="TrueNAS"; need_ssh
    [ -n "${OFFSITE_HOST:-}" ] && [ -n "${OFFSITE_USER:-}" ] && [ -n "${OFFSITE_PATH:-}" ] || abort "$CONF tidak lengkap — jalankan siapkan lagi"
    OFFSITE_PORT="${OFFSITE_PORT:-22}"; V_DEST="$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_PATH (port $OFFSITE_PORT)"
    [ -f "$KEY" ] || abort "kunci SSH $KEY tidak ada — jalankan siapkan lagi"
    SSH_CMD="ssh -i $KEY -p $OFFSITE_PORT -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$HOME/.ssh/known_hosts_maung_offsite"
  fi
}

# ── alat UGREEN (container) ──
UIDGID="$(id -u):$(id -g)"
rclone_run() { docker run --rm -i --user "$UIDGID" -e HOME=/tmp --env-file "$RCLONE_ENV" "${NETOPT[@]}" "$RCLONE_IMG" "$@"; }
RVOL=()
restic_run() { docker run --rm -i --user "$UIDGID" -e HOME=/tmp -e RESTIC_REPOSITORY="$REPO_URL" -e RESTIC_PASSWORD_FILE=/run/restic.pass \
  -v "$RESTIC_PW":/run/restic.pass:ro "${RVOL[@]}" "${NETOPT[@]}" "$RESTIC_IMG" --no-cache "$@"; }
smb_hint() { case "$1" in
  *LOGON_FAILURE*|*[Ll]ogon*) echo "username/password SMB ditolak UGREEN";;
  *BAD_NETWORK_NAME*|*"Network Name Not Found"*|*"share name cannot be found"*) echo "shared folder '$OFFSITE_SHARE' tidak ditemukan (nama harus persis sama, termasuk huruf besar-kecil)";;
  *ACCESS_DENIED*|*"Access is denied"*|*"access denied"*|*"permission denied"*) echo "user $OFFSITE_USER tidak punya izin baca/tulis pada shared folder '$OFFSITE_SHARE'";;
  *timeout*|*refused*|*"no route"*|*unreachable*) echo "UGREEN port $OFFSITE_PORT tidak terjangkau ($1)";;
  *) echo "$1";; esac; }
ts_running() { docker exec "$TSC" tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'; }
ts_start() {  # container Tailscale khusus backup; jaringan tailnet hanya ada di dalam container ini, jaringan VM tidak berubah
  if docker inspect "$TSC" >/dev/null 2>&1; then
    if [ "$(docker inspect -f '{{.Config.Image}}' "$TSC" 2>/dev/null)" = "$TS_IMG" ]; then
      [ "$(docker inspect -f '{{.State.Running}}' "$TSC" 2>/dev/null)" = true ] && return 0
      docker start "$TSC" >/dev/null 2>&1; return; fi
    # versi Tailscale berganti → ganti container; login tetap (tersimpan di volume maung-offsite-ts)
    docker pull -q "$TS_IMG" >/dev/null 2>&1 || docker image inspect "$TS_IMG" >/dev/null 2>&1 || { TERR="gagal mengunduh $TS_IMG"; return 1; }
    docker rm -f "$TSC" >/dev/null 2>&1; TS_UPGRADED=1
  fi
  [ -c /dev/net/tun ] || { TERR="/dev/net/tun tidak ada di VM"; return 1; }
  docker run -d --name "$TSC" --restart unless-stopped --cap-add NET_ADMIN --cap-add NET_RAW --device /dev/net/tun \
    -v maung-offsite-ts:/var/lib/tailscale -e TS_STATE_DIR=/var/lib/tailscale -e TS_USERSPACE=false \
    -e TS_HOSTNAME="$TS_NAME" -e TS_AUTH_ONCE=true "$TS_IMG" >/dev/null 2>&1
}
ts_wait() { local i; for i in $(seq 1 "${1:-15}"); do ts_running && return 0; sleep 2; done; return 1; }
rest_up() {  # rclone menyajikan folder SMB sebagai repositori REST untuk restic
  docker rm -f "$RC" >/dev/null 2>&1
  [ "$OFFSITE_VIA" = TAILSCALE ] || docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null || return 1
  docker run -d --rm --name "$RC" --user "$UIDGID" -e HOME=/tmp --env-file "$RCLONE_ENV" "${NETOPT[@]}" "$RCLONE_IMG" \
    serve restic "$REMOTE" --addr "$SERVE_ADDR" >/dev/null || return 1
  local i; for i in $(seq 1 20); do docker logs "$RC" 2>&1 | grep -qiE 'serving restic|listening' && return 0
    docker inspect "$RC" >/dev/null 2>&1 || return 1; sleep 1; done; return 1
}

remote_ok() { # uji: NAS terjangkau & folder tujuan dapat ditulis
  if [ "$OFFSITE_KIND" = UGREEN ]; then
    for img in "$RCLONE_IMG" "$RESTIC_IMG"; do docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null 2>&1 || { RERR="gagal mengunduh image $img"; return 1; }; done
    if [ "$OFFSITE_VIA" = TAILSCALE ]; then
      ts_start || { RERR="container Tailscale gagal jalan: ${TERR:-$(docker logs --tail 3 "$TSC" 2>&1 | tr '\n' ' ')}"; return 1; }
      ts_wait 15 || { RERR="Tailscale backup belum login/terhubung — jalankan: bash scripts/offsite-backup.sh siapkan"; return 1; }
    elif ! timeout 6 bash -c "</dev/tcp/$OFFSITE_HOST/$OFFSITE_PORT" 2>/dev/null; then
      RERR="port $OFFSITE_PORT (SMB) di $OFFSITE_HOST tidak dapat dijangkau dari VM (IP salah, SMB UGREEN mati, atau hanya terjangkau lewat Tailscale)"; return 1; fi
    local e
    e="$(rclone_run mkdir "$REMOTE" 2>&1 >/dev/null)" || { RERR="$(smb_hint "$(printf '%s\n' "$e" | grep -v NOTICE | tail -n 2 | tr '\n' ' ')")"; return 1; }
    e="$(echo "maung $TS" | rclone_run rcat "$REMOTE/.maung-offsite-probe" 2>&1 >/dev/null)" || { RERR="$(smb_hint "$(printf '%s\n' "$e" | grep -v NOTICE | tail -n 2 | tr '\n' ' ')")"; return 1; }
    rclone_run deletefile "$REMOTE/.maung-offsite-probe" >/dev/null 2>&1
    return 0
  fi
  if ! timeout 6 bash -c "</dev/tcp/$OFFSITE_HOST/$OFFSITE_PORT" 2>/dev/null; then
    RERR="port $OFFSITE_PORT di $OFFSITE_HOST tidak dapat dijangkau dari VM (diblokir firewall/router, IP salah, atau layanan SSH TrueNAS mati)"; return 1; fi
  local probe; probe="$(mktemp -d)"; echo "maung $TS" > "$probe/.maung-offsite-probe"
  rsync -a -e "$SSH_CMD" "$probe/.maung-offsite-probe" "$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_PATH/" >/dev/null 2>"$probe/err"; local rc=$?
  RERR="$(grep -v '^rsync' "$probe/err" | grep -v '^[[:space:]]*$' | tail -n 4 | tr '\n' ' ')"; [ -n "$RERR" ] || RERR="$(tail -n 3 "$probe/err" | tr '\n' ' ')"
  rm -rf "$probe"; return $rc
}

case "$MODE" in
# ─────────────────────────── SIAPKAN (tanya-jawab) ───────────────────────────
siapkan)
  banner "MAUNG — persiapan backup ke NAS (tanya-jawab)"; guard
  { exec 3</dev/tty; } 2>/dev/null || abort "mode ini butuh terminal (jangan pakai </dev/null)"
  ask() { # ask "pertanyaan" "bawaan" → $REPLY
    local q="$1" d="${2:-}"; while :; do
      if [ -n "$d" ]; then printf '  ? %s [%s]: ' "$q" "$d"; else printf '  ? %s: ' "$q"; fi
      IFS= read -r REPLY <&3 || abort "input terputus"; REPLY="${REPLY#"${REPLY%%[![:space:]]*}"}"; REPLY="${REPLY%"${REPLY##*[![:space:]]}"}"
      [ -z "$REPLY" ] && REPLY="$d"; [ -n "$REPLY" ] && return 0; echo "    (wajib diisi)"; done; }
  yes_no() { ask "$1 (y/n)" "${2:-y}"; [[ "$REPLY" =~ ^[YyJj] ]]; }
  OLD_KIND=""; OLD_H=""; OLD_U=""; OLD_P=""; OLD_PORT=""; OLD_SHARE=""
  if [ -f "$CONF" ]; then . "$CONF"; OLD_KIND="${OFFSITE_KIND:-TRUENAS}"; OLD_H="${OFFSITE_HOST:-}"; OLD_U="${OFFSITE_USER:-}"; OLD_P="${OFFSITE_PATH:-}"; OLD_PORT="${OFFSITE_PORT:-}"; OLD_SHARE="${OFFSITE_SHARE:-}"
    echo "  Isian sebelumnya: $OLD_KIND $OLD_U@$OLD_H. Tekan Enter untuk memakai nilai di [kurung], atau ketik nilai baru."; fi
  echo; echo "  Tujuan backup:  1 = UGREEN NAS (SMB + restic terenkripsi)   2 = TrueNAS (SSH + rsync)"
  DK=1; [ "${OFFSITE_KIND:-}" = TRUENAS ] && DK=2
  while :; do ask "Pilih 1/2" "$DK"; case "$REPLY" in 1) KIND=UGREEN; break;; 2) KIND=TRUENAS; break;; esac; echo "    (ketik 1 atau 2)"; done
  [ "$KIND" != "$OLD_KIND" ] && { OLD_H=""; OLD_U=""; OLD_P=""; OLD_PORT=""; }   # NAS lain → jangan tawarkan isian NAS lama
  SUMMARY_EXTRA=""

  if [ "$KIND" = UGREEN ]; then
    docker info >/dev/null 2>&1 || abort "tidak bisa mengakses Docker"
    echo; echo "  Isi sesuai UGREEN Anda (docs/BACKUP-NAS.md bagian A). Bila UGREEN hanya terjangkau lewat Tailscale, isi IP Tailscale-nya (100.x.x.x)."
    while :; do ask "IP UGREEN (LAN atau Tailscale)" "$OLD_H"; H="$REPLY"; [[ "$H" =~ ^[A-Za-z0-9._:-]+$ ]] && break; echo "    (hanya huruf, angka, titik, minus, titik dua)"; done
    while :; do ask "Port SMB" "${OLD_PORT:-445}"; PORT="$REPLY"; [[ "$PORT" =~ ^[0-9]+$ ]] && break; echo "    (harus angka)"; done
    while :; do ask "Nama shared folder di UGREEN untuk backup" "${OLD_SHARE:-Maung_Backup}"; SHARE="$REPLY"; [[ "$SHARE" =~ ^[A-Za-z0-9._-]+$ ]] && break; echo "    (huruf, angka, titik, minus, garis bawah; tanpa spasi)"; done
    while :; do ask "Username UGREEN untuk backup" "${OLD_U:-maung_backup}"; U="$REPLY"; [[ "$U" =~ ^[A-Za-z0-9._-]+$ ]] && break; echo "    (huruf, angka, titik, minus, garis bawah)"; done
    ask_pw() { local p1 p2 keep=""; [ -s "$RCLONE_ENV" ] && [ "$U" = "$OLD_U" ] && [ "$H" = "$OLD_H" ] && keep=1
      while :; do
        printf '  ? Password user %s di UGREEN%s: ' "$U" "${keep:+ (Enter = pakai yang tersimpan)}"; IFS= read -rs p1 <&3 || abort "input terputus"; echo
        if [ -z "$p1" ] && [ -n "$keep" ]; then PW=""; return 0; fi
        [ -n "$p1" ] || { echo "    (wajib diisi)"; continue; }
        printf '  ? Ketik ulang password: '; IFS= read -rs p2 <&3 || abort "input terputus"; echo
        [ "$p1" = "$p2" ] && { PW="$p1"; return 0; }; echo "    (tidak sama, ulangi)"; done; }
    echo "  (Password diketik tersembunyi, tidak tampil dan tidak masuk chat. Disimpan tersamar di $RCLONE_ENV, hanya bisa dibaca user ini.)"
    ask_pw
    echo; ok "mengunduh alat backup (rclone, restic, alpine) — sekali saja"
    for img in "$RCLONE_IMG" "$RESTIC_IMG" alpine; do docker pull -q "$img" >/dev/null 2>&1 || docker image inspect "$img" >/dev/null 2>&1 || abort "gagal mengunduh image $img"; done
    save_ugreen() {  # tulis conf + rclone.env (password tersamar lewat rclone obscure)
      mkdir -p "$SECD" && chmod 700 "$SECD" || abort "gagal membuat $SECD"
      if [ -n "$PW" ]; then
        OBS="$(printf '%s' "$PW" | docker run --rm -i "$RCLONE_IMG" obscure - 2>/dev/null)" && [ -n "$OBS" ] || abort "gagal menyamarkan password (rclone obscure)"
      else OBS="$(sed -n 's/^RCLONE_CONFIG_NAS_PASS=//p' "$RCLONE_ENV")"; fi
      ( umask 077; printf 'RCLONE_CONFIG_NAS_TYPE=smb\nRCLONE_CONFIG_NAS_HOST=%s\nRCLONE_CONFIG_NAS_PORT=%s\nRCLONE_CONFIG_NAS_USER=%s\nRCLONE_CONFIG_NAS_PASS=%s\n' "$H" "$PORT" "$U" "$OBS" > "$RCLONE_ENV" )
      ( umask 077; printf 'OFFSITE_KIND=UGREEN\nOFFSITE_HOST=%s\nOFFSITE_PORT=%s\nOFFSITE_SHARE=%s\nOFFSITE_FOLDER=maung-restic\nOFFSITE_USER=%s\nOFFSITE_VIA=%s\n' "$H" "$PORT" "$SHARE" "$U" "$VIA" > "$CONF" )
      chmod 600 "$CONF" "$RCLONE_ENV"; }
    # jalur jaringan: langsung bila port SMB terjangkau dari VM, kalau tidak lewat Tailscale container
    if timeout 6 bash -c "</dev/tcp/$H/$PORT" 2>/dev/null; then VIA=LANGSUNG; ok "UGREEN $H:$PORT terjangkau langsung dari VM"
    else
      warn "UGREEN $H:$PORT tidak terjangkau langsung dari VM"
      echo "  Skrip bisa menjalankan Tailscale khusus backup di dalam container Docker '$TSC' (tanpa sudo; jaringan VM tidak berubah)."
      echo "  Anda cukup membuka satu link login Tailscale di HP/laptop dengan akun Tailscale yang sama dengan UGREEN."
      yes_no "Hubungkan lewat Tailscale container?" y || abort "dibatalkan: UGREEN tidak terjangkau dan Tailscale tidak dipakai (cek IP/SMB UGREEN, lalu jalankan siapkan lagi)"
      VIA=TAILSCALE
      docker pull -q "$TS_IMG" >/dev/null 2>&1 || docker image inspect "$TS_IMG" >/dev/null 2>&1 || abort "gagal mengunduh image $TS_IMG"
      ts_start || abort "container Tailscale gagal jalan: ${TERR:-$(docker logs --tail 3 "$TSC" 2>&1 | tr '\n' ' ')} (docs/BACKUP-NAS.md)"
      if ts_wait 5; then ok "Tailscale backup sudah terhubung"
      else
        echo "  Menunggu link login Tailscale (sampai 5 menit)…"; SHOWN=""
        for i in $(seq 1 150); do
          ts_running && break
          URL="$(docker logs "$TSC" 2>&1 | grep -oE 'https://login\.tailscale\.com/[A-Za-z0-9/._-]+' | tail -1)"
          if [ -n "$URL" ] && [ "$URL" != "$SHOWN" ]; then SHOWN="$URL"
            echo; echo "  ➜ Buka link ini di HP/laptop, login ke akun Tailscale yang sama dengan UGREEN, lalu klik Connect:"; echo; echo "      $URL"; echo; fi
          sleep 2; done
        ts_running || abort "Tailscale belum login setelah 5 menit — jalankan siapkan lagi (container tetap berjalan)"
      fi
      ok "Tailscale backup terhubung sebagai mesin '$TS_NAME' ($(docker exec "$TSC" tailscale ip -4 2>/dev/null | head -1))"
      echo "  Saran: di login.tailscale.com → Machines → $TS_NAME → ⋯ → Disable key expiry, agar tidak perlu login ulang tiap 180 hari."
    fi
    save_ugreen; ok "isian disimpan di $CONF"
    if [ -s "$RESTIC_PW" ]; then ok "password enkripsi backup sudah ada ($RESTIC_PW) — dipakai ulang"
    else
      ( umask 077; head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32 > "$RESTIC_PW" ); chmod 600 "$RESTIC_PW"
      [ "$(wc -c < "$RESTIC_PW")" = 32 ] || abort "gagal membuat password enkripsi"
      banner "PASSWORD ENKRIPSI BACKUP — CATAT SEKARANG"
      echo "  Semua backup di UGREEN dienkripsi dengan password ini. Bila VM rusak/hilang, backup HANYA bisa"
      echo "  dibuka dengan password ini. Simpan di password manager atau kertas di tempat aman (JANGAN kirim di chat)."
      echo; echo "      $(cat "$RESTIC_PW")"; echo
      while :; do ask "Ketik 'sudah' bila password di atas sudah dicatat" ""; [ "$REPLY" = sudah ] && break; done
      printf '\033[2J\033[H'; ok "password enkripsi tersimpan di $RESTIC_PW (layar dibersihkan)"
    fi
    SUMMARY_EXTRA="password_smb=tersimpan tersamar di $RCLONE_ENV
password_enkripsi=$RESTIC_PW (tampilkan lagi: cat $RESTIC_PW)"
    while :; do
      ask "Tekan Enter untuk uji koneksi (atau ketik 'batal')" "uji"
      [ "$REPLY" = batal ] && abort "dihentikan sebelum uji koneksi; isian sudah disimpan — jalankan lagi: bash scripts/offsite-backup.sh siapkan"
      OUT="$(bash "$0" test </dev/null 2>&1)"
      if printf '%s\n' "$OUT" | grep -q '^status=OK'; then ok "koneksi ke UGREEN berhasil (bisa menulis ke $SHARE)"; break; fi
      bad "uji koneksi gagal: $(printf '%s\n' "$OUT" | sed -n 's/^reason=//p')"
      echo "    Periksa (docs/BACKUP-NAS.md bagian 'Bila gagal'), lalu uji ulang."
      if yes_no "Isi ulang password user $U?" n; then OLD_U=""; ask_pw; save_ugreen; fi
    done
  else
    need_ssh
    echo; echo "  Isi sesuai TrueNAS Anda (docs/BACKUP-NAS.md bagian B). Tekan Enter untuk memakai nilai di [kurung]."
    while :; do ask "IP atau nama host TrueNAS (mis. 192.168.1.10)" "$OLD_H"; H="$REPLY"; [[ "$H" =~ ^[A-Za-z0-9._:-]+$ ]] && break; echo "    (hanya huruf, angka, titik, minus, titik dua)"; done
    while :; do ask "Port SSH TrueNAS" "${OLD_PORT:-22}"; PORT="$REPLY"; [[ "$PORT" =~ ^[0-9]+$ ]] && break; echo "    (harus angka)"; done
    while :; do ask "Username di TrueNAS untuk backup" "${OLD_U:-maung-backup}"; U="$REPLY"; [[ "$U" =~ ^[A-Za-z0-9._-]+$ ]] && break; echo "    (huruf, angka, titik, minus, garis bawah)"; done
    if [ -n "$OLD_P" ]; then DP="$OLD_P"; else ask "Nama pool TrueNAS (lihat menu Storage)" "tank"; DP="/mnt/$REPLY/maung-backup"; fi
    while :; do ask "Folder tujuan (dataset) di TrueNAS" "$DP"; P="$REPLY"; [[ "$P" == /* && "$P" =~ ^[A-Za-z0-9._/-]+$ ]] && break; echo "    (path absolut, mis. /mnt/tank/maung-backup)"; done
    echo; echo "  Ringkasan: host=$H  port=$PORT  user=$U  folder=$P"
    yes_no "Simpan isian ini?" y || abort "dibatalkan (tidak ada yang disimpan)"
    QUIET_RESULT=1 bash "$0" setup "$H" "$U" "$P" "$PORT" </dev/null
    [ -f "$CONF" ] && [ -f "$KEY.pub" ] || abort "penyimpanan isian/kunci gagal"
    echo; echo "  ➜ Tempel baris kunci publik di atas ke TrueNAS: Credentials → Users → $U → Edit → Authorized Keys → Save."
    while :; do
      ask "Sudah ditempel? Tekan Enter untuk uji koneksi (atau ketik 'batal')" "uji"
      [ "$REPLY" = batal ] && abort "dihentikan sebelum uji koneksi; isian sudah disimpan — jalankan lagi: bash scripts/offsite-backup.sh siapkan"
      OUT="$(bash "$0" test </dev/null 2>&1)"
      if printf '%s\n' "$OUT" | grep -q '^status=OK'; then ok "koneksi ke TrueNAS berhasil"; break; fi
      bad "uji koneksi gagal: $(printf '%s\n' "$OUT" | sed -n 's/^reason=//p')"
      echo "    Periksa lalu tekan Enter untuk uji ulang (docs/BACKUP-NAS.md bagian 'Bila gagal')."
    done
  fi
  if yes_no "Jalankan backup pertama sekarang?" y; then
    if bash "$0" run </dev/null; then RUN_OK=ya; else RUN_OK="GAGAL (lihat RESULT di atas)"; fi
  else RUN_OK="dilewati"; fi
  if yes_no "Pasang jadwal backup otomatis setiap hari jam 03:30?" y; then bash "$0" cron </dev/null | grep -E '^(status|reason)='; CRON_OK=ya; else CRON_OK="tidak"; fi
  banner "SELESAI — isian tercatat di $CONF"
  sed 's/^/  /' "$CONF"
  [ -n "$SUMMARY_EXTRA" ] && printf '%s\n' "$SUMMARY_EXTRA" | sed 's/^/  /'
  printf '  backup_pertama=%s\n  jadwal_harian=%s\n' "$RUN_OK" "$CRON_OK"
  echo "  Ubah isian kapan saja: cd ~/Maung-Wo-Inv && bash scripts/offsite-backup.sh siapkan"
  exit 0;;

# ─────────────────────────────── SETUP (TrueNAS, tanpa tanya) ───────────────────────────────
setup)
  N=2; banner "MAUNG — atur tujuan backup TrueNAS ($TS)"; phase 1 "Guard"; guard; need_ssh
  H="${2:-}"; U="${3:-}"; P="${4:-}"; PORT="${5:-22}"
  [ -n "$H" ] && [ -n "$U" ] && [ -n "$P" ] || abort "pakai: bash scripts/offsite-backup.sh setup <host/IP TrueNAS> <user> <folder, mis. /mnt/tank/maung-backup> [port] (UGREEN: pakai siapkan)"
  [[ "$P" == /* ]] || abort "folder harus path absolut (mis. /mnt/tank/maung-backup)"
  [[ "$PORT" =~ ^[0-9]+$ ]] || abort "port harus angka"
  for v in "$H" "$U" "$P"; do [[ "$v" =~ ^[A-Za-z0-9._/@:-]+$ ]] || abort "isian '$v' memuat karakter tidak diizinkan"; done
  umask 077; printf 'OFFSITE_KIND=TRUENAS\nOFFSITE_HOST=%s\nOFFSITE_USER=%s\nOFFSITE_PATH=%s\nOFFSITE_PORT=%s\n' "$H" "$U" "$P" "$PORT" > "$CONF"; chmod 600 "$CONF"
  ok "tujuan disimpan di $CONF"; V_DEST="$U@$H:$P (port $PORT)"
  phase 2 "Kunci SSH"
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  if [ -f "$KEY" ]; then ok "kunci sudah ada: $KEY (dipakai ulang)"; else ssh-keygen -q -t ed25519 -N '' -C "maung-backup@$(hostname)" -f "$KEY" </dev/null && ok "kunci baru dibuat: $KEY" || die "ssh-keygen gagal"; fi
  banner "KUNCI PUBLIK — tempel di TrueNAS (Credentials → Users → $U → Edit → Authorized Keys)"
  cat "$KEY.pub"
  echo "(Ini kunci PUBLIK, aman ditempel di TrueNAS/chat. Kunci privat $KEY tidak pernah ditampilkan.)"
  STATUS=OK; [ "${QUIET_RESULT:-0}" = 1 ] || result;;

# ─────────────────────────────── TEST ───────────────────────────────
test)
  N=1; banner "MAUNG — uji koneksi ke NAS ($TS)"; phase 1 "Koneksi"; guard; load_conf
  if remote_ok; then [ -n "${TS_UPGRADED:-}" ] && ok "Tailscale diperbarui ke $TS_IMG (login tetap)"
    [ "$OFFSITE_KIND" = UGREEN ] && ok "versi: $RCLONE_IMG, $RESTIC_IMG$( [ "$OFFSITE_VIA" = TAILSCALE ] && echo ", $(docker inspect -f '{{.Config.Image}}' "$TSC" 2>/dev/null)")"
    ok "$NASNAME terjangkau & dapat ditulis: $V_DEST"; STATUS=OK; V_VERIFY="koneksi OK"; result
  else die "gagal menulis ke $V_DEST: ${RERR:-tidak ada keterangan} — cek docs/BACKUP-NAS.md bagian 'Bila gagal'"; fi;;

# ─────────────────────────────── CRON ───────────────────────────────
cron)
  N=1; banner "MAUNG — pasang jadwal backup harian ($TS)"; phase 1 "Crontab"; guard; load_conf
  command -v crontab >/dev/null || abort "crontab tidak tersedia"
  LINE="30 3 * * * cd $APP_DIR && bash scripts/offsite-backup.sh run </dev/null >/dev/null 2>&1 # maung-offsite-backup"
  { crontab -l 2>/dev/null | grep -v '# maung-offsite-backup$'; echo "$LINE"; } | crontab - || die "crontab gagal dipasang"
  crontab -l 2>/dev/null | grep -q '# maung-offsite-backup$' && ok "terpasang: setiap hari 03:30 (setelah backup otomatis aplikasi 02:30)" || die "baris cron tidak ditemukan"
  ok "hasil tiap malam: ls -t ~/maung-wo-logs/offsite-backup-*.log | head -1 | xargs tail -n 15"
  STATUS=OK; V_VERIFY="cron 03:30"; result;;
run)
  banner "MAUNG — backup ke luar VM ($TS)"
  phase 1 "Guard"; guard; load_conf
  docker info >/dev/null 2>&1 || abort "tidak bisa mengakses Docker"
  mkdir -p "$LOG_DIR" "$STAGE_ROOT" && chmod 700 "$LOG_DIR" "$STAGE_ROOT"; exec > >(tee -a "$LOG") 2>&1
  ok "log: $LOG"
  trap cleanup EXIT; remote_ok || die "$NASNAME tidak dapat ditulis ($V_DEST): ${RERR:-?} — jalankan: bash scripts/offsite-backup.sh test"
  ok "$NASNAME dapat ditulis: $V_DEST"
  SET="$STAGE_ROOT/$TS"; mkdir -p "$SET" && chmod 700 "$SET"; V_SET="$TS"

  phase 2 "Database (pg_dumpall tiap container Postgres/PostGIS yang berjalan)"
  n=0
  while read -r c img; do
    [ -n "$c" ] || continue
    f="$SET/db-$c.sql.gz"
    docker exec "$c" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' 2>"$SET/.err" | gzip > "$f"
    if [ "${PIPESTATUS[0]}" = 0 ] && gzip -t "$f" 2>/dev/null && zcat "$f" | tail -n 5 | grep -q 'PostgreSQL database cluster dump complete'; then
      n=$((n+1)); ok "$c ($img) → $(basename "$f") ($(du -h "$f" | cut -f1))"
    else die "dump $c gagal: $(tail -n 2 "$SET/.err" | tr '\n' ' ')"; fi
  done < <(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /(^|\/)(postgres|postgis)([:@]|$)/')
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

  phase 5 "Kirim ke $NASNAME + verifikasi"
  ( cd "$SET" && sha256sum -- * > SHA256SUMS ) || die "checksum gagal"
  printf 'host=%s\ncommit_wo=%s\nwaktu=%s\n' "$(hostname)" "$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null)" "$TS" > "$SET/INFO.txt"
  V_SIZE="$(du -sh "$SET" | cut -f1)"
  if [ "$OFFSITE_KIND" = UGREEN ]; then
    rest_up || die "rclone serve restic gagal jalan: $(docker logs --tail 3 "$RC" 2>&1 | tr '\n' ' ')"
    RVOL=()
    if rclone_run lsf --files-only "$REMOTE/" 2>/dev/null | grep -qx config; then
      restic_run cat config >/dev/null 2>"$SET/.err" || die "repositori restic di UGREEN tidak bisa dibuka (password enkripsi berbeda?): $(tail -n 2 "$SET/.err" | tr '\n' ' ')"
    else
      restic_run init >/dev/null 2>"$SET/.err" && restic_run cat config >/dev/null 2>&1 || die "restic init gagal: $(tail -n 2 "$SET/.err" | tr '\n' ' ')"
      ok "repositori restic baru dibuat di $OFFSITE_SHARE/$OFFSITE_FOLDER (terenkripsi)"
    fi
    rm -f "$SET/.err"
    RVOL=(-v "$SET":/maung-backup:ro)
    BOUT="$(restic_run backup /maung-backup --host maung-apps --tag maung --json 2>&1)" || die "restic backup gagal: $(printf '%s\n' "$BOUT" | tail -n 2 | tr '\n' ' ')"
    SNAP="$(printf '%s\n' "$BOUT" | grep '"message_type":"summary"' | grep -o '"snapshot_id":"[0-9a-f]*"' | cut -d'"' -f4)"
    [ -n "$SNAP" ] || die "restic tidak melaporkan snapshot: $(printf '%s\n' "$BOUT" | tail -n 2 | tr '\n' ' ')"
    V_SNAP="${SNAP:0:8}"; ok "terkirim ke UGREEN sebagai snapshot $V_SNAP ($V_SIZE sebelum dedup/kompresi)"
    # verifikasi: pulihkan snapshot dari UGREEN ke folder sementara lalu cocokkan checksum tiap berkas
    RTMP="$(mktemp -d "$STAGE_ROOT/.pulih-XXXXXX")"; RVOL=(-v "$RTMP":/pulih)
    restic_run restore "$SNAP" --target /pulih >/dev/null 2>"$RTMP/.err" || die "uji pulih snapshot gagal: $(tail -n 2 "$RTMP/.err" | tr '\n' ' ')"
    ( cd "$RTMP/maung-backup" && sha256sum -c --quiet SHA256SUMS ) >/dev/null 2>&1 || die "isi hasil pulih dari UGREEN berbeda dengan aslinya (checksum)"
    rm -rf "$RTMP"; RTMP=""; RVOL=()
    ok "uji pulih: semua berkas dari UGREEN identik (checksum)"
    restic_run forget --host maung-apps --tag maung --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune >/dev/null 2>"$STAGE_ROOT/.err" \
      && ok "riwayat dirapikan: 7 harian, 4 mingguan, 6 bulanan" || warn "forget/prune gagal (backup hari ini tetap aman): $(tail -n 1 "$STAGE_ROOT/.err")"
    restic_run check >/dev/null 2>"$STAGE_ROOT/.err" || die "restic check menemukan masalah pada repositori: $(tail -n 2 "$STAGE_ROOT/.err" | tr '\n' ' ')"
    rm -f "$STAGE_ROOT/.err"
    NSNAP="$(restic_run snapshots --tag maung --json 2>/dev/null | grep -o '"short_id"' | wc -l)"
    V_VERIFY="uji pulih checksum OK, restic check OK"; ok "restic check OK; riwayat di UGREEN: $NSNAP snapshot"
    cleanup
  else
    rsync -a --delete --partial -e "$SSH_CMD" "$SET/" "$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_PATH/latest/" || die "rsync ke TrueNAS gagal"
    ok "terkirim ke $OFFSITE_PATH/latest/ ($V_SIZE)"
    DIFF="$(rsync -a --delete --checksum --dry-run --itemize-changes -e "$SSH_CMD" "$SET/" "$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_PATH/latest/" 2>&1)" || die "verifikasi rsync gagal"
    [ -z "$DIFF" ] && { V_VERIFY="isi di TrueNAS identik (checksum)"; ok "$V_VERIFY"; } || die "isi di TrueNAS berbeda setelah kirim: $(printf '%s' "$DIFF" | head -3 | tr '\n' ' ')"
  fi
  ls -1d "$STAGE_ROOT"/2*/ 2>/dev/null | sort | head -n -"$KEEP_LOCAL" | xargs -r rm -rf
  ok "salinan lokal disimpan $KEEP_LOCAL set terakhir di $STAGE_ROOT"
  STATUS=OK; result;;

*) echo "Mode tidak dikenal: $MODE (siapkan | test | run | cron | setup)"; exit 1;;
esac
