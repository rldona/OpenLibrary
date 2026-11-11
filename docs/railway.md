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
