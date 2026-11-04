#!/usr/bin/env bash
# Restaura una copia de restic (por defecto la última).
#   sudo restore.sh            → última copia
#   sudo restore.sh 4f2a9c1e   → una instantánea concreta («restic snapshots» para verlas)
# El estado actual NO se borra: se aparta como library.db.antes-de-restaurar-<fecha>.
source "$(dirname "$(readlink -f "$0")")/common.sh"
: "${RESTIC_REPOSITORY:?Define RESTIC_REPOSITORY en /etc/openlibrary/backup.env}"
: "${RESTIC_PASSWORD_FILE:?Define RESTIC_PASSWORD_FILE en /etc/openlibrary/backup.env}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

SNAPSHOT="${1:-latest}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log "Extrayendo la copia $SNAPSHOT…"
restic restore "$SNAPSHOT" --tag openlibrary --host openlibrary --target "$TMP"
SRC_DB="$TMP$OL_DATA/backups/library.db"
[ -f "$SRC_DB" ] || die "la copia no contiene $OL_DATA/backups/library.db"

read -r -p "Se sustituirá la biblioteca actual por la copia $SNAPSHOT. ¿Continuar? [s/N] " ok
[[ "$ok" =~ ^[sS]$ ]] || die "cancelado"

log "Deteniendo la aplicación…"
"${COMPOSE[@]}" stop app

log "Apartando el estado actual…"
for f in library.db library.db-wal library.db-shm; do
  [ -f "$OL_DATA/$f" ] && mv "$OL_DATA/$f" "$OL_DATA/$f.antes-de-restaurar-$STAMP"
done
[ -d "$OL_DATA/assets" ] && mv "$OL_DATA/assets" "$OL_DATA/assets.antes-de-restaurar-$STAMP"

cp "$SRC_DB" "$OL_DATA/library.db"
[ -d "$TMP$OL_DATA/assets" ] && cp -a "$TMP$OL_DATA/assets" "$OL_DATA/assets"
chown -R 1000:1000 "$OL_DATA/library.db" "$OL_DATA/assets" 2>/dev/null || true

log "Verificando integridad y cambiando el epoch…"
"${COMPOSE[@]}" run --rm app node dist/cli.js after-restore || die "la copia restaurada no es válida; el estado anterior sigue apartado en $OL_DATA"

"${COMPOSE[@]}" start app
log "Restauración completada. Los dispositivos harán una resincronización completa al conectarse."
