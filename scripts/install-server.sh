#!/usr/bin/env bash
# Maung-Wo-Inv — persiapan server Linux: Docker Engine + Compose plugin (+ Portainer, firewall, swap, Node 24 opsional)
# Didukung: Ubuntu 22.04 / 24.04 / 26.04+ (dan turunan: Mint, Pop!_OS), Debian 12/13, RHEL-keluarga (Rocky, AlmaLinux, CentOS Stream, Fedora).
# OS lain: skrip mencoba installer resmi Docker (get.docker.com) setelah konfirmasi.
# Pakai:  sudo bash scripts/install-server.sh                      # Docker + Portainer
#         sudo SETUP_FIREWALL=1 bash scripts/install-server.sh     # + firewall (SSH, 80, 443 [+9443 Portainer])
#         sudo SETUP_SWAP=2G   bash scripts/install-server.sh      # + swap (server RAM ≤ 2 GB agar build tidak "Killed")
#         sudo SKIP_PORTAINER=1 bash scripts/install-server.sh     # tanpa Portainer
#         sudo INSTALL_NODE=1  bash scripts/install-server.sh      # + Node.js 24 (hanya untuk dev/typecheck di server)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo."; exit 1; }
[ -r /etc/os-release ] || { echo "/etc/os-release tidak ada — OS tidak dikenali."; exit 1; }
. /etc/os-release
LIKE=" ${ID:-} ${ID_LIKE:-} "
FAMILY=""
case "$LIKE" in
  *" ubuntu "*) FAMILY=apt; REPO_OS=ubuntu; CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"; FALLBACK_CODENAME=noble;;
  *" debian "*) FAMILY=apt; REPO_OS=debian; CODENAME="${VERSION_CODENAME:-}"; FALLBACK_CODENAME=bookworm;;
  *" rhel "*|*" fedora "*|*" centos "*) FAMILY=dnf;;
esac
echo "==> OS: ${PRETTY_NAME:-$ID} (keluarga: ${FAMILY:-tidak dikenal}), arsitektur: $(uname -m)"

mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$mem_mb" -ge 3500 ] || echo "PERINGATAN: RAM ${mem_mb} MB. Build Next.js butuh ±4 GB — tambahkan swap: sudo SETUP_SWAP=2G bash scripts/install-server.sh"

install_docker_official_script() {
  echo "==> Memakai installer resmi Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
}

if ! command -v docker >/dev/null 2>&1; then
  case "$FAMILY" in
    apt)
      echo "==> Paket dasar"
      apt-get update -y
      apt-get install -y ca-certificates curl git gnupg openssl iproute2
      echo "==> Hapus paket Docker tidak resmi yang bentrok (bila ada)"
      for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
        apt-get remove -y "$pkg" >/dev/null 2>&1 || true
      done
      # Repo resmi Docker: pakai codename OS bila sudah dipublikasikan, bila belum (rilis baru) pakai codename LTS terakhir yang didukung
      if ! curl -fsI "https://download.docker.com/linux/$REPO_OS/dists/$CODENAME/Release" >/dev/null 2>&1; then
        echo "   (repo Docker belum punya '$CODENAME' → memakai '$FALLBACK_CODENAME'; paketnya kompatibel)"
        CODENAME="$FALLBACK_CODENAME"
      fi
      echo "==> Docker Engine + Compose plugin (repo resmi Docker, $REPO_OS/$CODENAME)"
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/$REPO_OS/gpg" -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$REPO_OS $CODENAME stable" > /etc/apt/sources.list.d/docker.list
      apt-get update -y
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    dnf)
      echo "==> Paket dasar"
      dnf install -y dnf-plugins-core curl git openssl iproute
      REPO_OS=centos; [ "${ID:-}" = fedora ] && REPO_OS=fedora; [ "${ID:-}" = rhel ] && REPO_OS=rhel
      echo "==> Docker Engine + Compose plugin (repo resmi Docker, $REPO_OS)"
      dnf config-manager --add-repo "https://download.docker.com/linux/$REPO_OS/docker-ce.repo" 2>/dev/null || dnf config-manager addrepo --from-repofile="https://download.docker.com/linux/$REPO_OS/docker-ce.repo"
      dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    *)
      read -r -p "OS '${PRETTY_NAME:-$ID}' tidak dikenal. Coba installer resmi Docker (get.docker.com)? [y/N] " ans
      [[ "$ans" =~ ^[Yy]$ ]] || { echo "Dibatalkan. Pasang Docker Engine + Compose plugin manual: https://docs.docker.com/engine/install/"; exit 1; }
      install_docker_official_script
      ;;
  esac
