# Self-hosting on your own Linux machine (Ubuntu + Tailscale)

The main deployment of OpenLibrary runs on Railway ([deployment-runbook.md](deployment-runbook.md)). This page is the other supported way: the same Docker image on a machine you own, reachable only from your own devices through Tailscale. The compose file and the scripts in `deploy/` are kept working for it. It was the production setup until the move to Railway (2026-11), which removed the dependency on a PC being on and on Tailscale being installed on every device.

Result: `https://<your-pc>.<your-tailnet>.ts.net` reachable from your devices at home and away, **without opening ports** or exposing anything to the Internet. Cost: €0.

```
Phone / laptop ──(Tailscale, encrypted)──▶ Ubuntu PC
                                           tailscale serve :443 (HTTPS, automatic certificate)
                                             └─▶ 127.0.0.1:8080 → openlibrary container (API + web)
                                                                     └─ /srv/openlibrary/data (DB, covers, backups)
```

## 1. Prerequisites (once)

```bash
sudo apt update && sudo apt install -y git restic
# Docker Engine + compose plugin (https://docs.docker.com/engine/install/ubuntu/)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # sign out and back in for it to take effect
```

## 2. Tailscale

1. Create a free account at https://login.tailscale.com (Personal plan).
2. On the PC:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --hostname=openlibrary
   ```
   With `--hostname=openlibrary` the address will be `https://openlibrary.<your-tailnet>.ts.net`.
3. In the admin console → **DNS**: enable **MagicDNS** and **HTTPS Certificates**.
4. On your Android phone and laptop: install the Tailscale app and sign in with the same account.

## 3. Code and configuration

```bash
sudo mkdir -p /opt/openlibrary /srv/openlibrary/data
sudo chown "$USER" /opt/openlibrary
sudo chown 1000:1000 /srv/openlibrary/data      # the container runs as user 1000 (node)

git clone https://github.com/rldona/OpenLibrary.git /opt/openlibrary
cd /opt/openlibrary/deploy
cp .env.example .env
nano .env        # PUBLIC_URL=https://openlibrary.<your-tailnet>.ts.net
```

> Without git, copy the project folder instead: `rsync -a --exclude node_modules OpenLibrary/ your-pc:/opt/openlibrary/`.

## 4. Start

```bash
cd /opt/openlibrary/deploy
docker compose up -d --build
docker compose ps                         # should show "healthy" after a few seconds
sudo ln -sf /opt/openlibrary/deploy/scripts/ol /usr/local/bin/ol
ol set-password                           # prompts for the password (at least 12 characters)
```

