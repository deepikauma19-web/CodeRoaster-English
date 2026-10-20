# Production Deployment (Hostinger VPS)

Target: one Ubuntu 22.04/24.04 VPS serving **https://roaster.getvibed.tech**.

```
Browser --443--> host nginx (Let's Encrypt TLS)
                   /api/*, /health -> 127.0.0.1:8000  backend container (FastAPI)
                   everything else -> 127.0.0.1:3000  frontend container (SPA)
                                                      db container (Postgres, no published port)
```

Code is pushed from your Mac with `rsync` over SSH. The VPS never needs GitHub credentials.

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Prod override: localhost-only ports, restart policy, log rotation, prod URLs |
| `.env.production.example` | Template for the server's `/opt/assignment-roaster/.env` |
| `deploy/setup-vps.sh` | One-time server provisioning (Docker, nginx, certbot, ufw, fail2ban, swap) |
| `deploy/deploy.sh` | Run on the Mac: rsync, build, start, health check |
| `deploy/enable-ssl.sh` | Run on the VPS: install nginx site and obtain the TLS certificate |
| `deploy/nginx/roaster.getvibed.tech.conf` | Host nginx site (port 80; certbot adds 443 and the redirect) |

---

## 1. DNS

In your DNS provider for `getvibed.tech`, create:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `roaster` | `<VPS_IP>` | 300 |

Check it: `dig +short roaster.getvibed.tech` should print the VPS IP.

## 2. SSH key (on the Mac)

```bash
ssh-keygen -t ed25519 -C "roaster-deploy" -f ~/.ssh/roaster_vps
ssh-copy-id -i ~/.ssh/roaster_vps.pub root@<VPS_IP>     # uses the Hostinger root password once
ssh -i ~/.ssh/roaster_vps root@<VPS_IP> 'echo ok'
```

Optional, once key login works: set `PasswordAuthentication no` in
`/etc/ssh/sshd_config` on the VPS and run `systemctl reload ssh`.

## 3. Provision the VPS (one time, idempotent)

```bash
ssh -i ~/.ssh/roaster_vps root@<VPS_IP> 'bash -s' < deploy/setup-vps.sh
```

This installs Docker Engine and the Compose plugin from Docker's apt repo, plus nginx,
certbot, ufw (OpenSSH and Nginx Full only), fail2ban and unattended-upgrades. It also
creates a 2G swap file if the server has no swap, and creates `/opt/assignment-roaster`.

## 4. First deploy and the server `.env`

```bash
DEPLOY_HOST=<VPS_IP> ./deploy/deploy.sh
```

The first run syncs the code and then stops, because `/opt/assignment-roaster/.env` does
not exist yet. Your local dev `.env` is never copied. Create the production file on the
server:

```bash
ssh -i ~/.ssh/roaster_vps root@<VPS_IP>
cd /opt/assignment-roaster
cp .env.production.example .env && chmod 600 .env
openssl rand -hex 32        # -> POSTGRES_PASSWORD (hex keeps DATABASE_URL valid)
openssl rand -base64 48     # -> SECRET_KEY
nano .env                   # replace every CHANGE_ME value
exit
```

Run the deploy again:

```bash
DEPLOY_HOST=<VPS_IP> ./deploy/deploy.sh
```

The script syncs the code, runs `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`,
prunes dangling images, waits for `http://127.0.0.1:8000/health` and then prints the
container status. Database migrations (`alembic upgrade head`) run automatically in the
backend entrypoint.

Options: `DEPLOY_USER` (default `root`), `SSH_KEY` (default `~/.ssh/roaster_vps`),
`REMOTE_DIR` (default `/opt/assignment-roaster`), `HEALTH_TIMEOUT` (default `180`).

## 5. HTTPS (one time)

```bash
ssh -i ~/.ssh/roaster_vps root@<VPS_IP>
cd /opt/assignment-roaster
./deploy/enable-ssl.sh roaster.getvibed.tech you@example.com
```

The script:

1. Installs the nginx site and runs `nginx -t` and a reload.
2. Checks that DNS points at this server. Set `SKIP_DNS_CHECK=1` to skip this.
3. Runs `certbot --nginx --redirect`, which adds the 443 server block and the HTTP to HTTPS redirect.
4. Checks automatic renewal with `certbot renew --dry-run`. Renewal itself is handled by the `certbot.timer` systemd timer.

