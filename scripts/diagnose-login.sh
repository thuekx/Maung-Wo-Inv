#!/usr/bin/env bash
# MAUNG WO — diagnosis "Load failed" saat login (BACA-SAJA: tidak mengubah apa pun, tidak mencetak secret).
# Jalankan:  cd ~/Maung-Wo-Inv && bash scripts/diagnose-login.sh </dev/null
# Menguji dari dalam VM: kondisi container, log galat, jalur login lewat Caddy→web→api (HTTP/1.1 dan HTTP/2), dan pendengar port 443.
set -uo pipefail
APP_DIR="${APP_DIR:-$HOME/Maung-Wo-Inv}"
LOG_DIR="$HOME/maung-wo-logs"; TS="$(date +%Y%m%d-%H%M%S)"; LOG="$LOG_DIR/diagnose-login-$TS.log"
N=5
banner() { printf '\n==================================================================\n  %s\n==================================================================\n' "$1"; }
phase()  { printf '\n[%s/%s] %s\n' "$1" "$N" "$2"; }
ok()     { printf '  ✓ %s\n' "$*"; }
warn()   { printf '  ! %s\n' "$*"; }
bad()    { printf '  ✗ %s\n' "$*"; }
mask()   { sed -E 's#(://[^:/@ ]+:)[^@ ]+@#\1***@#g; s/((secret|password|token|passwd|key)[A-Za-z_]*[=:] *)[^ ,"]+/\1***/Ig; s/(Bearer )[A-Za-z0-9._-]+/\1***/g'; }

banner "MAUNG WO — diagnosis login ($TS)"
[ -d "$APP_DIR/.git" ] || { echo "✗ $APP_DIR bukan repo git"; exit 2; }
[ "$(id -u)" != 0 ] || { echo "✗ jangan jalankan sebagai root"; exit 2; }
cd "$APP_DIR" || exit 2
docker info >/dev/null 2>&1 || { echo "✗ tidak bisa mengakses Docker (jangan pakai sudo)"; exit 2; }
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"; exec > >(tee -a "$LOG") 2>&1
DOMAIN="$(grep '^WEB_DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2-)"
if [ -n "$DOMAIN" ]; then FILES=(-f docker-compose.yml -f docker-compose.caddy.yml); else FILES=(-f docker-compose.yml); fi
compose() { docker compose "${FILES[@]}" "$@"; }
COMMIT="$(git rev-parse --short HEAD)"; echo "commit di server: $COMMIT | domain: ${DOMAIN:-(tanpa domain)}"
FAILS=0; V_API="n/a"; V_WEB="n/a"; V_H1="n/a"; V_H2="n/a"; V_PAGE="n/a"; V_BRAND="n/a"; V_RESTARTS="n/a"; V_UDP="n/a"; V_VALIDATE="n/a"

phase 1 "Kondisi container (status, kesehatan, jumlah restart)"
compose ps -a --format 'table {{.Service}}\t{{.Status}}' 2>&1 | sed 's/^/  /'
MAXR=0
for s in api web worker caddy postgres redis; do
  c="$(compose ps -aq "$s" 2>/dev/null | head -1)"; [ -n "$c" ] || continue
  r="$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null || echo 0)"; st="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" 2>/dev/null)"
  echo "  $s: $st restart=$r"; [ "${r:-0}" -gt "$MAXR" ] && MAXR="$r"
  [ "$s" = api ] && V_API="$st"; [ "$s" = web ] && V_WEB="$st"
done
V_RESTARTS="$MAXR"; [ "$MAXR" -gt 2 ] && { warn "ada container yang restart berulang ($MAXR kali) — lihat log di bawah"; FAILS=$((FAILS+1)); } || ok "tidak ada restart berulang"

phase 2 "Log galat terbaru (secret disamarkan)"
for s in api web caddy; do echo "  ── $s (galat/peringatan terakhir) ──"; compose logs --no-color --tail 200 "$s" 2>&1 | mask | grep -Ei 'error|fail|fatal|panic|refused|reset|timeout|EADDR|ECONN|socket|unhandled|invalid|tls|certificate' | tail -8 | sed 's/^/    /'; done

