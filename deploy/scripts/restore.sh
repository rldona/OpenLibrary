#!/usr/bin/env bash
# Restores a restic backup (the latest by default).
#   sudo restore.sh            → latest backup
#   sudo restore.sh 4f2a9c1e   → a specific snapshot ("restic snapshots" lists them)
# The current state is NOT deleted: it is set aside as library.db.before-restore-<date>.
# shellcheck source=deploy/scripts/common.sh
source "$(dirname "$(readlink -f "$0")")/common.sh"
: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY in /etc/openlibrary/backup.env}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE in /etc/openlibrary/backup.env}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

SNAPSHOT="${1:-latest}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log "Extracting backup $SNAPSHOT…"
restic restore "$SNAPSHOT" --tag openlibrary --host openlibrary --target "$TMP"
SRC_DB="$TMP$OL_DATA/backups/library.db"
[ -f "$SRC_DB" ] || die "the backup does not contain $OL_DATA/backups/library.db"

read -r -p "The current library will be replaced by backup $SNAPSHOT. Continue? [y/N] " ok
[[ "$ok" =~ ^[yY]$ ]] || die "cancelled"

log "Stopping the app…"
"${COMPOSE[@]}" stop app

log "Setting the current state aside…"
for f in library.db library.db-wal library.db-shm; do
  [ -f "$OL_DATA/$f" ] && mv "$OL_DATA/$f" "$OL_DATA/$f.before-restore-$STAMP"
done
[ -d "$OL_DATA/assets" ] && mv "$OL_DATA/assets" "$OL_DATA/assets.before-restore-$STAMP"

cp "$SRC_DB" "$OL_DATA/library.db"
[ -d "$TMP$OL_DATA/assets" ] && cp -a "$TMP$OL_DATA/assets" "$OL_DATA/assets"
chown -R 1000:1000 "$OL_DATA/library.db" "$OL_DATA/assets" 2>/dev/null || true

log "Checking integrity and bumping the epoch…"
"${COMPOSE[@]}" run --rm app node dist/cli.js after-restore || die "the restored backup is not valid; the previous state is still set aside in $OL_DATA"

"${COMPOSE[@]}" start app
log "Restore completed. Devices will perform a full resync when they connect."
