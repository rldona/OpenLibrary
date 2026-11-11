# Deployment runbook (Railway)

OpenLibrary runs as **one Docker container on Railway** with a public HTTPS URL. All state (the SQLite database, the covers and the nightly snapshots) lives in one volume mounted at `/data`. Service notes, measurements and costs: [railway.md](railway.md). Running it on your own machine instead (Ubuntu + Tailscale): [self-hosting.md](self-hosting.md).

```
Phone / laptop ──HTTPS──▶ Railway edge (TLS, X-Real-IP)
                             └─▶ service "app" :8080 (API + web, one replica, europe-west4-drams3a)
                                    └─ volume /data: library.db, assets/, backups/
GitHub push to main ──CI──▶ deploy job ──railway up──▶ new image
```

## 1. Prerequisites

- A Railway workspace on the **Hobby** plan (volumes up to 5 GB). Set a usage limit (§8).
- The Railway CLI (`npm install -g @railway/cli`) and `jq`.
- An **account token** (railway.com/account/tokens, workspace "No workspace") exported only in the shell that provisions: `export RAILWAY_API_TOKEN=…`. A workspace token is enough for the GraphQL API but not for `railway whoami`, `list` or `ssh`. Revoke it when the work is done.
- `npm ci` at the repository root: it installs the `railway` SDK that `.railway/railway.ts` imports.

## 2. Provision

[`deploy/railway/provision.sh`](../deploy/railway/provision.sh) creates, or checks, the project, the `production` environment, the `app` service, the volume at `/data`, the generated domain and the service variables. It is idempotent: re-running it only reports what exists. It prints ids, never values.

```bash
deploy/railway/provision.sh
railway config plan     # service settings from .railway/railway.ts; nothing destructive is expected
railway config apply
```

| Resource | Value |
| --- | --- |
| Workspace | Raúl López's Projects (`671263a0-aeb4-4e21-b6d4-3ac59e152749`) |
| Project | `openlibrary` (`6cc1c276-f347-42c9-84fe-20c55d1feae2`) |
| Environment | `production` (`a5a752ab-79c7-42ec-acdd-83b7d17600c5`) |
| Service | `app` (`50614a83-7b9d-4b92-89aa-ee8c2c909749`) |
| Volume | `app-volume` at `/data`, `europe-west4-drams3a` (`38064dd3-89d9-48c1-8faf-1efaa29e580f`) |
| URL | https://app-production-10a9154b.up.railway.app (port 8080) |

