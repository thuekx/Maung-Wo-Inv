#!/bin/sh
# Membuat Caddyfile awal dari templat (sekali), lalu menjalankan Caddy dengan --watch agar perubahan dari Admin dimuat otomatis.
# CADDY_DIR / INIT_FILE / CADDY_NO_RUN hanya untuk pengujian (default: /etc/caddy, /init/Caddyfile.init, jalankan Caddy).
set -e
CADDY_DIR="${CADDY_DIR:-/etc/caddy}"
INIT_FILE="${INIT_FILE:-/init/Caddyfile.init}"
IMPORT_LINE='import /etc/caddy/sites/*.caddy'
# Caddyfile awal dibuat bila belum ada ATAU WEB_DOMAIN di .env berubah (deploy.sh --domain <domain-baru>)
if [ ! -s "$CADDY_DIR/Caddyfile" ] || [ "$(cat "$CADDY_DIR/.web-domain" 2>/dev/null)" != "${WEB_DOMAIN:-}" ]; then
  : "${WEB_DOMAIN:?WEB_DOMAIN kosong}"
  EMAIL_LINE=""
  [ -n "${ACME_EMAIL:-}" ] && EMAIL_LINE="email ${ACME_EMAIL}"
  sed -e "s|__DOMAIN__|${WEB_DOMAIN}|g" -e "s|__EMAIL_LINE__|${EMAIL_LINE}|" "$INIT_FILE" > "$CADDY_DIR/Caddyfile"
  printf "%s" "${WEB_DOMAIN}" > "$CADDY_DIR/.web-domain"
  echo "Caddyfile awal dibuat untuk ${WEB_DOMAIN}"
fi
# Migrasi: Caddyfile lama di volume belum punya baris import → sisipkan di level atas SETELAH blok global (bila ada).
# Hanya menambah satu baris; domain, sertifikat, dan isi lain tidak diubah.
if ! grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/sites/' "$CADDY_DIR/Caddyfile"; then
  awk -v imp="$IMPORT_LINE" '
    BEGIN { st = 0 }  # 0 = belum melihat apa pun, 1 = di dalam blok global, 2 = selesai
    st == 0 && /^[[:space:]]*(#.*)?$/ { print; next }
    st == 0 && /^\{[[:space:]]*$/ { st = 1; print; next }
    st == 0 { print imp; print ""; st = 2; print; next }
    st == 1 && /^\}[[:space:]]*$/ { print; print ""; print imp; st = 2; next }
    { print }
    END { if (st == 0) print imp }
  ' "$CADDY_DIR/Caddyfile" > "$CADDY_DIR/Caddyfile.new" && cat "$CADDY_DIR/Caddyfile.new" > "$CADDY_DIR/Caddyfile" && rm -f "$CADDY_DIR/Caddyfile.new"
  echo "Caddyfile lama dimigrasi: baris import sites/*.caddy ditambahkan"
fi
# Migrasi 2: aplikasi di jalur domain WO (proxy/apps) — sisipkan import di DALAM tiap blok situs tingkat atas (bukan blok global).
APPS_LINE='import /etc/caddy/apps/*.caddy'
if ! grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/apps/' "$CADDY_DIR/Caddyfile"; then
  awk -v imp="$APPS_LINE" '
    { n_open = gsub(/\{/, "{"); n_close = gsub(/\}/, "}") }
    depth == 0 && /\{[[:space:]]*$/ && !/^[[:space:]]*\{[[:space:]]*$/ { print; print "\t" imp; depth += n_open - n_close; next }
    { print; depth += n_open - n_close }
  ' "$CADDY_DIR/Caddyfile" > "$CADDY_DIR/Caddyfile.new" && cat "$CADDY_DIR/Caddyfile.new" > "$CADDY_DIR/Caddyfile" && rm -f "$CADDY_DIR/Caddyfile.new"
  echo "Caddyfile lama dimigrasi: baris import apps/*.caddy ditambahkan di tiap blok situs"
fi
[ -z "${CADDY_NO_RUN:-}" ] || exit 0
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile --watch
