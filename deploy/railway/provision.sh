#!/usr/bin/env bash
# Creates (or checks) the Railway infrastructure of OpenLibrary: project, environment, service,
# volume, public domain and service variables. Idempotent: a second run changes nothing.
#
# Needs the Railway CLI and an account token in the environment (RAILWAY_API_TOKEN). Prints ids
# and names, never variable values or tokens. The first deploy is a separate step (`railway up`).
#
# Optional:
#   OL_RAILWAY_WORKSPACE  workspace id or name (default: the only workspace of the account)
#   OL_RAILWAY_PROJECT    project name (default: openlibrary)
#   OL_RAILWAY_REGION     region of the volume (default: europe-west4-drams3a, Amsterdam)
#   OL_ANDROID_CERT_SHA256  fingerprint of the APK signing certificate (default: the owner's release key)
#   GOOGLE_BOOKS_API_KEY  if set, stored as a service variable (read from the environment, not args)
set -euo pipefail

PROJECT_NAME=${OL_RAILWAY_PROJECT:-openlibrary}
ENVIRONMENT=production
SERVICE=app
MOUNT=/data
REGION=${OL_RAILWAY_REGION:-europe-west4-drams3a}
PORT=8080

# Everything except PUBLIC_URL, which references Railway's own domain variable.
VARIABLES=(
  NODE_ENV=production
  HOST=0.0.0.0
  "PORT=$PORT"
  "DATA_DIR=$MOUNT"
  WEB_DIST=/app/web
  TRUST_PROXY=x-real-ip
  RAILWAY_RUN_UID=0
  BACKUP_SCHEDULE=daily
  BACKUP_KEEP=7
  SESSION_TTL_DAYS=30
  LOG_LEVEL=info
  # SHA-256 of the certificate that signs the release APK (public): passkeys from the Android app
  # and /.well-known/assetlinks.json. A fork or another signing key sets its own.
  "ANDROID_CERT_SHA256=${OL_ANDROID_CERT_SHA256:-DE:2D:A0:52:A0:79:B9:76:C5:D6:06:F4:81:00:43:DB:F2:F7:03:7B:EE:FE:63:B8:69:BF:71:B4:AF:A8:87:0D}"
)

log() { printf '› %s\n' "$*"; }
die() { printf 'provision: %s\n' "$*" >&2; exit 1; }
# The CLI prints a Config-as-Code deprecation notice on stderr; keep stdout as pure JSON.
rw() { railway "$@" 2>/dev/null; }

command -v railway >/dev/null || die "the Railway CLI is not installed"
command -v jq >/dev/null || die "jq is not installed"
[ -n "${RAILWAY_API_TOKEN:-}" ] || railway whoami >/dev/null 2>&1 || die "set RAILWAY_API_TOKEN (account token)"
cd "$(dirname "$0")/../.."

# ---------- Project and environment ----------
workspace=${OL_RAILWAY_WORKSPACE:-$(rw api '{ me { workspaces { id } } }' | jq -r '.data.me.workspaces | if length == 1 then .[0].id else empty end')}
[ -n "$workspace" ] || die "several workspaces: set OL_RAILWAY_WORKSPACE"

project=$(rw list --json | jq -r --arg n "$PROJECT_NAME" '[.[] | select(.name == $n)][0].id // empty')
if [ -z "$project" ]; then
  log "creating project $PROJECT_NAME"
  project=$(rw init --name "$PROJECT_NAME" --workspace "$workspace" --json | jq -r .id)
else
  log "project $PROJECT_NAME exists"
fi
rw link --project "$project" --environment "$ENVIRONMENT" --json >/dev/null || die "cannot link the project"
environment=$(rw environment list --json | jq -r --arg n "$ENVIRONMENT" '.environments[] | select(.name == $n) | .id')
[ -n "$environment" ] || die "environment $ENVIRONMENT not found"

# ---------- Service ----------
service=$(rw service list --json | jq -r --arg n "$SERVICE" '.[] | select(.name == $n) | .id')
if [ -z "$service" ]; then
  log "creating service $SERVICE"
  service=$(rw add --service "$SERVICE" --json | jq -r .id)
else
  log "service $SERVICE exists"
fi
rw link --project "$project" --environment "$ENVIRONMENT" --service "$SERVICE" --json >/dev/null

# ---------- Volume (GraphQL: `railway volume add` panics in CLI 5.71) ----------
volume=$(rw api "{ project(id: \"$project\") { volumes { edges { node { id volumeInstances { edges { node { serviceId mountPath } } } } } } } }" |
  jq -r --arg s "$service" --arg m "$MOUNT" '.data.project.volumes.edges[].node
    | select(any(.volumeInstances.edges[].node; .serviceId == $s and .mountPath == $m)) | .id' | head -1)
if [ -z "$volume" ]; then
  log "creating volume at $MOUNT ($REGION)"
  volume=$(rw api "mutation { volumeCreate(input: { projectId: \"$project\", serviceId: \"$service\", environmentId: \"$environment\", mountPath: \"$MOUNT\", region: \"$REGION\" }) { id } }" |
    jq -r .data.volumeCreate.id)
  [ -n "$volume" ] && [ "$volume" != null ] || die "volume creation failed"
else
  log "volume at $MOUNT exists"
fi

# ---------- Public domain ----------
domain=$(rw domain list --service "$SERVICE" --json | jq -r '[.domains[] | select(.type == "service")][0].domain // empty')
if [ -z "$domain" ]; then
  log "generating a public domain (port $PORT)"
  domain=$(rw domain --service "$SERVICE" --port "$PORT" --json | jq -r .domain | sed 's#^https://##')
else
  log "domain $domain exists"
fi

# ---------- Variables (only the ones that differ; values are never printed) ----------
current=$(rw variable list --service "$SERVICE" --json)
changes=()
for kv in "${VARIABLES[@]}"; do
  key=${kv%%=*}
  [ "$(jq -r --arg k "$key" '.[$k] // empty' <<<"$current")" = "${kv#*=}" ] || changes+=("$kv")
done
# PUBLIC_URL resolves to https://<domain>; it must stay a reference so it follows the domain.
# shellcheck disable=SC2016 # ${{…}} is Railway's reference syntax, not a shell expansion.
[ "$(jq -r '.PUBLIC_URL // empty' <<<"$current")" = "https://$domain" ] || changes+=('PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}')
if [ ${#changes[@]} -gt 0 ]; then
  log "setting variables: $(printf '%s ' "${changes[@]%%=*}")"
  rw variable set --service "$SERVICE" --skip-deploys --json "${changes[@]}" >/dev/null
else
  log "variables up to date"
fi
if [ -n "${GOOGLE_BOOKS_API_KEY:-}" ]; then
  if [ "$(jq -r '.GOOGLE_BOOKS_API_KEY // empty' <<<"$current")" != "$GOOGLE_BOOKS_API_KEY" ]; then
    log "setting GOOGLE_BOOKS_API_KEY"
    printf '%s' "$GOOGLE_BOOKS_API_KEY" | rw variable set GOOGLE_BOOKS_API_KEY --stdin --service "$SERVICE" --skip-deploys --json >/dev/null
  fi
fi
unset current

cat <<SUMMARY
Railway: project $project · environment $environment · service $service · volume $volume
URL: https://$domain
Next: railway up --ci --service $SERVICE (from the repository root)
SUMMARY