Publish over HTTPS inside your tailnet (persists across reboots):

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve status
```

Checks:

```bash
curl -s http://127.0.0.1:8080/api/v1/health                      # on the PC
curl -s https://openlibrary.<your-tailnet>.ts.net/api/v1/health   # from another device on Tailscale
```

Open the URL in the phone's browser (with Tailscale on): it should ask for the password. The interface follows the browser language (English or Spanish) and can be switched in Settings or on the login screen.

## 5. Backups

Recommended free destination: a **USB disk** or a second permanently mounted disk (e.g. `/mnt/backup`). If you later want an off-site copy, restic supports Backblaze B2 (10 GB free) without changing anything else.

```bash
sudo mkdir -p /etc/openlibrary
sudo sh -c 'openssl rand -base64 32 > /etc/openlibrary/restic.pass && chmod 600 /etc/openlibrary/restic.pass'
sudo tee /etc/openlibrary/backup.env >/dev/null <<'EOF'
RESTIC_REPOSITORY=/mnt/backup/openlibrary-restic
RESTIC_PASSWORD_FILE=/etc/openlibrary/restic.pass
EOF
sudo chmod 600 /etc/openlibrary/backup.env
sudo env $(sudo cat /etc/openlibrary/backup.env | xargs) restic init
```

> **Keep a copy of `/etc/openlibrary/restic.pass` outside the PC** (password manager). Without it the backups cannot be opened.

Test and schedule:

```bash
sudo /opt/openlibrary/deploy/scripts/backup.sh
sudo cp /opt/openlibrary/deploy/systemd/openlibrary-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openlibrary-backup.timer
systemctl list-timers openlibrary-backup.timer
```

The backup runs every night at 03:30 and, if the PC was off, a few minutes after it is switched on.

Keep `BACKUP_SCHEDULE` unset (or `off`) here: restic already takes care of it. Hosts without a scheduler of their own (Railway) set `BACKUP_SCHEDULE=daily`. The server then snapshots the database every night at 03:00 UTC, and at boot when the last success is more than a day old. It writes the snapshot to `backups/library.db`, checks its integrity, keeps the newest `BACKUP_KEEP` (default 7) dated copies `backups/library-YYYY-MM-DD.db` and writes `backups/last-success`. A snapshot that fails the integrity check is discarded and logged as an error; the previous one and `last-success` stay as they were. That layer only covers the database: covers in `assets/` rely on the host's volume backups.

## 6. Restore

```bash
sudo env $(sudo cat /etc/openlibrary/backup.env | xargs) restic snapshots   # list available backups
sudo /opt/openlibrary/deploy/scripts/restore.sh            # the latest
sudo /opt/openlibrary/deploy/scripts/restore.sh 4f2a9c1e   # a specific one
```

The current state is not deleted: it is set aside as `library.db.before-restore-<date>`. After restoring, the server bumps its *epoch* and phones will perform a full resync.

**Recommended drill** after installing: take a backup, change the password, restore and check the previous one is back. The same steps run automatically in the server tests (`apps/server/test/restore-drill.test.ts`).

The web's **Import and export** page shows when the last backup finished (from `backups/last-success`, written by `backup.sh`) and warns if it is older than 3 days. From there you can also download the full export (zip with every record and cover): keep one outside the PC from time to time. Importing it into a new installation is the logical restore (design document §9).

## 7. Day-to-day operation

| Task | Command |
|------|---------|
| Try it with sample data (empty library) | `ol demo-data en` or `ol demo-data es` |
| Status | `ol status` · `docker compose -f /opt/openlibrary/deploy/docker-compose.yml ps` |
| Logs | `docker compose -f /opt/openlibrary/deploy/docker-compose.yml logs -f --tail=100` |
| Change the password (if forgotten) | `ol set-password` (signs out every session) |
| Update to the latest version (backup, pull, rebuild) | `sudo /opt/openlibrary/deploy/scripts/update.sh` |
| Revoke a lost phone | Web → Settings → Sessions and devices → Revoke |

## 8. Security: what protects the library

- The app only listens on `127.0.0.1`; it is invisible from the home network and from the Internet.
- Only devices in **your** tailnet reach the URL; traffic is end-to-end encrypted.
- Even so, the app behaves as if it were on the Internet: Argon2id password, progressive lockout after 5 failures, `Secure`/`HttpOnly`/`SameSite=Strict` cookies, CSRF protection and security headers. That is why publishing it one day would only change the deployment (see §9.1 of the design document).
- Note: behind `tailscale serve` every request may arrive with the same internal IP; the failed-attempt lockout then behaves like a global lockout, which is acceptable for a single user.
- `TRUST_PROXY` says where the client address comes from (it keys the lockout and the rate limit): `false` (no proxy), `true` (every `X-Forwarded-For` entry, today's setting behind `tailscale serve`), a hop count such as `1` (only the address the proxy in front appends; anything the client wrote is ignored) or a header name the proxy always overwrites. On Railway it is `TRUST_PROXY=x-real-ip`: its edge documents `X-Real-IP` as the client's address. To check a new host, set `LOG_LEVEL=debug` for a while: each failed login also logs the socket address and the raw `X-Forwarded-For` / `X-Real-IP`.

## 9. Android app and passkeys

The Android app, its build-time default server and passkeys work the same as on Railway: see [deployment-runbook.md](deployment-runbook.md), "Building the Android app" and "Passkeys". Passkeys need a certificate from a public CA on the hostname, which `tailscale serve` provides, and `ANDROID_CERT_SHA256` in `deploy/.env` for the Android app.

