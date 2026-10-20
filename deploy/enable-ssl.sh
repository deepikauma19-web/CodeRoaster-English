#!/usr/bin/env bash
# Install the host nginx site and obtain a Let's Encrypt certificate (idempotent).
# Run as root ON THE VPS after the containers are up:
#   cd /opt/assignment-roaster && ./deploy/enable-ssl.sh roaster.getvibed.tech you@example.com
#
# Env:
#   SKIP_DNS_CHECK=1   skip the "domain resolves to this server" check
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
EMAIL="${2:-${EMAIL:-}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/nginx/roaster.getvibed.tech.conf"
TEMPLATE_DOMAIN_RE='roaster\.getvibed\.tech'

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || die "Run as root."
[[ -n "${DOMAIN}" && -n "${EMAIL}" ]] || die "Usage: $0 DOMAIN EMAIL"
[[ -f "${TEMPLATE}" ]] || die "nginx template not found: ${TEMPLATE}"
command -v nginx >/dev/null || die "nginx not installed (run deploy/setup-vps.sh)."
command -v certbot >/dev/null || die "certbot not installed (run deploy/setup-vps.sh)."

SITE_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}.conf"
SITE_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}.conf"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

log "Installing nginx site for ${DOMAIN}"
if [[ -f "${SITE_AVAILABLE}" ]] && grep -q 'managed by Certbot' "${SITE_AVAILABLE}"; then
    # Already certbot-managed: back it up; certbot will re-apply TLS to the fresh template below.
    cp -a "${SITE_AVAILABLE}" "${SITE_AVAILABLE}.bak.$(date +%Y%m%d%H%M%S)"
fi
sed "s/${TEMPLATE_DOMAIN_RE}/${DOMAIN}/g" "${TEMPLATE}" > "${SITE_AVAILABLE}"
ln -sfn "${SITE_AVAILABLE}" "${SITE_ENABLED}"
# Drop the stock welcome-page site so requests to the bare IP don't hit it.
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

log "Checking backend/frontend are reachable locally"
curl -fsS -o /dev/null http://127.0.0.1:8000/health \
    || echo "Warning: backend not answering on 127.0.0.1:8000 (deploy first?)." >&2
curl -fsS -o /dev/null http://127.0.0.1:3000/ \
    || echo "Warning: frontend not answering on 127.0.0.1:3000 (deploy first?)." >&2

if [[ "${SKIP_DNS_CHECK:-0}" != "1" ]]; then
    log "Checking DNS: ${DOMAIN} must resolve to this server"
    PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://ifconfig.me 2>/dev/null \
        || curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
    [[ -n "${PUBLIC_IP}" ]] || die "Could not determine this server's public IP (set SKIP_DNS_CHECK=1 to bypass)."
    DNS_IPS="$(dig +short A "${DOMAIN}" @1.1.1.1 | grep -E '^[0-9.]+$' || true)"
    echo "Server public IP: ${PUBLIC_IP}"
    echo "DNS A record(s):  ${DNS_IPS:-<none>}"
    if ! grep -qxF "${PUBLIC_IP}" <<<"${DNS_IPS}"; then
        die "${DOMAIN} does not resolve to ${PUBLIC_IP} yet. Fix the DNS A record (or wait for propagation) and retry."
    fi
fi

log "Requesting/installing certificate with certbot"
certbot --nginx -d "${DOMAIN}" \
    --non-interactive --agree-tos -m "${EMAIL}" \
    --redirect --keep-until-expiring

nginx -t
systemctl reload nginx

log "Verifying automatic renewal"
systemctl enable --now certbot.timer 2>/dev/null || true
systemctl list-timers certbot.timer --no-pager || true
certbot renew --dry-run

log "Done"
[[ -d "${CERT_DIR}" ]] && echo "Certificate: ${CERT_DIR}"
echo "Check: curl -I https://${DOMAIN}/health"
