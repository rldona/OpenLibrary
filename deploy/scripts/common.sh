# Configuración compartida por los scripts de despliegue. Se incluye con «source».
# Puedes sobrescribir cualquier valor en /etc/openlibrary/backup.env.
set -euo pipefail
[ -f /etc/openlibrary/backup.env ] && source /etc/openlibrary/backup.env

OL_DIR="${OL_DIR:-/srv/openlibrary}"                 # estado: data/library.db, data/assets/, data/backups/
OL_REPO="${OL_REPO:-/opt/openlibrary}"               # código (clon del repositorio)
COMPOSE=(docker compose -f "$OL_REPO/deploy/docker-compose.yml")
export OL_DATA="$OL_DIR/data"

log() { echo "[$(date '+%F %T')] $*"; }
die() { log "ERROR: $*" >&2; exit 1; }
