#!/usr/bin/env bash
# One-time (idempotent) provisioning of an Ubuntu 22.04/24.04 VPS for Code Roaster.
# Run as root on the VPS, e.g. from your Mac:
#   ssh -i ~/.ssh/roaster_vps root@VPS_IP 'bash -s' < deploy/setup-vps.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/assignment-roaster}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
SWAP_FILE="/swapfile"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
    echo "This script must be run as root." >&2
    exit 1
fi

if [[ ! -r /etc/os-release ]]; then
    echo "Cannot detect OS (/etc/os-release missing)." >&2
    exit 1
fi
# shellcheck source=/dev/null
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "Warning: expected Ubuntu, found '${ID:-unknown}'. Continuing anyway." >&2
fi
CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"

export DEBIAN_FRONTEND=noninteractive
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

log "Updating system packages"
apt-get update
apt-get "${APT_OPTS[@]}" upgrade

log "Installing base packages"
apt-get "${APT_OPTS[@]}" install \
    ca-certificates curl gnupg rsync git dnsutils \
    nginx certbot python3-certbot-nginx \
    ufw fail2ban unattended-upgrades

log "Installing Docker Engine + Compose plugin (official Docker apt repo)"
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg -s "${pkg}" >/dev/null 2>&1; then
        apt-get "${APT_OPTS[@]}" remove "${pkg}"
    fi
done
install -m 0755 -d /etc/apt/keyrings
if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get "${APT_OPTS[@]}" install \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
systemctl enable --now containerd

log "Enabling nginx"
systemctl enable --now nginx

log "Configuring firewall (ufw)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
# Note: Docker-published ports bypass ufw. That is why the prod compose file binds
# backend/frontend to 127.0.0.1 and never publishes Postgres.

log "Enabling fail2ban (sshd jail is on by default on Ubuntu)"
systemctl enable --now fail2ban

log "Enabling unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades

log "Ensuring swap (${SWAP_SIZE}) exists"
if [[ -z "$(swapon --show --noheadings)" ]]; then
    if [[ ! -f "${SWAP_FILE}" ]]; then
        fallocate -l "${SWAP_SIZE}" "${SWAP_FILE}" || dd if=/dev/zero of="${SWAP_FILE}" bs=1M count=2048
        chmod 600 "${SWAP_FILE}"
        mkswap "${SWAP_FILE}"
    fi
    swapon "${SWAP_FILE}"
    grep -qE "^${SWAP_FILE}[[:space:]]" /etc/fstab || echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
    sysctl -q vm.swappiness=10
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-roaster-swap.conf
else
    echo "Swap already active:"
    swapon --show
fi

log "Creating app directory ${APP_DIR}"
install -m 0750 -d "${APP_DIR}"

log "Done"
docker --version
docker compose version
nginx -v
certbot --version
ufw status verbose
echo
echo "Next: from your Mac run   DEPLOY_HOST=<VPS_IP> ./deploy/deploy.sh"
