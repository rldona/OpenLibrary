# Shared settings for the deployment scripts. Included with "source".
# Any value can be overridden in /etc/openlibrary/backup.env.
set -euo pipefail
[ -f /etc/openlibrary/backup.env ] && source /etc/openlibrary/backup.env

OL_DIR="${OL_DIR:-/srv/openlibrary}"                 # state: data/library.db, data/assets/, data/backups/
OL_REPO="${OL_REPO:-/opt/openlibrary}"               # code (repository clone)
COMPOSE=(docker compose -f "$OL_REPO/deploy/docker-compose.yml")
export OL_DATA="$OL_DIR/data"

log() { echo "[$(date '+%F %T')] $*"; }
die() { log "ERROR: $*" >&2; exit 1; }
