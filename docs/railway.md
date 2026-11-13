# Running on Railway

The service definition lives in [`.railway/railway.ts`](../.railway/railway.ts) (Railway's Infrastructure as Code, which replaced `railway.json` before Config as Code stopped working on 2026-12-01). It declares the build, the deploy settings, the region and the volume mount. It does **not** manage the service variables (`variables: { managed: false }`): they are set by `deploy/railway/provision.sh` and the CD job, and no value ever lives in the repository. The dashboard only holds what cannot be in git: the variables and the domain.

Changing it, with an account token in the shell (`npm ci` installs the `railway` SDK it imports):

```bash
railway config plan     # what would change; nothing destructive is expected
railway config apply    # applies it to the production environment
```

Railway stores default values as null, so the file leaves out the defaults it relies on (`restartPolicyType: ON_FAILURE`, `sleepApplication: false`); otherwise the plan would show them as a change forever. `requiredMountPath` (it was in `railway.json`) has no equivalent in the service settings; the volume is mounted at `/data` by `volumeMounts`.

## Service

- **Build**: the root `Dockerfile`. Only changes to the server, the web app, the contracts, the
  Dockerfile or the lockfile start a build (`watchPatterns`): Android-only and
  docs-only commits do not redeploy. `.railwayignore` keeps `apps/android`, `.data`, `docs`,
  `prototypes` and every `.env` out of `railway up` uploads, and `.dockerignore` out of the build
  context.
- **Region**: `europe-west4-drams3a` (Amsterdam), the EU region closest to Madrid.
- **One replica**, with a volume mounted at `/data` (`requiredMountPath`): a service with a volume
  cannot have replicas, and SQLite needs a single writer.
- **Root start**: Railway volumes are owned by root, so the service sets `RAILWAY_RUN_UID=0`. The
  server (and the CLI under `railway ssh`) hands `/data` to the `node` account and drops to it before
  opening any file.
- **Health**: Railway waits for `GET /api/v1/health` (up to 300 s, enough for the migrations that
  run on boot) before routing traffic to a new deployment. Docker's `HEALTHCHECK` is ignored there.
- **Restarts**: on failure, at most 5 times. On a redeploy the old container gets `SIGTERM` and
  20 s to finish (`drainingSeconds`); the server closes cleanly on `SIGTERM`.

## Deploys mean a few seconds of downtime

With a volume attached Railway cannot overlap deployments: the old container stops before the new
one mounts the volume, so every deploy answers 502 for a few seconds. This is expected and is not
worked around. The web app shows a network error and can be reloaded; the Android app treats it as
being offline and retries the sync later.

## Backups: only the nightly snapshot on the same volume

On the Hobby plan Railway offers **no volume backups**: the API answers that manual backups and backup schedules "are only available for Pro workspaces". The owner decided (2026-11-11) to accept this, because the library holds nothing sensitive and losing it is acceptable. Since 2026-11-13 there is an optional off-site copy to the owner's Google Drive (below).

The only protection is the server's own nightly snapshot (`BACKUP_SCHEDULE=daily`, `BACKUP_KEEP=7`): every night at 03:00 UTC, and at boot when the last one is more than a day old, it writes `backups/library.db` plus a dated copy, keeping the newest 7, and `backups/last-success` (shown in the web's Import and export page).

- **It protects against** a bad migration, a buggy release or a logical mistake. Restore one of the dated copies over `library.db` (runbook, "Restore") and run `after-restore`.
- **It does not protect against** losing the volume, the service or the project: the snapshots live on that same volume. Covers (`assets/`) are not in the snapshot at all.
- To keep a copy elsewhere by hand: `railway volume files --volume <volume> download /backups/library.db ./library.db`, or download the web's full export (zip with every record and cover).
- **Google Drive** (optional, runbook §6.1): the server uploads a gzip of the database and the covers to the owner's Drive from the web, manually or every 1/5/10/15 minutes, only when something changed. It survives losing the volume or the project; restore with `drive-fetch` (runbook §7 c). It needs `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the service variables. Egress is negligible: covers are uploaded once.
- Moving the workspace to Pro would allow a daily volume backup with one API call (`volumeInstanceBackupScheduleUpdate`, `kinds: [DAILY]`).

## Cost levers

App sleeping ("Serverless", `sleepApplication`) is off. If usage ever exceeds the plan's included
credit, turning it on is the first lever: the service stops when idle and the first request after
that wakes it up (a slower first load, a sync that waits a few seconds).

## Measured on the smoke test (2026-11-11)

Demo data plus 10,000 imported copies (and 3,811 reading sessions), service in `europe-west4-drams3a`:

| What | Value |
| --- | --- |
| RAM | ~210 MB after start, idle; peak ~240 MB |
| CPU | ~0.002–0.006 vCPU average idle; short peaks of ~0.06 vCPU |
| Volume | ~90 MB with 10,000 copies (no covers) |
| `GET /sync/snapshot`, 10,000 copies | ~0.8 s from Madrid, 1.3 MB gzipped |
| `GET /library?q=…`, 10,000 copies | ~0.4 s from Madrid |
| Import of 10,000 copies (JSON, 12 MB) | ~11 s |
| Redeploy | ~4 s without answers (connection errors, then the new container) |

**Cost estimate**, Hobby prices (RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB): 0.2 GB × $10 ≈ $2.00 + CPU ≈ $0.10 + volume < $0.05 + egress ≈ $0 → **about $2.2/month of usage**. That is inside the $5 of usage the Hobby subscription includes, so the bill is the **$5/month subscription**. Two caveats: that $5 of included usage is per workspace, shared with the other projects in it, and covers (`assets/`) add volume storage at $0.15/GB-month.

**Client address**: Railway's edge overwrites both `X-Real-IP` (the caller's address) and `X-Forwarded-For` (`<caller>, <edge>`); values sent by the client never reach the app. `TRUST_PROXY=x-real-ip` is therefore not spoofable.

## Continuous deployment

Every push to `main` runs CI. When the `checks` and `docker` jobs pass and the push changed something that goes into the image (server, web, `packages/`, Dockerfile, lockfile, ignore files), the `deploy` job:

1. sets the service variable `OL_VERSION` to the first 12 characters of the commit (Railway passes it to the build as an argument and to the container as a variable),
2. runs `railway up --ci --service app` with `RAILWAY_TOKEN`, a **project token** for the `production` environment stored as a GitHub Actions secret (create a new one with the GraphQL `projectTokenCreate` mutation, or in the dashboard under Project → Settings → Tokens, and store it with `gh secret set RAILWAY_TOKEN`),
3. waits until `GET /api/v1/health` reports that version, and fails otherwise.

Android-only, docs-only and CI-only pushes do not deploy, and neither do changes to `.railway/` (the service config is applied with `railway config apply`, not by building a new image). A failing test or image build blocks the deploy. Pushes deploy one at a time (`concurrency`). Pull requests, including those from forks, never reach the job or the secret.

**Order of deploys:** deploy the server before distributing an APK that needs it (an older server rejects new API calls or sync operations). With continuous deployment that means merging the server change and waiting for the `deploy` job before building and installing the APK.