HSTS is sent only over HTTPS. You can re-run the script safely: it reuses an existing
certificate (`--keep-until-expiring`).

Verify:

```bash
curl -I https://roaster.getvibed.tech/health
curl -I http://roaster.getvibed.tech        # 301 -> https
```

## 6. Google OAuth (production)

In Google Cloud Console, go to **APIs & Services > Credentials > your OAuth client** and set:

- **Authorized JavaScript origins:** `https://roaster.getvibed.tech`
- **Authorized redirect URIs:** `https://roaster.getvibed.tech/api/v1/auth/google/callback`

On the **OAuth consent screen**, add `getvibed.tech` as an authorized domain and publish
the app. While it is in "Testing", only listed test users can sign in.

`GOOGLE_REDIRECT_URI` is set by `docker-compose.prod.yml` from `APP_URL`.

## 7. Updating

```bash
git pull   # or commit your changes
DEPLOY_HOST=<VPS_IP> ./deploy/deploy.sh
```

The deployed git revision is written to `/opt/assignment-roaster/REVISION`.

## 8. Logs and status

```bash
ssh -i ~/.ssh/roaster_vps root@<VPS_IP>
cd /opt/assignment-roaster
alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml'
dc ps
dc logs -f --tail=200 backend
dc logs --tail=200 frontend db
tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

Container logs are rotated: json-file driver, 10 MB x 5 files per container.

## 9. Backups

```bash
# On the VPS: dump the database (custom format, compressed)
cd /opt/assignment-roaster
mkdir -p /opt/assignment-roaster-backups
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > /opt/assignment-roaster-backups/roaster-$(date +%F-%H%M).dump

# Copy it to your Mac
scp -i ~/.ssh/roaster_vps root@<VPS_IP>:/opt/assignment-roaster-backups/roaster-*.dump ~/Backups/

# Restore (overwrites existing objects)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < /opt/assignment-roaster-backups/roaster-YYYY-MM-DD-HHMM.dump
```

Keep backups **outside** `/opt/assignment-roaster`, because `deploy.sh` uses `rsync --delete`.
For a nightly backup, add the dump command to root's crontab (`crontab -e`), for example:
`0 3 * * * cd /opt/assignment-roaster && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /opt/assignment-roaster-backups/roaster-$(date +\%F).dump`

The data lives in the Docker volume `assignment-roaster_postgres_data`.
Never run `docker compose down -v` in production, because it deletes that volume.

## 10. Rollback

**Preferred: redeploy an earlier commit.**

```bash
git checkout <good-sha>
DEPLOY_HOST=<VPS_IP> ./deploy/deploy.sh
git checkout main
```

**Quick: reuse the previous images.** `deploy.sh` tags the running images as `:previous` before each build.

```bash
cd /opt/assignment-roaster
for s in backend frontend; do docker tag assignment-roaster-$s:previous assignment-roaster-$s:latest; done
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build
```

Neither option undoes database migrations. If the bad release included a migration,
restore a backup or run `alembic downgrade` in the backend container first:
`dc exec backend alembic downgrade -1`.

## Security notes

- Postgres has no published port. The backend and frontend bind only to `127.0.0.1`.
  This matters because Docker-published ports bypass ufw.
- Uvicorn runs with `--proxy-headers --forwarded-allow-ips=*`. This is safe only because
  the backend port is reachable from the host's nginx alone.
- The `.env` on the server should be `chmod 600` and is excluded from rsync, so it is
  never overwritten or deleted.

---

## Alternative: VPS that already runs Traefik (no host nginx)

If ports 80/443 are already owned by a Traefik container (for example an n8n stack), do **not**
run `setup-vps.sh` / `enable-ssl.sh` (nginx, certbot and ufw would clash). Use the Traefik override:

```bash
PROXY=traefik DEPLOY_HOST=<VPS_IP> ./deploy/deploy.sh
```

`docker-compose.traefik.yml` publishes no host ports, joins Traefik's Docker network and adds
labels routing `/api/*` and `/health` to the backend and everything else to the frontend, with
TLS from Traefik's Let's Encrypt resolver. Defaults match an n8n-style Traefik; override in the
server `.env` if yours differ: `TRAEFIK_NETWORK` (`n8n_default`), `TRAEFIK_CERT_RESOLVER`
(`mytlschallenge`), `ROASTER_HOST` (`roaster.getvibed.tech`).
Docker itself must be installed on the VPS; nothing else is installed or reconfigured.
