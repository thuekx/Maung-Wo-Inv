#!/usr/bin/env bash
# Maung-Wo-Inv — buat .env (secret acak), build & jalankan stack, lalu seed data awal.
# Pakai:  bash scripts/deploy.sh                       # akses via http://<ip-server>:3000
#         bash scripts/deploy.sh --host wo.contoh.co.id # akses via domain (tetap http, port 3000/4000)
#         bash scripts/deploy.sh --caddy wo.contoh.co.id api-wo.contoh.co.id   # HTTPS otomatis (Caddy)
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker belum terpasang. Jalankan scripts/install-server.sh dulu."; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose plugin tidak ada."; exit 1; }

HOST=""; WEB_DOMAIN=""; API_DOMAIN=""
case "${1:-}" in
  --host)  HOST="${2:?domain/IP}";;
  --caddy) WEB_DOMAIN="${2:?domain web}"; API_DOMAIN="${3:?domain api}";;
esac
[ -n "$HOST" ] || [ -n "$WEB_DOMAIN" ] || HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"; HOST="${HOST:-localhost}"

rand() { openssl rand -hex "$1"; }
setenv() { # setenv KEY VALUE  (ganti baris bila ada, tambah bila belum)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

if [ ! -f .env ]; then
  echo "==> Membuat .env dengan secret acak"
  cp .env.example .env
  setenv POSTGRES_PASSWORD "$(rand 16)"
  setenv JWT_SECRET "$(rand 32)"
  setenv TELEGRAM_WEBHOOK_SECRET "$(rand 16)"
  setenv BILLING_API_KEY "$(rand 24)"
  setenv BILLING_WEBHOOK_SECRET "$(rand 24)"
  setenv SEED_PASSWORD "$(rand 6)Aa1!"
  CREATED=1
fi

if [ -n "$WEB_DOMAIN" ]; then
  setenv WEB_URL "https://$WEB_DOMAIN"; setenv CORS_ORIGIN "https://$WEB_DOMAIN"; setenv NEXT_PUBLIC_API_URL "https://$API_DOMAIN"
  setenv WEB_DOMAIN "$WEB_DOMAIN"; setenv API_DOMAIN "$API_DOMAIN"
  FILES=(-f docker-compose.yml -f docker-compose.caddy.yml)
else
  setenv WEB_URL "http://$HOST:3000"; setenv CORS_ORIGIN "http://$HOST:3000"; setenv NEXT_PUBLIC_API_URL "http://$HOST:4000"
  FILES=(-f docker-compose.yml)
fi

echo "==> Build & start"
docker compose "${FILES[@]}" up -d --build
echo "==> Menunggu API siap"
for i in $(seq 1 40); do
  docker compose "${FILES[@]}" exec -T api wget -qO- http://localhost:4000/health >/dev/null 2>&1 && break || sleep 3
done
echo "==> Seed data awal (aman diulang)"
docker compose "${FILES[@]}" exec -T api node dist/prisma/seed.js

echo
echo "SELESAI."
echo "  Web      : $(grep ^WEB_URL= .env | cut -d= -f2-)"
echo "  Portainer: https://$HOST:9443 (buat admin dalam 5 menit pertama!)"
echo "  Login    : admin@l1v.local / $(grep ^SEED_PASSWORD= .env | cut -d= -f2-)   (ganti password setelah login)"
echo "  Secret tersimpan di .env (jangan di-commit)."
