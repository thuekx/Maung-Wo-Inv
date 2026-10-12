#!/usr/bin/env bash
# MAUNG WO — pasang/ubah/hapus jalur aplikasi lain di domain WO (mis. /crm) lewat proxy/apps/<nama>.caddy.
# Berfase: guard → snapshot → validasi (aturan keamanan + `caddy validate` sungguhan di container sementara) → backup → pasang+reload → bukti → RESULT.
# Rollback otomatis bila gagal. Tidak membuat/menimpa/mengubah .env (diverifikasi checksum); tidak menyentuh container WO selain `caddy reload`.
#
# Pakai (dari ~/Maung-Wo-Inv, tanpa sudo):
#   bash scripts/app-route.sh add crm </dev/null            # sumber bawaan: ~/maung-crm/deploy/crm.caddy
#   bash scripts/app-route.sh add crm /jalur/ke/berkas.caddy </dev/null
#   bash scripts/app-route.sh remove crm </dev/null
#   bash scripts/app-route.sh status </dev/null              # baca-saja
# Aturan berkas .caddy (dicek otomatis): hanya blok `handle /<nama>[/...] { reverse_proxy <layanan>:<port> … }`; jalur WAJIB diawali /<nama>
# (nama = segmen jalur), upstream bukan layanan WO (web/api/worker/postgres/redis/caddy/localhost), tanpa import/file_server/respond/redir dsb.
set -uo pipefail

MODE="${1:-}"; NAME="${2:-}"; SRC_ARG="${3:-}"
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
APP_DIR="${APP_DIR:-$HOME/Maung-Wo-Inv}"
LOG_DIR="$HOME/maung-wo-logs"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/app-route-$TS.log"
BK_FILE="$LOG_DIR/app-route-apps-$TS.tgz"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2-alpine}"
CONF_VOL="${CONF_VOL:-maung-wo-inv_caddyconf}"
N=7
STATUS="FAIL"; REASON="-"; ROLLED="no"; INSTALLED=0; EXACT_ADDED=0
SHA_FILE="-"; V_VALIDATE="n/a"; V_RULES="n/a"; R_CODE="n/a"; V_LOGIN="n/a"; V_BRAND="n/a"; ENV_OK="n/a"; WO_CT="n/a"; HAD_OLD=0

banner() { printf '\n==================================================================\n  %s\n==================================================================\n' "$1"; }
phase()  { printf '\n[%s/%s] %s\n' "$1" "$N" "$2"; }
ok()     { printf '  ✓ %s\n' "$*"; }
warn()   { printf '  ! %s\n' "$*"; }
bad()    { printf '  ✗ %s\n' "$*"; }

result() {
  banner "RESULT"
  cat <<EOF
status=$STATUS
reason=$REASON
mode=${MODE:--}
name=${NAME:--}
host=$(hostname)
dir=$APP_DIR
source=${SRC:--}
file_sha256=$SHA_FILE
rules_check=$V_RULES
caddy_validate=$V_VALIDATE
route_http_status=$R_CODE
route_exact_http_status=${R_EXACT:-n/a}
wo_login_status=$V_LOGIN
wo_branding_status=$V_BRAND
env_unchanged=$ENV_OK
wo_containers_unchanged=$WO_CT
exact_block_added=$EXACT_ADDED
rolled_back=$ROLLED
backup_apps_dir=$BK_FILE
log_file=$LOG
rollback_cmd=cd $APP_DIR && rm -f proxy/apps/${NAME:-NAMA}.caddy && tar xzf $BK_FILE -C proxy/apps && docker compose -f docker-compose.yml -f docker-compose.caddy.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
EOF
  sleep 1
}