phase 3 "Uji jalur login dari dalam VM (Caddy → web → api), tanpa kredensial asli"
if [ -n "$DOMAIN" ]; then BASE="https://$DOMAIN"; RES=(--resolve "$DOMAIN:443:127.0.0.1" -k); else BASE="http://127.0.0.1:3000"; RES=(); fi
t() { # t <label> <curl args...>  → "kode waktu"
  curl -s -o /tmp/dl.body -m 20 -w '%{http_code} %{time_total}s' "${RES[@]}" "$@" 2>/dev/null || echo "000 -"; }
V_PAGE="$(t "$BASE/login")"; echo "  GET  /login                → $V_PAGE"
V_BRAND="$(t "$BASE/api/branding")"; echo "  GET  /api/branding         → $V_BRAND"
V_H1="$(t --http1.1 -XPOST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"email":"diagnosa@tidak.ada","password":"x"}')"; echo "  POST /api/auth/login HTTP/1.1 → $V_H1  (diharapkan 401)"
V_H2="$(t --http2 -XPOST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"email":"diagnosa@tidak.ada","password":"x"}')"; echo "  POST /api/auth/login HTTP/2   → $V_H2  (diharapkan 401)"
[ -s /tmp/dl.body ] && echo "  isi jawaban: $(head -c 120 /tmp/dl.body | mask)"
for v in "$V_H1" "$V_H2"; do case "${v%% *}" in 401) ;; *) FAILS=$((FAILS+1));; esac; done
case "${V_PAGE%% *}" in 200) ok "halaman login 200";; *) bad "halaman login ${V_PAGE%% *}"; FAILS=$((FAILS+1));; esac

phase 4 "Caddy: konfigurasi dan pendengar port"
if [ -n "$DOMAIN" ]; then
  if compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then V_VALIDATE=ok; ok "caddy validate: sah"; else V_VALIDATE=GAGAL; bad "caddy validate GAGAL"; FAILS=$((FAILS+1)); fi
  echo "  Caddyfile aktif (hanya struktur, tanpa email/rahasia):"; compose exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | grep -vE '^\s*(email|#)' | sed 's/^/    /' | head -50
fi
echo "  pendengar 80/443:"; (ss -lntu 2>/dev/null | grep -E ':(80|443)\b' || echo "    (tidak terbaca)") | sed 's/^/    /'
ss -lnu 2>/dev/null | grep -q ':443\b' && V_UDP="udp443-ada" || V_UDP="udp443-tidak-ada"
echo "  firewall (ufw):"; (ufw status 2>/dev/null | head -12 || echo "    (ufw tidak terbaca tanpa sudo)") | sed 's/^/    /'

phase 5 "Ringkasan"
if [ "$FAILS" = 0 ]; then ok "dari dalam VM semua normal — kemungkinan besar masalah ada di sisi jaringan/peramban pengguna (lihat saran di bawah)"; else bad "$FAILS temuan — kirim blok RESULT ini"; fi
cat <<'NOTE'

  Saran bila VM normal tetapi ponsel "Load failed":
   1) Coba di jaringan lain (Wi-Fi vs data seluler) dan peramban lain (Chrome iOS) — membedakan masalah jaringan vs Safari.
   2) iOS: matikan sementara iCloud Private Relay (Pengaturan > [nama] > iCloud > Relay Pribadi) dan "Mode Data Rendah".
   3) Safari: Pengaturan > Safari > Lanjutan > Data Situs Web > hapus maung.liv.net.id, lalu muat ulang.
   4) Buka https://DOMAIN/api/branding di ponsel: bila tampil JSON, API terjangkau dan masalahnya khusus metode POST.
NOTE
banner "RESULT"
cat <<EOF
status=$([ "$FAILS" = 0 ] && echo NORMAL_DI_VM || echo ADA_TEMUAN)
commit=$COMMIT
domain=${DOMAIN:--}
api=$V_API
web=$V_WEB
max_restart=$V_RESTARTS
get_login=$V_PAGE
get_branding=$V_BRAND
post_login_http1=$V_H1
post_login_http2=$V_H2
caddy_validate=$V_VALIDATE
udp443=$V_UDP
log_file=$LOG
EOF
sleep 1
