#!/usr/bin/env bash
# Maung-Wo-Inv — buat .env (secret acak), build & jalankan stack, lalu seed data awal.
# Pakai:  bash scripts/deploy.sh                                   # akses via http://<ip-server>:3000 (tanpa SSL)
#         bash scripts/deploy.sh --host wo.contoh.co.id            # akses via nama host, tetap HTTP port 3000
#         bash scripts/deploy.sh --domain wo.contoh.co.id --email admin@contoh.co.id
#                                                                  # HTTPS Let's Encrypt otomatis (Caddy) — SATU domain untuk web+API
#         DEMO=1 bash scripts/deploy.sh                            # + data demo untuk uji (docs/DEMO.md)
#   (--caddy <domain> [domain-api] masih diterima = --domain; domain API tidak diperlukan lagi)
# Syarat mode --domain: DNS A record domain → IP publik server, port 80 & 443 terbuka (firewall OS + penyedia VPS).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker belum terpasang. Jalankan: sudo bash scripts/install-server.sh"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin tidak ada (butuh Compose v2.24+). Jalankan ulang scripts/install-server.sh"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Tidak bisa mengakses Docker (izin?). Coba: newgrp docker  — atau login ulang, atau jalankan dengan sudo."; exit 1; }

HOST=""; HOST_ARG=""; WEB_DOMAIN=""; ACME_EMAIL_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host)   HOST="${2:?nama host/IP}"; HOST_ARG=1; shift 2;;
    --domain|--caddy) WEB_DOMAIN="${2:?nama domain}"; shift 2; case "${1:-}" in ""|--*) ;; *) echo "Catatan: domain API terpisah tidak dipakai lagi (web & API satu domain) — argumen '$1' diabaikan."; shift;; esac;;
    --email)  ACME_EMAIL_ARG="${2:?alamat email}"; shift 2;;
    -h|--help) sed -n 2,11p "$0"; exit 0;;
    *) echo "Argumen tidak dikenal: $1 (lihat: bash scripts/deploy.sh --help)"; exit 1;;
  esac
done
WEB_DOMAIN="$(printf '%s' "$WEB_DOMAIN" | tr 'A-Z' 'a-z')"
[ -n "$HOST" ] || [ -n "$WEB_DOMAIN" ] || HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"; HOST="${HOST:-localhost}"

