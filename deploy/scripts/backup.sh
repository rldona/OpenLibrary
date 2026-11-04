#!/usr/bin/env bash
# Copia de seguridad: instantánea consistente de la BD (en caliente) + portadas → restic.
# Requiere en /etc/openlibrary/backup.env: RESTIC_REPOSITORY y RESTIC_PASSWORD_FILE.
source "$(dirname "$(readlink -f "$0")")/common.sh"
: "${RESTIC_REPOSITORY:?Define RESTIC_REPOSITORY en /etc/openlibrary/backup.env}"
: "${RESTIC_PASSWORD_FILE:?Define RESTIC_PASSWORD_FILE en /etc/openlibrary/backup.env}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

SNAP="$OL_DATA/backups/library.db"
log "Instantánea de la base de datos…"
"${COMPOSE[@]}" exec -T app node dist/cli.js backup /data/backups/library.db \
  || die "no se pudo crear la instantánea (¿está el contenedor arrancado?)"

PATHS=("$SNAP")
[ -d "$OL_DATA/assets" ] && PATHS+=("$OL_DATA/assets")

log "Enviando a restic ($RESTIC_REPOSITORY)…"
restic backup --tag openlibrary --host openlibrary "${PATHS[@]}"

log "Aplicando retención (7 diarias, 4 semanales, 12 mensuales)…"
restic forget --tag openlibrary --host openlibrary --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune

if [ "$(date +%u)" = "7" ]; then
  log "Domingo: verificando el repositorio…"
  restic check --read-data-subset=5%
fi

date -u +%FT%TZ > "$OL_DATA/backups/last-success"
log "Copia completada."
