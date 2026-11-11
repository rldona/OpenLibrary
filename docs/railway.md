# Running on Railway

The service definition lives in [`railway.json`](../railway.json) (config as code); the dashboard
only holds what cannot be in git: the volume, the variables and the domain.

## Service

- **Build**: the root `Dockerfile`. Only changes to the server, the web app, the contracts, the
  Dockerfile, the lockfile or `railway.json` start a build (`watchPatterns`): Android-only and
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

On the Hobby plan Railway offers **no volume backups**: the API answers that manual backups and backup schedules "are only available for Pro workspaces". The owner decided (2026-11-11) to accept this, because the library holds nothing sensitive and losing it is acceptable. There is also no off-site copy.

The only protection is the server's own nightly snapshot (`BACKUP_SCHEDULE=daily`, `BACKUP_KEEP=7`): every night at 03:00 UTC, and at boot when the last one is more than a day old, it writes `backups/library.db` plus a dated copy, keeping the newest 7, and `backups/last-success` (shown in the web's Import and export page).

- **It protects against** a bad migration, a buggy release or a logical mistake. Restore one of the dated copies over `library.db` (runbook, "Restore") and run `after-restore`.
- **It does not protect against** losing the volume, the service or the project: the snapshots live on that same volume. Covers (`assets/`) are not in the snapshot at all.
- To keep a copy elsewhere by hand: `railway volume files --volume <volume> download /backups/library.db ./library.db`, or download the web's full export (zip with every record and cover).
- Moving the workspace to Pro would allow a daily volume backup with one API call (`volumeInstanceBackupScheduleUpdate`, `kinds: [DAILY]`).

## Cost levers

App sleeping ("Serverless", `sleepApplication`) is off. If usage ever exceeds the plan's included
credit, turning it on is the first lever: the service stops when idle and the first request after
that wakes it up (a slower first load, a sync that waits a few seconds).
