#!/usr/bin/env bash
# Diagnosis cepat stack Maung: status container, log terakhir, mode (.env tanpa nilai rahasia), disk & memori.
# Pakai (di folder repo, sebagai user yang ada di grup docker):  bash scripts/diagnose.sh
# Hasilnya aman dibagikan: tidak mencetak password/secret.
cd "$(dirname "$0")/.." || exit 1
FILES=(-f docker-compose.yml)
grep -q '^WEB_DOMAIN=.\+' .env 2>/dev/null && FILES=(-f docker-compose.yml -f docker-compose.caddy.yml)
hr() { printf '\n===== %s =====\n' "$1"; }
hr "Mode (.env — hanya kunci non-rahasia)"
grep -E '^(WEB_URL|CORS_ORIGIN|NEXT_PUBLIC_API_URL|WEB_DOMAIN|ACME_EMAIL)=' .env 2>/dev/null || echo ".env tidak ditemukan"
echo "compose files: ${FILES[*]}"
hr "Versi kode"; git log --oneline -3 2>/dev/null
hr "Status container"; docker compose "${FILES[@]}" ps -a 2>&1
hr "Kesehatan API (dari dalam container)"
docker compose "${FILES[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/health').then(r=>r.text()).then(console.log,e=>console.log('GAGAL',e.message))" 2>&1 | head -3
hr "Log migrate (40 baris)"; docker compose "${FILES[@]}" logs --no-color --tail=40 migrate 2>&1
hr "Log api (40 baris)";     docker compose "${FILES[@]}" logs --no-color --tail=40 api 2>&1
hr "Log web (25 baris)";     docker compose "${FILES[@]}" logs --no-color --tail=25 web 2>&1
if [ "${FILES[*]}" != "-f docker-compose.yml" ]; then hr "Log caddy (25 baris)"; docker compose "${FILES[@]}" logs --no-color --tail=25 caddy 2>&1; fi
hr "Disk & memori"; df -h / | tail -1; free -m | awk '/Mem:|Swap:/'
hr "Selesai"; echo "Kirim seluruh keluaran di atas ke pengembang."
