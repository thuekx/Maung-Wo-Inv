#!/bin/sh
# Membuat Caddyfile awal dari templat (sekali), lalu menjalankan Caddy dengan --watch agar perubahan dari Admin dimuat otomatis.
set -e
# Caddyfile awal dibuat bila belum ada ATAU WEB_DOMAIN di .env berubah (deploy.sh --domain <domain-baru>)
if [ ! -s /etc/caddy/Caddyfile ] || [ "$(cat /etc/caddy/.web-domain 2>/dev/null)" != "${WEB_DOMAIN:-}" ]; then
  : "${WEB_DOMAIN:?WEB_DOMAIN kosong}"
  EMAIL_LINE=""
  [ -n "${ACME_EMAIL:-}" ] && EMAIL_LINE="email ${ACME_EMAIL}"
  sed -e "s|__DOMAIN__|${WEB_DOMAIN}|g" -e "s|__EMAIL_LINE__|${EMAIL_LINE}|" /init/Caddyfile.init > /etc/caddy/Caddyfile
  printf "%s" "${WEB_DOMAIN}" > /etc/caddy/.web-domain
  echo "Caddyfile awal dibuat untuk ${WEB_DOMAIN}"
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile --watch