compose() { docker compose "${FILES[@]}" "$@"; }
reload_caddy() { compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; }
code() { curl -sk -o /dev/null -m 15 -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN$1" 2>/dev/null || echo 000; }
wo_ids() { docker ps -a --filter "label=com.docker.compose.project=maung-wo-inv" --format '{{.Names}} {{.ID}} {{.State}}' 2>/dev/null | sort; }

rollback() {
  [ "$INSTALLED" = 1 ] || return 0
  warn "ROLLBACK: mengembalikan proxy/apps ke keadaan sebelum perubahan"
  if [ "$HAD_OLD" = 1 ]; then cp -p "$OLD_COPY" "$TARGET" 2>/dev/null && ok "berkas lama dipulihkan"; else rm -f "$TARGET" && ok "berkas baru dihapus"; fi
  reload_caddy && ok "Caddy dimuat ulang dengan konfigurasi sebelumnya" || warn "reload Caddy gagal — coba: docker compose -f docker-compose.yml -f docker-compose.caddy.yml restart caddy"
  ROLLED="ya"
}
die() { REASON="$1"; bad "$1"; rollback; result; exit 1; }
abort() { STATUS=ABORT; REASON="$1"; bad "$1"; result; exit 2; }

# ─────────────────────────────── [1/7] GUARD ───────────────────────────────
banner "MAUNG WO — jalur aplikasi (${MODE:-?} ${NAME:-})  ($TS)"
phase 1 "Guard host, direktori, dan argumen"
case "$MODE" in add|remove|status) ok "mode: $MODE" ;; *) abort "mode tidak dikenal '$MODE' (pakai: add <nama> [berkas] | remove <nama> | status)" ;; esac
[ "$(hostname)" = "$EXPECT_HOST" ] || abort "host '$(hostname)' ≠ '$EXPECT_HOST' — dihentikan (bukan VM yang dituju)"
ok "host = $EXPECT_HOST"
[ "$(id -u)" != 0 ] || abort "jangan jalankan sebagai root/sudo (membuat file milik root di repo)"
ok "dijalankan sebagai $(id -un)"
[ -d "$APP_DIR/.git" ] || abort "$APP_DIR bukan repo git"
cd "$APP_DIR" || exit 2
git remote get-url origin 2>/dev/null | grep -qi 'thuekx/Maung-Wo-Inv' || abort "origin bukan thuekx/Maung-Wo-Inv"
ok "repo: $APP_DIR"
[ -f .env ] || abort ".env tidak ada — skrip ini TIDAK membuatnya"
grep -q '^WEB_DOMAIN=.\+' .env || abort "WEB_DOMAIN kosong di .env — jalur aplikasi hanya untuk mode Caddy/HTTPS"
DOMAIN="$(grep '^WEB_DOMAIN=' .env | head -1 | cut -d= -f2-)"
ok ".env ada (hanya dibaca); domain: $DOMAIN"
docker info >/dev/null 2>&1 || abort "tidak bisa mengakses Docker sebagai $(id -un) (jangan pakai sudo)"
ok "Docker dapat diakses"
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
exec > >(tee -a "$LOG") 2>&1
ok "log audit: $LOG"
FILES=(-f docker-compose.yml -f docker-compose.caddy.yml)
mkdir -p proxy/apps
if [ "$MODE" != status ]; then
  [[ "$NAME" =~ ^[a-z][a-z0-9-]{1,23}$ ]] || abort "nama '$NAME' tidak valid (huruf kecil/angka/strip, 2–24, diawali huruf; nama = segmen jalur, mis. crm → /crm)"
  case "$NAME" in api|uploads|login|reset-password|a|doc|qr-print|brand|_next|apps|admin|work-orders|customers|inventory|subscriptions|purchase-requests|purchase-orders|master|my-stock|tim-saya|laporan|riwayat-gangguan|api-msradius|api-sistem|api-kanca|profile|notifications|health) abort "nama '$NAME' dipakai halaman WO — pilih jalur lain" ;; esac
  ok "nama/jalur: $NAME → /$NAME"
  TARGET="proxy/apps/$NAME.caddy"
fi
SRC=""
if [ "$MODE" = add ]; then
  SRC="${SRC_ARG:-$HOME/maung-$NAME/deploy/$NAME.caddy}"
  [ -f "$SRC" ] && [ -r "$SRC" ] || abort "berkas sumber tidak ada/terbaca: $SRC (beri jalurnya sebagai argumen ke-3)"
  [ "$(wc -c < "$SRC")" -le 8192 ] || abort "berkas sumber > 8 KB — terlalu besar untuk berkas jalur"
  SHA_FILE="$(sha256sum "$SRC" | cut -d' ' -f1)"; ok "sumber: $SRC (sha256 ${SHA_FILE:0:12}…)"
