#!/usr/bin/env bash
# Deploy Code Roaster from this checkout (your Mac) to the VPS over SSH.
# No GitHub credentials are needed on the server: the working tree is rsynced.
#
# Usage (from the repo root):
#   DEPLOY_HOST=203.0.113.10 ./deploy/deploy.sh
#   ./deploy/deploy.sh 203.0.113.10
#
# Env:
#   DEPLOY_HOST   VPS IP or hostname (required; or pass as first argument)
#   DEPLOY_USER   SSH user                       (default: root)
#   SSH_KEY       private key path               (default: ~/.ssh/roaster_vps)
#   REMOTE_DIR    app directory on the VPS       (default: /opt/assignment-roaster)
#   HEALTH_TIMEOUT seconds to wait for /health   (default: 180)
#   PROXY         nginx (default) or traefik. "traefik" adds docker-compose.traefik.yml
#                 (existing Traefik on the VPS, no host nginx, no published ports).
set -euo pipefail

DEPLOY_HOST="${1:-${DEPLOY_HOST:-}}"
DEPLOY_USER="${DEPLOY_USER:-root}"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/roaster_vps}"
REMOTE_DIR="${REMOTE_DIR:-/opt/assignment-roaster}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
PROXY="${PROXY:-nginx}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
case "${PROXY}" in
    nginx) ;;
    traefik) COMPOSE="${COMPOSE} -f docker-compose.traefik.yml" ;;
    *) printf 'ERROR: PROXY must be nginx or traefik\n' >&2; exit 1 ;;
esac

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ -n "${DEPLOY_HOST}" ]] || die "Set DEPLOY_HOST (VPS IP) or pass it as the first argument."
[[ -f "${SSH_KEY}" ]] || die "SSH key not found: ${SSH_KEY} (set SSH_KEY=...)."

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"
[[ -f docker-compose.yml && -f docker-compose.prod.yml ]] || die "Run from the repository (compose files not found)."

TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_OPTS=(-i "${SSH_KEY}" -o IdentitiesOnly=yes -o ServerAliveInterval=30)
# shellcheck disable=SC2029  # remote commands are intentionally expanded locally
remote() { ssh "${SSH_OPTS[@]}" "${TARGET}" "$@"; }

# Record what is being deployed (informational).
REVISION="unknown"
if git rev-parse --git-dir >/dev/null 2>&1; then
    REVISION="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
        REVISION="${REVISION}-dirty"
        echo "Warning: working tree has uncommitted changes; they WILL be deployed." >&2
    fi
fi

log "Checking SSH connectivity to ${TARGET}"
remote "mkdir -p '${REMOTE_DIR}' && command -v docker >/dev/null" \
    || die "SSH failed or Docker missing on the VPS. Run deploy/setup-vps.sh there first."

log "Syncing ${REPO_ROOT} -> ${TARGET}:${REMOTE_DIR} (revision ${REVISION})"
# Excluded paths are never deleted on the remote, so the server's .env survives --delete.
rsync -az --delete \
    -e "ssh -i ${SSH_KEY} -o IdentitiesOnly=yes" \
    --exclude='.git/' \
    --exclude='.github/' \
    --exclude='.claude/' \
    --exclude='node_modules/' \
    --exclude='.venv/' \
    --exclude='venv/' \
    --exclude='dist/' \
    --exclude='coverage/' \
    --exclude='htmlcov/' \
    --exclude='__pycache__/' \
    --exclude='.pytest_cache/' \
    --exclude='.mypy_cache/' \
    --exclude='.ruff_cache/' \
    --exclude='.vite/' \
    --exclude='*.pyc' \
    --exclude='*.db' \
    --exclude='.coverage' \
    --exclude='.DS_Store' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env.development' \
    --exclude='.env.production' \
    --exclude='backups/' \
    ./ "${TARGET}:${REMOTE_DIR}/"

remote "echo '${REVISION} $(date -u +%Y-%m-%dT%H:%M:%SZ)' > '${REMOTE_DIR}/REVISION'"

log "Checking remote ${REMOTE_DIR}/.env"
if ! remote "test -f '${REMOTE_DIR}/.env'"; then
    cat >&2 <<EOF

The production env file does not exist on the server yet. Create it, then re-run this script:

  ssh -i ${SSH_KEY} ${TARGET}
  cd ${REMOTE_DIR}
  cp .env.production.example .env
  chmod 600 .env
  nano .env        # replace every CHANGE_ME value

(The local development .env is never copied automatically.)
EOF
    exit 1
fi
if remote "grep -qE '^[^#]*CHANGE_ME' '${REMOTE_DIR}/.env'"; then
    die "Remote .env still contains CHANGE_ME placeholders. Edit ${REMOTE_DIR}/.env on the server first."
fi

log "Building and starting containers on the VPS"
# Keep the currently running images as :previous for a quick rollback (see deploy/README.md).
remote "cd '${REMOTE_DIR}' && \
    for svc in backend frontend; do \
        img=\"assignment-roaster-\${svc}\"; \
        if docker image inspect \"\${img}:latest\" >/dev/null 2>&1; then docker tag \"\${img}:latest\" \"\${img}:previous\"; fi; \
    done && \
    ${COMPOSE} up -d --build --remove-orphans && \
    docker image prune -f >/dev/null"

log "Waiting for backend health (timeout ${HEALTH_TIMEOUT}s)"
if [[ "${PROXY}" == "traefik" ]]; then
    # No host ports are published behind Traefik, so probe from inside the container.
    HEALTH_PROBE="cd '${REMOTE_DIR}' && ${COMPOSE} exec -T backend python -c \"import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/health', timeout=5).read().decode())\""
else
    HEALTH_PROBE="curl -fsS http://127.0.0.1:8000/health"
fi
if remote "for i in \$(seq 1 $((HEALTH_TIMEOUT / 3))); do \
        if ${HEALTH_PROBE//\$/\\$} >/dev/null 2>&1; then exit 0; fi; sleep 3; \
    done; exit 1"; then
    echo "Backend is healthy: $(remote "${HEALTH_PROBE}")"
else
    echo "Backend did not become healthy in time. Recent backend logs:" >&2
    remote "cd '${REMOTE_DIR}' && ${COMPOSE} logs --tail=80 backend" >&2 || true
    exit 1
fi

if [[ "${PROXY}" == "nginx" ]]; then
    if remote "curl -fsS -o /dev/null http://127.0.0.1:3000/"; then
        echo "Frontend is responding on 127.0.0.1:3000"
    else
        echo "Warning: frontend not responding on 127.0.0.1:3000 yet." >&2
    fi
fi

log "Status"
remote "cd '${REMOTE_DIR}' && ${COMPOSE} ps"
echo
echo "Deployed revision ${REVISION} to ${TARGET}:${REMOTE_DIR}"
