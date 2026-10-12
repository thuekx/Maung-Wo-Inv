#!/usr/bin/env bash
# Tes scripts/app-route.sh dengan docker/curl/hostname/id TIRUAN (tanpa Docker/Caddy asli). Jalankan: bash scripts/tests/app-route.test.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
t() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   - $1"; else FAIL=$((FAIL+1)); echo "  GAGAL - $1 (diharapkan '$3', dapat '$2')"; fi; }

SIM="$(mktemp -d)"; trap 'rm -rf "$SIM"' EXIT
mkdir -p "$SIM/bin" "$SIM/home/Maung-Wo-Inv/proxy/apps" "$SIM/home/Maung-Wo-Inv/proxy/sites" "$SIM/home/Maung-Wo-Inv/scripts"
R="$SIM/home/Maung-Wo-Inv"
cp "$ROOT/scripts/app-route.sh" "$R/scripts/"
( cd "$R" && git init -q . && git remote add origin https://github.com/thuekx/Maung-Wo-Inv.git && printf 'WEB_DOMAIN=wo.test.id\nSEED_PASSWORD=rahasia\n' > .env && : > docker-compose.yml && : > docker-compose.caddy.yml && touch proxy/apps/.gitkeep )
cat > "$SIM/bin/hostname" <<'EOF'
#!/bin/bash
echo maung-apps
EOF
cat > "$SIM/bin/id" <<'EOF'
#!/bin/bash
[ "$1" = "-u" ] && echo 1000 || echo ithero
EOF
cat > "$SIM/bin/curl" <<'EOF'
#!/bin/bash
url=""; for a in "$@"; do case "$a" in https://*|http://*) url="$a";; esac; done
case "$url" in
  */login) echo -n "${CODE_LOGIN:-200}";;
  */api/branding) echo -n "${CODE_BRAND:-200}";;
  */crm/|*/blog/) echo -n "${CODE_ROUTE:-200}";;
  */crm|*/blog) echo -n "${CODE_EXACT:-${CODE_ROUTE:-200}}";;
  *) echo -n 200;;
esac
EOF
cat > "$SIM/bin/docker" <<'EOF'
#!/bin/bash
a="$*"
case "$1" in
  info) exit 0;;
  inspect) echo true; exit 0;;
  ps) exit 0;;
  run) if [[ "$a" == *"caddy validate"* ]]; then echo "validate" >> "$SIMLOG"; [ "${VALIDATE_FAIL:-0}" = 1 ] && exit 1; fi; exit 0;;
  compose)
    [[ "$a" == *"ps -q"* ]] && { echo cid1; exit 0; }
    [[ "$a" == *"grep -Eq"* ]] && { [ "${NO_IMPORT:-0}" = 1 ] && exit 1; exit 0; }
    [[ "$a" == *"reload"* ]] && { echo reload >> "$SIMLOG"; [ "${RELOAD_FAIL:-0}" = 1 ] && exit 1; exit 0; }
    exit 0;;
esac
exit 0
EOF
chmod +x "$SIM/bin/"*
export SIMLOG="$SIM/log"
run() { : > "$SIMLOG"; ( cd /tmp && PATH="$SIM/bin:$PATH" HOME="$SIM/home" APP_DIR="$R" bash "$R/scripts/app-route.sh" "$@" </dev/null 2>&1 ); }
res() { printf '%s\n' "$1" | sed -n 's/^'"$2"'=//p' | head -1; }
nreload() { grep -c reload "$SIMLOG"; }

