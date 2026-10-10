#!/usr/bin/env bash
# Maung-Wo-Inv — PEMANDU INSTALASI INTERAKTIF (satu perintah, semua isian ditanyakan).
# Dipakai dari server baru (repo private → perlu token GitHub):
#   read -rsp "Token GitHub: " GH_TOKEN; echo; export GH_TOKEN
#   curl -fsSL -H "Authorization: token $GH_TOKEN" https://raw.githubusercontent.com/thuekx/Maung-Wo-Inv/main/scripts/setup.sh -o setup.sh && bash setup.sh
# Atau dari dalam folder repo:  bash scripts/setup.sh        (DRY_RUN=1 = hanya mencetak, tidak mengubah apa pun)
set -uo pipefail

REPO_PATH="thuekx/Maung-Wo-Inv"
DEST="${DEST:-$HOME/Maung-Wo-Inv}"
DRY="${DRY_RUN:-0}"
c_b=$'\e[1m'; c_g=$'\e[32m'; c_y=$'\e[33m'; c_r=$'\e[31m'; c_0=$'\e[0m'
say()  { echo -e "${c_b}==>${c_0} $*"; }
ok()   { echo -e "${c_g}✔${c_0} $*"; }
warn() { echo -e "${c_y}!${c_0} $*"; }
die()  { echo -e "${c_r}✘ $*${c_0}"; exit 1; }
run()  { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
ask()  { # ask VAR "pertanyaan" [default]
  local __v="$1" __q="$2" __d="${3:-}" __a
  if [ -n "$__d" ]; then read -r -p "$__q [$__d]: " __a; __a="${__a:-$__d}"; else read -r -p "$__q: " __a; fi
  printf -v "$__v" '%s' "$__a"
}
yn()   { # yn "pertanyaan" default(y/n)
  local d="${2:-y}" a; read -r -p "$1 [$( [ "$d" = y ] && echo Y/n || echo y/N )]: " a; a="${a:-$d}"; [[ "$a" =~ ^[Yy]$ ]]
}

if [ "$(id -u)" -eq 0 ]; then warn "Berjalan sebagai root — disarankan memakai user biasa yang punya sudo."; command -v sudo >/dev/null || sudo() { "$@"; }; else command -v sudo >/dev/null || die "sudo tidak ada."; fi
[ "$DRY" = 1 ] && warn "MODE DRY-RUN: tidak ada perubahan yang dilakukan."

echo; echo "${c_b}Pemandu instalasi Maung (WO + Inventori)${c_0}"; echo "Tekan Enter untuk memakai nilai [default]. Ctrl+C untuk batal kapan saja."; echo

# ───────────────────────── 1. Pertanyaan ─────────────────────────
MODE_SSL=y
yn "Pakai domain + SSL Let's Encrypt (disarankan untuk produksi)?" y || MODE_SSL=n
DOMAIN=""; EMAIL=""
if [ "$MODE_SSL" = y ]; then
  while true; do
    ask DOMAIN "Nama domain (mis. wo.perusahaan.co.id)"
    DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z')"
    [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] && break
    warn "Domain tidak valid (alamat IP tidak bisa untuk Let's Encrypt)."
  done
  while true; do
    ask EMAIL "Email admin (pemberitahuan Let's Encrypt)"
    [[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] && break
    warn "Format email tidak valid."
  done
fi

NEED_CLONE=1; [ -f "$(dirname "${BASH_SOURCE[0]}")/deploy.sh" ] && [ -d "$(dirname "${BASH_SOURCE[0]}")/../apps" ] && NEED_CLONE=0
if [ "$NEED_CLONE" = 0 ]; then DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; fi

WIPE=n; OLD=""
for d in "$DEST" /opt/staging/projects/Maung-Wo-Inv; do
  [ -f "$d/docker-compose.yml" ] && command -v docker >/dev/null 2>&1 && docker compose -f "$d/docker-compose.yml" ps -q 2>/dev/null | grep -q . && OLD="$d" && break
done
if [ -n "$OLD" ]; then
  warn "Ditemukan instalasi lama yang berjalan di $OLD"
  if yn "Hapus instalasi lama BESERTA SEMUA DATANYA (database, foto, sertifikat)?" n; then
    read -r -p "Ketik HAPUS (huruf besar) untuk konfirmasi: " k; [ "$k" = HAPUS ] && WIPE=y || warn "Tidak dikonfirmasi — instalasi lama dibiarkan."
  fi
fi

GH_USER_IN="${GH_USER:-thuekx}"
if [ "$NEED_CLONE" = 1 ]; then
  ask GH_USER_IN "Username GitHub pemilik token" "$GH_USER_IN"
  if [ -z "${GH_TOKEN:-}" ]; then read -rsp "Token GitHub (tidak tampil di layar): " GH_TOKEN; echo; fi
fi

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
SWAP=""; if [ "$MEM_MB" -lt 3500 ]; then warn "RAM ${MEM_MB} MB (< 3,5 GB) — build bisa gagal tanpa swap."; yn "Tambahkan swap 2 GB?" y && SWAP=2G; fi
FW=n; yn "Atur firewall otomatis (buka SSH, 80, 443, 9443)?" y && FW=y
PORT=n; yn "Pasang Portainer (UI Docker, port 9443)?" y && PORT=y
DEMO=0; yn "Isi data demo untuk uji coba (jangan untuk produksi)?" n && DEMO=1

echo; echo "${c_b}Ringkasan${c_0}"
echo "  Mode        : $([ "$MODE_SSL" = y ] && echo "HTTPS — $DOMAIN ($EMAIL)" || echo "HTTP — http://<IP>:3000 (tanpa SSL)")"
echo "  Folder      : $DEST"
echo "  Hapus lama  : $([ "$WIPE" = y ] && echo "YA ($OLD)" || echo tidak)"
echo "  Swap        : ${SWAP:-tidak} | Firewall: $FW | Portainer: $PORT | Data demo: $([ "$DEMO" = 1 ] && echo ya || echo tidak)"
yn "Lanjutkan?" y || die "Dibatalkan."

# ───────────────────────── 2. Pemeriksaan awal ─────────────────────────
say "Pemeriksaan awal"
PUBIP="$(curl -4 -fsS -m 6 https://api.ipify.org 2>/dev/null || curl -4 -fsS -m 6 https://ifconfig.me 2>/dev/null || true)"
ok "IP publik server: ${PUBIP:-tidak terdeteksi}"
if [ "$MODE_SSL" = y ]; then
  DNSIP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [ -z "$DNSIP" ]; then warn "DNS $DOMAIN belum punya A record."; elif [ -n "$PUBIP" ] && [ "$DNSIP" != "$PUBIP" ]; then warn "DNS $DOMAIN → $DNSIP, berbeda dengan IP publik server ($PUBIP)."; else ok "DNS $DOMAIN → $DNSIP (cocok)"; fi
  if [ -z "$DNSIP" ] || { [ -n "$PUBIP" ] && [ "$DNSIP" != "$PUBIP" ]; }; then
    echo "  Perbaiki A record di penyedia domain (Cloudflare: set 'DNS only' abu-abu), tunggu menyebar."
    yn "Tetap lanjut (sertifikat baru terbit setelah DNS benar; app tetap bisa dibuka lewat http://IP)?" n || die "Dibatalkan — perbaiki DNS lalu jalankan ulang."
  fi
  if sudo ss -ltn 2>/dev/null | grep -qE '[:.](80|443)[[:space:]]'; then warn "Port 80/443 sedang dipakai proses lain:"; sudo ss -ltnp 2>/dev/null | grep -E '[:.](80|443)[[:space:]]' | head -3; yn "Lanjut juga?" n || die "Hentikan layanan itu dulu (mis. sudo systemctl disable --now nginx apache2)."; fi
  echo "  Pastikan port 80 & 443 juga terbuka di firewall PENYEDIA VPS / router (tidak bisa dicek dari sini)."
fi

# ───────────────────────── 3. Token & kode ─────────────────────────
if [ "$NEED_CLONE" = 1 ]; then
  say "Memeriksa akses GitHub"
  command -v git >/dev/null || { run sudo apt-get update -y >/dev/null 2>&1; run sudo apt-get install -y git >/dev/null 2>&1 || run sudo dnf install -y git; }
  if [ "$DRY" != 1 ]; then
    URL="https://${GH_USER_IN}:${GH_TOKEN}@github.com/${REPO_PATH}.git"
    if ! out="$(GIT_TERMINAL_PROMPT=0 git ls-remote "$URL" HEAD 2>&1)"; then
      echo "$out" | sed "s/${GH_TOKEN}/***/g"
      cat <<EOT

${c_r}Token ditolak / tidak punya akses ke repo.${c_0} Penyebab umum & cara memperbaiki:
  • Token fine-grained harus: Repository access → pilih repo ${REPO_PATH}, dan Permissions → Contents = Read-only.
  • Atau buat token klasik (GitHub → Settings → Developer settings → Tokens (classic)) dengan centang scope "repo".
  • Pastikan username benar ('${GH_USER_IN}'), token belum kedaluwarsa, dan tidak ada spasi tersembunyi saat menempel.
EOT
      exit 1
    fi
    ok "Akses repo OK"
  fi
fi

# ───────────────────────── 4. Hapus lama ─────────────────────────
if [ "$WIPE" = y ]; then say "Menghapus instalasi lama ($OLD)"; run bash -c "cd '$OLD' && docker compose down -v --remove-orphans"; ok "Instalasi lama dihapus"; fi

if [ "$NEED_CLONE" = 1 ]; then
  say "Mengunduh kode ke $DEST"
  if [ -d "$DEST/.git" ]; then
    warn "$DEST sudah ada — dipakai ulang (git pull)."
    run git -C "$DEST" pull origin main
  else
    run git clone "https://${GH_USER_IN}:${GH_TOKEN}@github.com/${REPO_PATH}.git" "$DEST"
  fi
  if [ "$DRY" != 1 ]; then
    # simpan kredensial di berkas khusus (0600) lalu buang token dari URL remote → `git pull` berikutnya tidak meminta lagi
    git -C "$DEST" remote set-url origin "https://github.com/${REPO_PATH}.git"
    git -C "$DEST" config credential.helper "store --file $HOME/.maung-git-cred"
    ( umask 077; printf 'https://%s:%s@github.com\n' "$GH_USER_IN" "$GH_TOKEN" > "$HOME/.maung-git-cred" )
    ok "Kode terunduh; kredensial tersimpan aman di ~/.maung-git-cred (izin 600)"
  fi
fi
[ "$DRY" = 1 ] && [ ! -d "$DEST" ] && { echo "[dry-run] (lanjutan memakai folder $DEST yang belum ada — berhenti di sini)"; DRY_STOP=1; }
[ "${DRY_STOP:-0}" = 1 ] || cd "$DEST"

# ───────────────────────── 5. Docker ─────────────────────────
say "Menyiapkan server (Docker, Compose$([ "$PORT" = y ] && echo ", Portainer"))"
run sudo timedatectl set-timezone Asia/Jakarta
INST_ENV=(); [ "$FW" = y ] && INST_ENV+=(SETUP_FIREWALL=1); [ -n "$SWAP" ] && INST_ENV+=(SETUP_SWAP="$SWAP"); [ "$PORT" = y ] || INST_ENV+=(SKIP_PORTAINER=1)
run sudo env "${INST_ENV[@]}" bash scripts/install-server.sh || die "Instalasi Docker gagal — lihat pesan di atas."
ok "Docker siap"

# ───────────────────────── 6. Deploy ─────────────────────────
say "Membangun & menjalankan aplikasi (build pertama 5–10 menit)"
DEPLOY_ARGS=""; [ "$MODE_SSL" = y ] && DEPLOY_ARGS="--domain $DOMAIN --email $EMAIL"
if [ "$DRY" = 1 ]; then echo "[dry-run] sg docker -c 'DEMO=$DEMO bash scripts/deploy.sh $DEPLOY_ARGS'"; else
  if [ "$(id -u)" -eq 0 ]; then DEMO=$DEMO bash scripts/deploy.sh $DEPLOY_ARGS; else sg docker -c "DEMO=$DEMO bash scripts/deploy.sh $DEPLOY_ARGS"; fi || die "deploy.sh gagal — lihat pesan di atas (kirim ke pengembang bila perlu)."
fi

# ───────────────────────── 7. Verifikasi ─────────────────────────
if [ "$MODE_SSL" = y ] && [ "$DRY" != 1 ]; then
  say "Menunggu sertifikat SSL terbit (maks. 3 menit)"
  GOT=0
  for i in $(seq 1 36); do
    if curl -fsS -m 8 "https://$DOMAIN/health" 2>/dev/null | grep -q '"ok":true'; then GOT=1; break; fi
    printf '.'; sleep 5
  done; echo
  if [ "$GOT" = 1 ]; then ok "https://$DOMAIN aktif dengan sertifikat sah"; else
    warn "Belum bisa diakses lewat HTTPS. Biasanya DNS/port 80-443 belum benar. Log Caddy:"; sg docker -c "docker compose logs --tail=15 caddy" 2>/dev/null
    echo "  Aplikasi tetap bisa dibuka lewat http://${PUBIP:-<IP-server>} (jalur pemulihan). Perbaiki DNS/port, sertifikat terbit otomatis."
  fi
fi

# ───────────────────────── 8. Selesai ─────────────────────────
PASS="$(grep ^SEED_PASSWORD= .env 2>/dev/null | cut -d= -f2-)"
echo; echo "${c_g}${c_b}SELESAI${c_0}"
if [ "$MODE_SSL" = y ]; then echo "  Buka   : https://$DOMAIN"; else echo "  Buka   : http://${PUBIP:-<IP-server>}:3000  (kamera/GPS HP butuh HTTPS)"; fi
echo "  Login  : admin@l1v.local / ${PASS:-<lihat .env: SEED_PASSWORD>}"
echo "  Lakukan: 1) ganti password semua akun  2) Admin → Pengaturan → SSL & Domain (cek status sertifikat)"
[ "$PORT" = y ] && echo "           3) buka https://${DOMAIN:-<IP>}:9443 dan buat akun Portainer dalam 5 menit pertama"
echo "  Update : cd $DEST && git pull origin main && bash scripts/deploy.sh"
echo "  Catatan: bila perintah docker ditolak izin, login SSH ulang (grup docker baru aktif)."