Service variables: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=8080`, `DATA_DIR=/data`, `WEB_DIST=/app/web`, `PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` (CSRF and cookies depend on it being exact), `TRUST_PROXY=x-real-ip`, `RAILWAY_RUN_UID=0` (the volume is owned by root; the server drops to `node` by itself), `BACKUP_SCHEDULE=daily`, `BACKUP_KEEP=7`, `SESSION_TTL_DAYS=30`, `LOG_LEVEL=info`, `ANDROID_CERT_SHA256` (public fingerprint of the release signing certificate, §11) and `OL_VERSION` (set by the deploy job). `GOOGLE_BOOKS_API_KEY` is a secret: set it with `railway variable set GOOGLE_BOOKS_API_KEY --stdin --service app`. There is **no** `OL_PASSWORD`: the password hash lives in the database.

Notes: `railway volume add` panics in CLI 5.71, so the script creates the volume through the GraphQL API. `requiredMountPath` from the old `railway.json` has no equivalent in `.railway/railway.ts`.

## 3. Deploy

- **First deploy**, from the repository root: `railway up --ci --service app`. Railway waits for `GET /api/v1/health` before routing traffic to it.
- **Then every push to `main`** that changes the image (server, web, `packages/`, Dockerfile, lockfile) deploys by itself, after CI passes: the `deploy` job in `.github/workflows/ci.yml` with the `RAILWAY_TOKEN` project token (GitHub Actions secret). It sets `OL_VERSION` to the commit and fails unless `/api/v1/health` reports it. Android, docs, CI and `.railway/` changes do not deploy.
- **Service settings** (`.railway/railway.ts`) are applied with `railway config plan` / `railway config apply`, not by a deploy.
- **Deploy the server before distributing an APK** that needs it: merge the server change, wait for the `deploy` job, then build and install the APK.

What a deploy looks like for clients: with a volume, the old container stops before the new one starts, so the service does not answer for about 4 seconds. The web shows a network error for a moment. The Android app treats it as being offline and syncs later; nothing is lost.

## 4. First run: the owner's password

The password is never set from the web (nobody can get there first) and never through variables:

```bash
railway ssh --service app -- node dist/cli.js set-password   # prompts for it (at least 12 characters)
```

Then sign in on the web, add a passkey (§11) and keep the recovery codes. Install the Android app (§10) and connect it with the passkey.

## 5. Day-to-day operation

| Task | Command |
|------|---------|
| Status (data folder, password, passkeys, epoch, integrity) | `railway ssh --service app -- node dist/cli.js status` |
| Health and deployed version | `curl -s https://app-production-10a9154b.up.railway.app/api/v1/health` |
| Logs | `railway logs --service app` · `railway logs --service app --deployment --lines 200` |
| Metrics (CPU, RAM, volume, HTTP) | `railway metrics --service app --since 1h` |
| Change the password (signs out every session) | `railway ssh --service app -- node dist/cli.js set-password` |
| Locked out of passkeys | `railway ssh --service app -- node dist/cli.js passkeys-reset` (§11) |
| Restart without rebuilding | `railway restart --service app --yes` |
| Revoke a lost phone | Web → Settings → Sessions and devices → Revoke |

## 6. Backups

On Hobby, Railway offers **no volume backups** (only on Pro), and the owner decided against an off-site copy: the library holds nothing sensitive and losing it is acceptable. What exists:

- **Nightly snapshot** inside the server (`BACKUP_SCHEDULE=daily`): at 03:00 UTC and at boot when the last one is more than a day old, it writes `backups/library.db`, checks its integrity, keeps the newest 7 dated copies `backups/library-YYYY-MM-DD.db` and writes `backups/last-success`. The web's Import and export page shows when it last ran and warns after 3 days. It protects against a bad release or a logical mistake, **not** against losing the volume or the project, and it does not include covers.
- **Full export** from the web (Import and export → zip with every record and cover), whenever you want a copy elsewhere. Or by hand: `railway volume files --volume app-volume download /backups/library.db ./library.db`.

## 7. Restore

Every restore ends with `after-restore`: it checks integrity, rebuilds the search index and **bumps the data epoch**, so phones perform a full resync (pending changes are resent; clashes show up as conflicts, never lost). Do it at a quiet moment: changes made between the swap and the restart are discarded.

**(a) A nightly snapshot** (the usual case: a bad release or a mistake in the last days)

```bash
railway ssh --service app -- ls -l /data/backups          # pick a dated copy
railway ssh --service app -- sh -c '
  cd /data && day=$(date +%Y%m%d-%H%M%S) &&
  cp backups/library-YYYY-MM-DD.db restore.db && chown 1000:1000 restore.db &&
  for f in library.db library.db-wal library.db-shm; do [ -f "$f" ] && mv "$f" "$f.before-restore-$day"; done;
  mv restore.db library.db'
railway restart --service app --yes                        # the server reopens the restored file
railway ssh --service app -- node dist/cli.js after-restore
```

The current database is set aside as `library.db*.before-restore-<date>` (delete it once everything looks right). The running server keeps writing to the set-aside file until the restart, which is why the restart comes right after the swap. Covers are not part of the snapshot; covers added since then stay on the volume.

**(b) A Railway volume backup** (only if the workspace moves to Pro and the schedule is enabled): service → Backups → Restore the chosen backup, wait for the redeploy, then `railway ssh --service app -- node dist/cli.js after-restore`. Restoring brings back the whole volume, covers included.

