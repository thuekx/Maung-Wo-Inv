#!/usr/bin/env bash
# Maung-Wo-Inv — persiapan server Ubuntu 24.04 LTS (noble): Docker Engine + Compose + Portainer (+ Node 24 & firewall opsional)
# Pakai:  sudo bash scripts/install-server.sh            # Docker + Portainer
#         sudo SETUP_FIREWALL=1 bash scripts/install-server.sh   # + UFW (SSH, 80, 443, 3000, 4000, 9443)
#         sudo SKIP_PORTAINER=1 bash scripts/install-server.sh   # tanpa Portainer
#         sudo INSTALL_NODE=1 bash scripts/install-server.sh     # + Node.js 24 (hanya untuk dev/typecheck di server)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo."; exit 1; }
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "OS $ID belum didukung (target: Ubuntu 24.04)."; exit 1;; esac
[ "${VERSION_ID:-}" = "24.04" ] || echo "PERINGATAN: skrip ditargetkan untuk Ubuntu 24.04 (terdeteksi $PRETTY_NAME)."

echo "==> Paket dasar"
apt-get update -y
apt-get install -y ca-certificates curl git gnupg openssl ufw

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Hapus paket Docker tidak resmi yang bentrok (bila ada)"
  for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    apt-get remove -y "$pkg" >/dev/null 2>&1 || true
  done
  echo "==> Docker Engine + Compose plugin (repo resmi Docker)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "==> Docker sudah terpasang: $(docker --version)"
fi
systemctl enable --now docker

if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
  usermod -aG docker "$SUDO_USER"
  echo "==> User '$SUDO_USER' ditambahkan ke grup docker (logout/login ulang agar berlaku)."
fi

if [ "${INSTALL_NODE:-0}" = 1 ] && ! node -v 2>/dev/null | grep -q "^v24"; then
  echo "==> Node.js 24 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
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
  echo "==> Firewall UFW"
  ufw allow OpenSSH            # WAJIB sebelum enable agar SSH tidak terkunci
  ufw allow 80/tcp; ufw allow 443/tcp
  ufw allow 3000/tcp; ufw allow 4000/tcp   # hapus dua baris ini bila memakai Caddy/HTTPS
  [ "${SKIP_PORTAINER:-0}" = 1 ] || ufw allow 9443/tcp
  ufw --force enable
fi

echo
echo "SELESAI. Berikutnya (sebagai user biasa, di folder repo):  bash scripts/deploy.sh"
echo "Catatan: Docker mem-bypass UFW untuk port yang dipublikasikan container; batasi akses 3000/4000/9443 lewat firewall cloud/penyedia VPS bila perlu."