GOOD="$SIM/crm.caddy"
cat > "$GOOD" <<'EOF'
# CRM
handle /crm/api/* {
	reverse_proxy crm-api:4000
}
handle /crm/* {
	reverse_proxy crm-web:3000 {
		lb_try_duration 20s
		lb_try_interval 500ms
	}
}
EOF
ENV_BEFORE="$(sha256sum "$R/.env" | cut -d' ' -f1)"

echo "== 1. add berkas sah"
O="$(run add crm "$GOOD")"
t "status OK" "$(res "$O" status)" OK
t "berkas terpasang" "$([ -f "$R/proxy/apps/crm.caddy" ] && echo ya)" ya
t "berisi handle /crm/*" "$(grep -c 'handle /crm/\*' "$R/proxy/apps/crm.caddy")" 1
t "caddy validate dijalankan" "$(grep -c validate "$SIMLOG")" 1
t "reload sekali" "$(nreload)" 1
t "route status 200" "$(res "$O" route_http_status)" 200
t ".env tidak berubah" "$(res "$O" env_unchanged)" yes
t ".env checksum sama" "$(sha256sum "$R/.env" | cut -d' ' -f1)" "$ENV_BEFORE"

echo "== 1b. blok /crm tepat ditambahkan otomatis (Next.js: /crm/ → /crm)"
t "exact_block_added" "$(res "$O" exact_block_added)" 1
t "ada handle /crm {" "$(grep -cE '^handle /crm \{' "$R/proxy/apps/crm.caddy")" 1
t "upstream sama dgn /crm/*" "$(awk '/^handle \/crm \{/{f=1} f&&/reverse_proxy/{print $2; exit}' "$R/proxy/apps/crm.caddy")" "crm-web:3000"
t "route_exact_http_status 200" "$(res "$O" route_exact_http_status)" 200
O="$(run add crm "$GOOD")"; t "pasang ulang tetap satu blok /crm" "$(grep -cE '^handle /crm \{' "$R/proxy/apps/crm.caddy")" 1
WITH="$SIM/with.caddy"; printf 'handle /crm {\n\treverse_proxy crm-web:3000\n}\nhandle /crm/* {\n\treverse_proxy crm-web:3000\n}\n' > "$WITH"
O="$(run add crm "$WITH")"; t "berkas sudah punya /crm: tidak ditambah" "$(res "$O" exact_block_added)" 0
t "tetap satu blok /crm" "$(grep -cE '^handle /crm \{' "$R/proxy/apps/crm.caddy")" 1
O="$(CODE_EXACT=404 run add crm "$GOOD")"; t "/crm tepat 404 → FAIL" "$(res "$O" status)" FAIL
t "rollback" "$(res "$O" rolled_back)" ya
rm -f "$R/proxy/apps/crm.caddy"

echo "== 2. aplikasi mati (502) = tetap terpasang dengan peringatan"
O="$(run add crm "$GOOD")"; CODE_ROUTE=502 O="$(CODE_ROUTE=502 run add crm "$GOOD")"
t "502 tetap OK" "$(res "$O" status)" OK
t "route 502 dicatat" "$(res "$O" route_http_status)" 502

echo "== 3. berkas ditolak aturan (tanpa perubahan apa pun)"
rm -f "$R/proxy/apps/crm.caddy"
bad_case() { # nama isi
  printf '%s\n' "$2" > "$SIM/bad.caddy"; O="$(run add crm "$SIM/bad.caddy")"
  t "$1: ditolak" "$(res "$O" status)" FAIL
  t "$1: rules_check GAGAL" "$(res "$O" rules_check)" GAGAL
  t "$1: tidak ada berkas terpasang" "$(ls "$R/proxy/apps" | grep -c caddy)" 0
  t "$1: tidak ada reload" "$(nreload)" 0
}
bad_case "respond" $'handle /crm/* {\n\trespond "hai" 200\n}'
bad_case "jalur bukan /crm" $'handle /lain/* {\n\treverse_proxy crm-web:3000\n}'
bad_case "upstream layanan WO" $'handle /crm/* {\n\treverse_proxy web:3000\n}'
bad_case "upstream api WO" $'handle /crm/* {\n\treverse_proxy api:4000\n}'
bad_case "import" $'import /etc/caddy/Caddyfile\nhandle /crm/* {\n\treverse_proxy crm-web:3000\n}'
bad_case "di luar handle" $'reverse_proxy crm-web:3000'
bad_case "jalur root /*" $'handle /* {\n\treverse_proxy crm-web:3000\n}'
bad_case "file_server" $'handle /crm/* {\n\tfile_server\n}'
bad_case "kurung tak seimbang" $'handle /crm/* {\n\treverse_proxy crm-web:3000'

echo "== 4. caddy validate gagal = konfigurasi hidup tidak disentuh"
O="$(VALIDATE_FAIL=1 run add crm "$GOOD")"
t "ditolak" "$(res "$O" status)" FAIL
t "caddy_validate GAGAL" "$(res "$O" caddy_validate)" GAGAL
t "tidak ada berkas" "$(ls "$R/proxy/apps" | grep -c caddy)" 0
t "tidak ada reload" "$(nreload)" 0

echo "== 5. jalur 404 setelah pasang = rollback"
O="$(CODE_ROUTE=404 run add crm "$GOOD")"
t "FAIL" "$(res "$O" status)" FAIL
t "rolled_back ya" "$(res "$O" rolled_back)" ya
t "berkas dihapus lagi" "$(ls "$R/proxy/apps" | grep -c caddy)" 0
t "reload 2x (pasang + rollback)" "$(nreload)" 2

echo "== 6. WO terganggu setelah pasang = rollback; berkas lama dipulihkan"
printf '# lama\nhandle /crm/* {\n\treverse_proxy crm-web:3001\n}\n' > "$R/proxy/apps/crm.caddy"; OLD_SUM="$(sha256sum "$R/proxy/apps/crm.caddy" | cut -d' ' -f1)"
O="$(CODE_LOGIN=500 run add crm "$GOOD")"
t "FAIL" "$(res "$O" status)" FAIL
t "rolled_back ya" "$(res "$O" rolled_back)" ya
t "berkas lama dipulihkan" "$(sha256sum "$R/proxy/apps/crm.caddy" | cut -d' ' -f1)" "$OLD_SUM"

echo "== 7. reload gagal = rollback"
O="$(RELOAD_FAIL=1 run add crm "$GOOD")"
t "FAIL" "$(res "$O" status)" FAIL
t "berkas lama kembali" "$(sha256sum "$R/proxy/apps/crm.caddy" | cut -d' ' -f1)" "$OLD_SUM"

echo "== 8. prasyarat: Caddyfile belum ber-import = ABORT"
O="$(NO_IMPORT=1 run add crm "$GOOD")"
t "ABORT" "$(res "$O" status)" ABORT

echo "== 9. remove"
O="$(CODE_ROUTE=404 run remove crm)"
t "OK" "$(res "$O" status)" OK
t "berkas terhapus" "$(ls "$R/proxy/apps" | grep -c caddy)" 0

echo "== 10. guard: host salah / nama dilarang / berkas hilang / status"
O="$(EXPECT_HOST=lain run add crm "$GOOD")"; t "host salah → ABORT" "$(res "$O" status)" ABORT
O="$(run add admin "$GOOD")"; t "nama terlarang → ABORT" "$(res "$O" status)" ABORT
O="$(run add crm "$SIM/tidak-ada.caddy")"; t "berkas hilang → ABORT" "$(res "$O" status)" ABORT
O="$(run status)"; t "status OK" "$(res "$O" status)" OK
t ".env tidak pernah berubah" "$(sha256sum "$R/.env" | cut -d' ' -f1)" "$ENV_BEFORE"

echo; echo "Hasil: $PASS lulus, $FAIL gagal"; [ "$FAIL" = 0 ]