**(c) Logical restore from a full export zip** (a new installation, another project, another host): provision and deploy (§2–§3), `set-password` (§4), web → Import and export → import the zip with a **dry run** first, then for real. Compare the totals with the export. Sessions, passkeys and devices are not part of the export: add a passkey again and reconnect the phones.

## 8. Cost and usage limit

Measured with 10,000 copies: about 210 MB of RAM and almost no CPU, roughly **$2/month of usage**, inside the $5 the Hobby subscription includes, so the bill is **$5/month**. The included usage is shared by every project in the workspace. Details and the measurements: [railway.md](railway.md).

Set a hard limit so a surprise cannot bill beyond what you accept:

```bash
railway usage                                   # this billing period
railway usage limit status
railway usage limit set --target workspace --soft 8 --hard 15
```

App sleeping is off. If usage ever grows, turning it on (`sleepApplication` in `.railway/railway.ts`) is the first lever: the first request after an idle period wakes the service up.

## 9. Security: what protects the library

- The URL is public. Nothing in the library is readable without a session: covers and exports included.
- **Passkeys** (§11): once one is registered, the password alone no longer signs in; it needs a single-use recovery code.
- Login throttling that strangers cannot turn against the owner: a per-address progressive lockout keyed on the real client address (`TRUST_PROXY=x-real-ip`; Railway's edge overwrites `X-Real-IP` and `X-Forwarded-For`, so a client cannot forge them), and bounded admission of password checks (design document §9.1).
- Argon2id passwords, `Secure`/`HttpOnly`/`SameSite=Strict` cookies, CSRF protection, CSP and HSTS; HTTP redirects to HTTPS at the edge.
- Revocable device tokens and sessions (web → Settings → Sessions and devices); the Android database is encrypted and can be locked with the fingerprint or PIN.

## 10. Building the Android app

The setup screen can skip the server address: build the APK with your server as the default and the phone only asks for the device name and a passkey (or the password). A small "Use another server" link still shows the address field. The address is **never committed**. Pass it in one of these ways:

- in `apps/android/local.properties` (not in git): `openlibrary.defaultServerUrl=https://library.example.com`;
- on the command line: `-Popenlibrary.defaultServerUrl=https://library.example.com`;
- in CI: the `OPENLIBRARY_DEFAULT_SERVER_URL` environment variable, from a repository secret.

It must be an `https://` address without a path. Anything else fails the build, not the app. Without the property the setup asks for the address as before.

```bash
cd apps/android
./gradlew :app:assembleRelease -Popenlibrary.defaultServerUrl=https://library.example.com
```

The release APK is written to `app/build/outputs/apk/release/`. It is unsigned until a release signing key is configured outside the repository (§11); passkeys need that stable key. Changing the server address of an already connected phone is done in its Settings ("Change server address"), and does not depend on this default.

## 11. Passkeys

The library has a single owner. Instead of a password plus a second factor, sign-in can use **passkeys**: the fingerprint, face or screen lock of a phone or laptop, or a password manager that syncs them.

- **Before the first passkey** nothing changes: the password signs in on the web and registers phones.
- **Add one**: web → Settings → Passkeys → "Add a passkey" (it asks for the password). The first one also shows **ten recovery codes, only once**: keep them in your password manager.
- **Once a passkey exists**, the password alone is refused on the web and when registering a phone. It still works **together with a recovery code**, and each code works once. Changing the password and adding or removing passkeys still need the password. Phones already connected keep working: their device tokens are not affected.
- **New codes**: Settings → Passkeys → "New recovery codes". The old ones stop working.
- **Locked out** (no passkey and no code left): run `node dist/cli.js passkeys-reset` on the server, through `railway ssh`, or `ol passkeys-reset` when self-hosting. It removes every passkey and recovery code, and the password alone signs in again.
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