else
  echo "==> Docker sudah terpasang: $(docker --version)"
fi
systemctl enable --now docker

docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin tidak terpasang — pasang 'docker-compose-plugin' (butuh Compose v2.24+)."; exit 1; }
cv="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
if [ -n "$cv" ] && [ "$(printf '%s\n2.24.0\n' "$cv" | sort -V | head -1)" != "2.24.0" ]; then
  echo "PERINGATAN: Compose $cv < 2.24 — mode HTTPS (docker-compose.caddy.yml) membutuhkan ≥ 2.24. Perbarui paket docker-compose-plugin."
fi

if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
  usermod -aG docker "$SUDO_USER"
  echo "==> User '$SUDO_USER' ditambahkan ke grup docker (logout/login ulang atau 'newgrp docker' agar berlaku)."
fi

if [ -n "${SETUP_SWAP:-}" ] && ! swapon --show | grep -q .; then
  echo "==> Swap ${SETUP_SWAP}"
  fallocate -l "$SETUP_SWAP" /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if [ "${INSTALL_NODE:-0}" = 1 ] && ! node -v 2>/dev/null | grep -q "^v24"; then
  echo "==> Node.js 24 (NodeSource)"
  if [ "$FAMILY" = apt ]; then curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
  elif [ "$FAMILY" = dnf ]; then curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - && dnf install -y nodejs
  else echo "Pasang Node 24 manual (nvm)."; fi
fi

if [ "${SKIP_PORTAINER:-0}" != 1 ]; then
  if docker ps -a --format '{{.Names}}' | grep -qx portainer; then
    echo "==> Portainer sudah ada, dilewati."
  else
    echo "==> Portainer CE (UI Docker) di https://<ip-server>:9443"
    docker volume create portainer_data >/dev/null
    docker run -d --name portainer --restart=always \
      -p 9443:9443 \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v portainer_data:/data \
      portainer/portainer-ce:lts
  fi
fi

if [ "${SETUP_FIREWALL:-0}" = 1 ]; then
  echo "==> Firewall"
  if command -v ufw >/dev/null 2>&1 || [ "$FAMILY" = apt ]; then
    command -v ufw >/dev/null 2>&1 || apt-get install -y ufw
    ufw allow OpenSSH            # WAJIB sebelum enable agar SSH tidak terkunci
    ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 443/udp
    [ "${SKIP_PORTAINER:-0}" = 1 ] || ufw allow 9443/tcp
    ufw --force enable
  elif [ "$FAMILY" = dnf ]; then
    dnf install -y firewalld; systemctl enable --now firewalld
    firewall-cmd --permanent --add-service=ssh --add-service=http --add-service=https
    [ "${SKIP_PORTAINER:-0}" = 1 ] || firewall-cmd --permanent --add-port=9443/tcp
    firewall-cmd --reload
  fi
  echo "   Mode tanpa SSL (http://IP:3000) memerlukan port 3000 terbuka: sudo ufw allow 3000/tcp"
fi

echo
echo "SELESAI. Berikutnya (sebagai user biasa, di folder repo):"
echo "   bash scripts/deploy.sh --domain wo.contoh.co.id --email admin@contoh.co.id   # HTTPS Let's Encrypt (disarankan)"
echo "   bash scripts/deploy.sh                                                        # tanpa domain: http://IP-SERVER:3000"
echo "Catatan: Docker mem-bypass UFW untuk port yang dipublikasikan container; batasi akses 3000/9443 lewat firewall penyedia VPS bila perlu."
