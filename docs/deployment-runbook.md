# Deployment on the Ubuntu PC

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

git clone <your-private-repository-url> /opt/openlibrary
cd /opt/openlibrary/deploy
cp .env.example .env
nano .env        # PUBLIC_URL=https://openlibrary.<your-tailnet>.ts.net
```

> If you would rather not use GitHub, copy the project folder with `rsync -a --exclude node_modules OpenLibrary/ ubuntu-pc:/opt/openlibrary/`.

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

The web's **Import and export** page shows when the last backup finished (from `backups/last-success`, written by `backup.sh`) and warns if it is older than 3 days. From there you can also download the full export (zip with every record and cover): keep one outside the PC from time to time. Importing it into a new installation is the logical restore (§ design 9).

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

## 9. Building the Android app for your server

The setup screen can skip the server address: build the APK with your server as the default and the phone only asks for the device name and a passkey (or the password). A small "Use another server" link still shows the address field. The address is **never committed**. Pass it in one of these ways:

- in `apps/android/local.properties` (not in git): `openlibrary.defaultServerUrl=https://library.example.com`;
- on the command line: `-Popenlibrary.defaultServerUrl=https://library.example.com`;
- in CI: the `OPENLIBRARY_DEFAULT_SERVER_URL` environment variable, from a repository secret.

It must be an `https://` address without a path. Anything else fails the build, not the app. Without the property the setup asks for the address as before.

```bash
cd apps/android
./gradlew :app:assembleRelease -Popenlibrary.defaultServerUrl=https://library.example.com
```

The release APK is written to `app/build/outputs/apk/release/`. It is unsigned until a release signing key is configured outside the repository (§10); passkeys need that stable key. Changing the server address of an already connected phone is done in its Settings ("Change server address"), and does not depend on this default.
## 10. Passkeys

The library has a single owner. Instead of a password plus a second factor, sign-in can use **passkeys**: the fingerprint, face or screen lock of a phone or laptop, or a password manager that syncs them.

- **Before the first passkey** nothing changes: the password signs in on the web and registers phones.
- **Add one**: web → Settings → Passkeys → "Add a passkey" (it asks for the password). The first one also shows **ten recovery codes, only once**: keep them in your password manager.
- **Once a passkey exists**, the password alone is refused on the web and when registering a phone. It still works **together with a recovery code**, and each code works once. Changing the password and adding or removing passkeys still need the password. Phones already connected keep working: their device tokens are not affected.
- **New codes**: Settings → Passkeys → "New recovery codes". The old ones stop working.
- **Locked out** (no passkey and no code left): run `node dist/cli.js passkeys-reset` on the server, through `railway ssh`, or `ol passkeys-reset` on the Ubuntu deployment. It removes every passkey and recovery code, and the password alone signs in again.
- **Passkeys are bound to the hostname** of `PUBLIC_URL`. Moving to another domain means registering them again: sign in there with the password and a recovery code, then add new passkeys.

### Android

Credential Manager only offers this site's passkeys to the app when the site says the app may use them. That is `/.well-known/assetlinks.json`, served when `ANDROID_CERT_SHA256` is set. It must be set to the SHA-256 fingerprint of the certificate that **signs the APK** (comma-separated if there are several). Passkeys only work against the real HTTPS hostname: not against `http://10.0.2.2` or `localhost`.

The certificate must be stable, so the release APK is signed with a key of your own that **never goes in the repository**:

```bash
keytool -genkeypair -v -keystore ~/.android/openlibrary-release.jks -alias openlibrary \
  -keyalg EC -groupname secp256r1 -validity 10000
keytool -list -v -keystore ~/.android/openlibrary-release.jks -alias openlibrary | grep SHA256
```

Keep the keystore and its passwords in your password manager. Losing the key means new APKs cannot update the installed app and its passkeys need a new `ANDROID_CERT_SHA256`. Tell Gradle where the key is in `~/.gradle/gradle.properties`, outside the repository:

```properties
openlibrary.signing.storeFile=/home/you/.android/openlibrary-release.jks
openlibrary.signing.storePassword=…
openlibrary.signing.keyAlias=openlibrary
openlibrary.signing.keyPassword=…
```

`./gradlew :app:assembleRelease` then signs the APK. Without these properties it stays unsigned. Forks and self-hosters use their own key and set their own `ANDROID_CERT_SHA256` (and `ANDROID_PACKAGE` if they change the application id).


## 11. Railway

The production service runs on Railway (design decisions in [railway.md](railway.md)). It is created by [`deploy/railway/provision.sh`](../deploy/railway/provision.sh), which is idempotent: re-running it only reports what exists.

```bash
export RAILWAY_API_TOKEN=…   # account token, only in this shell
deploy/railway/provision.sh
railway up --ci --service app  # first deploy; later deploys come from CI
```

| Resource | Value |
| --- | --- |
| Workspace | Raúl López's Projects (`671263a0-aeb4-4e21-b6d4-3ac59e152749`) |
| Project | `openlibrary` (`6cc1c276-f347-42c9-84fe-20c55d1feae2`) |
| Environment | `production` (`a5a752ab-79c7-42ec-acdd-83b7d17600c5`) |
| Service | `app` (`50614a83-7b9d-4b92-89aa-ee8c2c909749`) |
| Volume | `app-volume` at `/data`, `europe-west4-drams3a` (`38064dd3-89d9-48c1-8faf-1efaa29e580f`) |
| URL | https://app-production-10a9154b.up.railway.app (port 8080) |

Service variables: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=8080`, `DATA_DIR=/data`, `WEB_DIST=/app/web`, `PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`, `TRUST_PROXY=x-real-ip`, `RAILWAY_RUN_UID=0`, `BACKUP_SCHEDULE=daily`, `BACKUP_KEEP=7`, `SESSION_TTL_DAYS=30`, `LOG_LEVEL=info`, plus `GOOGLE_BOOKS_API_KEY` (secret: set it with `GOOGLE_BOOKS_API_KEY=… deploy/railway/provision.sh` or `railway variable set GOOGLE_BOOKS_API_KEY --stdin`). There is **no** `OL_PASSWORD`: the password hash lives in the database.

Admin CLI on Railway (it runs as root and drops to the `node` account by itself):

```bash
railway ssh --service app -- node dist/cli.js status
railway ssh --service app -- node dist/cli.js set-password   # interactive
```

Notes:
- `railway volume add` panics in CLI 5.71, so the script creates the volume through the GraphQL API (`railway api`).
- A workspace token is enough for the GraphQL API but not for `railway whoami`, `list` or `ssh`: use an account token, and revoke it when the provisioning work is done.
- Railway prints that Config as Code (`railway.json`) is deprecated in favour of `.railway/railway.ts` and keeps working until 2026-12-01.