rand() { openssl rand -hex "$1"; }
setenv() { # setenv KEY VALUE  (ganti baris bila ada, tambah bila belum)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

if [ ! -f .env ]; then
  echo "==> Membuat .env dengan secret acak"
  cp .env.example .env
  chmod 600 .env   # berisi secret; hanya pemilik yang boleh baca
  setenv POSTGRES_PASSWORD "$(rand 16)"
  setenv JWT_SECRET "$(rand 32)"
  setenv TELEGRAM_WEBHOOK_SECRET "$(rand 16)"
  setenv EXPORT_API_KEY "$(rand 24)"
  setenv BILLING_API_KEY "$(rand 24)"
  setenv BILLING_WEBHOOK_SECRET "$(rand 24)"
  setenv SEED_PASSWORD "$(rand 6)Aa1!"
  CREATED=1
fi

chmod 600 .env   # juga untuk .env yang sudah ada

if [ -n "$WEB_DOMAIN" ]; then
  [[ "$WEB_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || { echo "Domain '$WEB_DOMAIN' tidak valid (contoh: wo.perusahaan.co.id). Let's Encrypt tidak melayani alamat IP."; exit 1; }
  # Pemeriksaan awal: DNS domain harus mengarah ke server ini, agar sertifikat dapat terbit
  PUBIP="$(curl -fsS -m 6 https://api.ipify.org 2>/dev/null || curl -fsS -m 6 https://ifconfig.me 2>/dev/null || true)"
  DNSIP="$(getent ahostsv4 "$WEB_DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
  echo "==> DNS $WEB_DOMAIN → ${DNSIP:-(belum terdeteksi)} | IP publik server: ${PUBIP:-(tidak terdeteksi)}"
  if [ -z "$DNSIP" ]; then echo "PERINGATAN: domain belum punya A record. Sertifikat tidak akan terbit sampai DNS diarahkan ke server (aplikasi tetap bisa dibuka lewat http://IP)."
  elif [ -n "$PUBIP" ] && [ "$DNSIP" != "$PUBIP" ]; then echo "PERINGATAN: DNS ($DNSIP) berbeda dengan IP publik server ($PUBIP). Bila memakai proxy/CDN (mis. Cloudflare oranye) atau NAT, pastikan 80/443 diteruskan ke server ini."; fi
  for port in 80 443; do
    if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$port[[:space:]]"; then echo "PERINGATAN: port $port sudah dipakai proses lain (mis. nginx/apache) — Caddy tidak bisa berjalan. Hentikan dulu: sudo systemctl disable --now nginx apache2"; fi
  done
  setenv WEB_URL "https://$WEB_DOMAIN"; setenv CORS_ORIGIN "https://$WEB_DOMAIN"; setenv NEXT_PUBLIC_API_URL ""
  setenv WEB_DOMAIN "$WEB_DOMAIN"
  [ -z "$ACME_EMAIL_ARG" ] || setenv ACME_EMAIL "$ACME_EMAIL_ARG"
  FILES=(-f docker-compose.yml -f docker-compose.caddy.yml)
else
  # Mode satu alamat: web meneruskan /api & /uploads ke container api (nama host docker) → tak ada IP/port API tertanam di build.
  # WEB_URL (tautan di notifikasi) hanya diisi bila belum ada / host diberikan eksplisit; bisa diubah juga di Admin → Tampilan.
  if [ -n "${CREATED:-}" ] || [ -n "$HOST_ARG" ] || ! grep -q '^WEB_URL=http' .env; then setenv WEB_URL "http://$HOST:3000"; fi
  setenv NEXT_PUBLIC_API_URL ""; setenv CORS_ORIGIN "$(grep ^WEB_URL= .env | cut -d= -f2-)"
  # Server yang sebelumnya memakai --domain tetap memakai Caddy bila WEB_DOMAIN masih ada di .env
  if grep -q '^WEB_DOMAIN=.\+' .env; then FILES=(-f docker-compose.yml -f docker-compose.caddy.yml); echo "==> WEB_DOMAIN terdeteksi di .env → tetap memakai Caddy/HTTPS"; else FILES=(-f docker-compose.yml); fi
fi

echo "==> Build & start (selama beberapa menit aplikasi bisa sementara menampilkan error 502/500 — normal saat container diganti; tunggu skrip selesai)"
docker compose "${FILES[@]}" up -d --build
echo "==> Menunggu API siap"
# Gate: lanjut hanya bila healthcheck container api (fetch /health via Node) berstatus healthy.
API_OK=0
for i in $(seq 1 60); do
  cid="$(docker compose "${FILES[@]}" ps -q api)"
  st="$([ -n "$cid" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"
  [ "$st" = healthy ] && { API_OK=1; break; }
  sleep 3
done
if [ "$API_OK" != 1 ]; then
  echo "GAGAL: API tidak healthy dalam 3 menit. Log terakhir:"
  docker compose "${FILES[@]}" logs --tail=40 migrate api
  exit 1
fi
echo "==> Seed data awal (aman diulang)"
docker compose "${FILES[@]}" exec -T api node dist/prisma/seed.js
if [ "${DEMO:-0}" = 1 ]; then
  echo "==> Data demo semua proses (lihat docs/DEMO.md)"
  docker compose "${FILES[@]}" exec -T api node dist/prisma/seed-demo.js
fi

echo
echo "SELESAI."
echo "  Web      : $(grep ^WEB_URL= .env | cut -d= -f2-)"
if [ -n "$WEB_DOMAIN" ]; then echo "  SSL      : Let's Encrypt diterbitkan otomatis beberapa saat setelah start (cek: docker compose logs -f caddy). Status & sakelar SSL: Admin → Pengaturan → SSL & Domain"; fi
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx portainer; then echo "  Portainer: https://${WEB_DOMAIN:-$HOST}:9443 (buat admin dalam 5 menit pertama! batasi port 9443 di firewall)"; fi
echo "  Login    : admin@l1v.local / $(grep ^SEED_PASSWORD= .env | cut -d= -f2-)   (ganti password setelah login)"
echo "  Secret tersimpan di .env (jangan di-commit)."