fi

# ─────────────────────────────── [2/7] SNAPSHOT ────────────────────────────
phase 2 "Snapshot keadaan sebelum perubahan (baca-saja)"
ENV_SUM_BEFORE="$(sha256sum .env | cut -d' ' -f1)"; ok "checksum .env dicatat (isi tidak ditampilkan)"
WO_IDS_BEFORE="$(wo_ids)"; ok "container WO tercatat: $(printf '%s\n' "$WO_IDS_BEFORE" | grep -c .) buah"
CCID="$(compose ps -q caddy 2>/dev/null)"; [ -n "$CCID" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CCID" 2>/dev/null)" = true ] || abort "container Caddy tidak berjalan — jalankan scripts/update-safe.sh dulu"
ok "Caddy berjalan"
compose exec -T caddy grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/apps/' /etc/caddy/Caddyfile 2>/dev/null || abort "Caddyfile belum memuat import apps/*.caddy — jalankan scripts/update-safe.sh dulu (versi terbaru)"
ok "Caddyfile memuat import apps/*.caddy"
compose exec -T caddy ls /etc/caddy/apps >/dev/null 2>&1 || abort "/etc/caddy/apps tidak terpasang di container Caddy — jalankan scripts/update-safe.sh dulu"
ok "/etc/caddy/apps terpasang"
echo "  berkas jalur saat ini:"; ls -1 proxy/apps/*.caddy 2>/dev/null | sed 's/^/    • /' || true; [ -n "$(ls proxy/apps/*.caddy 2>/dev/null)" ] || echo "    (belum ada)"

if [ "$MODE" = status ]; then
  phase 3 "Status jalur (baca-saja)"
  for f in proxy/apps/*.caddy; do [ -e "$f" ] || continue; n="$(basename "$f" .caddy)"; echo "    /$n → HTTP $(code "/$n/")  ($(grep -Eo 'reverse_proxy +[^ {]+' "$f" | head -3 | tr '\n' ' '))"; done
  V_LOGIN="$(code /login)"; V_BRAND="$(code /api/branding)"; ok "WO: /login=$V_LOGIN /api/branding=$V_BRAND"
  STATUS=OK; result; exit 0
fi

# ─────────────────────────────── [3/7] VALIDASI ────────────────────────────
phase 3 "Validasi berkas (aturan keamanan + caddy validate sungguhan)"
if [ "$MODE" = add ]; then
  ERRS="$(awk -v name="$NAME" '
    BEGIN { depth = 0; bad = 0 }
    { line = $0; sub(/#.*/, "", line); gsub(/^[ \t]+|[ \t\r]+$/, "", line); if (line == "") next }
    function err(m) { printf "baris %d: %s\n", NR, m; bad = 1 }
    depth == 0 {
      if (line !~ /^handle[ \t]+\/[^ \t{]*[ \t]*\{$/) { err("di luar blok handle atau bentuk tidak diizinkan: " line); next }
      m = line; sub(/^handle[ \t]+/, "", m); sub(/[ \t]*\{$/, "", m)
      if (m != "/" name && m !~ "^/" name "(/|$)") err("jalur " m " harus diawali /" name)
      depth = 1; next
    }
    line == "}" { depth--; next }
    depth >= 1 {
      if (line ~ /^reverse_proxy[ \t]+/) {
        u = line; sub(/^reverse_proxy[ \t]+/, "", u); sub(/[ \t]*\{$/, "", u)
        if (u !~ /^[a-z0-9][a-z0-9-]*:[0-9][0-9][0-9]?[0-9]?[0-9]?$/) err("upstream harus <layanan>:<port>: " u)
        else { h = u; sub(/:.*/, "", h); if (h ~ /^(web|api|worker|postgres|redis|caddy|localhost)$/) err("upstream " h " adalah layanan WO/lokal — tidak diizinkan") }
        if (line ~ /\{$/) depth++
        next
      }
      if (line ~ /^(lb_try_duration|lb_try_interval|flush_interval)[ \t]+[0-9a-z.-]+$/) next
      if (line ~ /^request_body[ \t]*\{$/) { depth++; next }
      if (line ~ /^max_size[ \t]+[0-9]+[kKmMgG]?[bB]?$/) next
      err("direktif tidak diizinkan: " line)
    }
    END { if (depth != 0) { print "kurung kurawal tidak seimbang"; bad = 1 } ; if (!seen_handle_check) {} }
  ' "$SRC")"
  grep -Eq '^[[:space:]]*handle[[:space:]]+/' "$SRC" || ERRS="${ERRS}${ERRS:+$'\n'}tidak ada blok handle sama sekali"
  if [ -n "$ERRS" ]; then V_RULES=GAGAL; printf '%s\n' "$ERRS" | sed 's/^/    /'; die "berkas ditolak oleh aturan keamanan"; fi
  V_RULES=ok; ok "aturan keamanan lolos (hanya handle /$NAME → reverse_proxy ke layanan aplikasi)"
fi
# caddy validate di container sementara: Caddyfile aktif + semua berkas jalur (berkas ini menggantikan yang lama) — tanpa menyentuh konfigurasi hidup
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
for f in proxy/apps/*.caddy; do [ -e "$f" ] && [ "$(basename "$f" .caddy)" != "$NAME" ] && cp "$f" "$TMPD/"; done
AUG=""
if [ "$MODE" = add ]; then
  AUG="$TMPD/$NAME.caddy"; cp "$SRC" "$AUG"
  # Aplikasi Next.js ber-basePath menormalkan /<nama>/ → /<nama> (308). Tanpa blok tepat /<nama>, jalur itu jatuh ke 404 milik WO.
  # Bila berkas hanya punya `handle /<nama>/*`, tambahkan blok `handle /<nama>` dengan upstream yang sama.
  if ! grep -Eq "^[[:space:]]*handle[[:space:]]+/$NAME[[:space:]]*\{" "$SRC"; then
    UP="$(awk -v pat="/$NAME/*" '{ l=$0; sub(/#.*/,"",l); gsub(/^[ \t]+|[ \t\r]+$/,"",l) } l ~ /^handle[ \t]/ { m=l; sub(/^handle[ \t]+/,"",m); sub(/[ \t]*\{$/,"",m); cur=m } l ~ /^reverse_proxy[ \t]/ && cur==pat && !done { u=l; sub(/^reverse_proxy[ \t]+/,"",u); sub(/[ \t]*\{$/,"",u); print u; done=1 }' "$SRC")"
    if [ -n "$UP" ]; then printf '\n# jalur tepat /%s (Next.js mengalihkan /%s/ → /%s)\nhandle /%s {\n\treverse_proxy %s\n}\n' "$NAME" "$NAME" "$NAME" "$NAME" "$UP" >> "$AUG"; EXACT_ADDED=1; ok "ditambahkan blok 'handle /$NAME' (upstream $UP) — tanpa ini /$NAME polos akan 404"
    else warn "tidak ada 'handle /$NAME/*' untuk ditiru; blok /$NAME tepat tidak ditambahkan"; fi
  fi
fi
chmod 755 "$TMPD"; chmod 644 "$TMPD"/* 2>/dev/null || true
if docker run --rm -v "$CONF_VOL":/etc/caddy:ro -v "$TMPD":/etc/caddy/apps:ro -v "$APP_DIR/proxy/sites":/etc/caddy/sites:ro "$CADDY_IMAGE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then V_VALIDATE=ok; ok "caddy validate: konfigurasi (dengan perubahan) sah"; else V_VALIDATE=GAGAL; die "caddy validate GAGAL dengan berkas ini — konfigurasi hidup TIDAK diubah"; fi

# ─────────────────────────────── [4/7] BACKUP ──────────────────────────────
phase 4 "Backup proxy/apps"
tar czf "$BK_FILE" -C proxy/apps . && chmod 600 "$BK_FILE" && ok "backup: $BK_FILE" || die "backup proxy/apps gagal"
OLD_COPY="$LOG_DIR/app-route-old-$NAME-$TS.caddy"
if [ -f "$TARGET" ]; then HAD_OLD=1; cp -p "$TARGET" "$OLD_COPY"; ok "berkas lama /$NAME disimpan: $OLD_COPY"; else ok "belum ada berkas /$NAME (pemasangan baru)"; fi

# ─────────────────────────────── [5/7] PASANG ──────────────────────────────
phase 5 "Pasang & muat ulang Caddy"
INSTALLED=1
if [ "$MODE" = add ]; then
  { printf '# Dipasang oleh scripts/app-route.sh (%s) dari %s — sha256 %s\n' "$TS" "$SRC" "$SHA_FILE"; cat "$AUG"; } > "$TARGET" && chmod 644 "$TARGET" && ok "$TARGET ditulis" || die "gagal menulis $TARGET"
else
  [ -f "$TARGET" ] || { INSTALLED=0; abort "tidak ada $TARGET untuk dihapus"; }
  rm -f "$TARGET" && ok "$TARGET dihapus"
fi
reload_caddy && ok "caddy reload berhasil" || die "caddy reload GAGAL"
sleep 2

# ─────────────────────────────── [6/7] BUKTI ───────────────────────────────
phase 6 "Bukti terhadap sistem asli"
V_LOGIN="$(code /login)"; V_BRAND="$(code /api/branding)"
[ "$V_LOGIN" = 200 ] && [ "$V_BRAND" = 200 ] && ok "WO tidak terganggu: /login=200 /api/branding=200" || die "WO terganggu: /login=$V_LOGIN /api/branding=$V_BRAND"
if [ "$MODE" = add ]; then
  R_CODE="$(code "/$NAME/")"; R_EXACT="$(code "/$NAME")"
  [ "$R_EXACT" = 404 ] && die "jalur /$NAME (tanpa garis miring) → 404 milik WO: blok 'handle /$NAME' tidak berlaku"
  ok "jalur /$NAME (tanpa garis miring) → HTTP $R_EXACT (bukan 404 WO)"
  case "$R_CODE" in
    2??|3??|401|403) ok "jalur /$NAME/ aktif dan aplikasinya menjawab (HTTP $R_CODE)" ;;
    502|503|504) warn "jalur /$NAME/ AKTIF di Caddy tetapi aplikasinya belum menjawab (HTTP $R_CODE) — wajar bila container belum berjalan/sehat di jaringan maung_edge" ;;
    404) die "jalur /$NAME/ → 404 (halaman WO): berkas belum berlaku atau jalur tidak cocok" ;;
    *) die "jalur /$NAME/ → HTTP $R_CODE tidak terduga" ;;
  esac
  for pth in ${PROBE:-}; do echo "    probe $pth → $(code "$pth")"; done
else
  R_CODE="$(code "/$NAME/")"; [ "$R_CODE" = 404 ] && ok "jalur /$NAME/ sudah tidak dilayani (404 milik WO)" || warn "/$NAME/ → HTTP $R_CODE setelah dihapus"
fi
ENV_SUM_AFTER="$(sha256sum .env | cut -d' ' -f1)"
if [ "$ENV_SUM_BEFORE" = "$ENV_SUM_AFTER" ]; then ENV_OK=yes; ok ".env identik (checksum sama)"; else ENV_OK=NO; die ".env BERUBAH — hentikan dan periksa"; fi
if [ "$(wo_ids)" = "$WO_IDS_BEFORE" ]; then WO_CT=yes; ok "container WO sama (nama, ID, status) seperti sebelum perubahan"; else WO_CT=NO; die "daftar/status container WO berubah"; fi

# ─────────────────────────────── [7/7] SELESAI ─────────────────────────────
phase 7 "Ringkasan"
STATUS=OK; REASON="-"; INSTALLED=0
ok "selesai tanpa kesalahan"
if [ "$MODE" = add ]; then cat <<NOTE

  Berikutnya (urutan go-live): daftarkan aplikasi di Admin WO → Pengaturan → Aplikasi (Beranda) dengan ID '$NAME', jalur '/$NAME'
  ("Tampil di beranda" boleh MATI dulu) → Hak Akses (kelompok "Aplikasi") → baru nyalakan ikonnya. Lihat docs/SUPER-APPS.md.
NOTE
fi
result
